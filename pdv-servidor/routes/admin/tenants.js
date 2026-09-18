// Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// listar lojas e mudar status/vencimento — a versão HTTP (painel de Super
// Admin) do que scripts/createTenant.js --set-status já fazia via CLI.
// Mesma função de verdade (control/db.js#setTenantStatus), nenhuma lógica
// duplicada — só um jeito novo (autenticado, pela rede) de chamá-la.
import { Router } from 'express';
import { respondValidationError } from '../../lib/httpResponses.js';
import {
  listTenants, setTenantStatus, deleteTenant, VALID_TENANT_STATUSES,
  listTrashedTenants, restoreTenant, purgeTrashedTenant, purgeAllTrashedTenants, getTenantBySlug,
} from '../../control/db.js';
import { verifyPlatformAdminPassword } from '../../lib/platformAdminAuth.js';
import { getTenantDb } from '../../db/index.js';
import { restartTrial } from '../../lib/licenseState.js';
import { resetAdminPassword } from '../../lib/seedAdmin.js';
import { logAction } from '../../lib/audit.js';

const router = Router();

// Nunca expõe `db_path` (caminho de arquivo no disco do servidor) fora de
// propósito — o painel não precisa disso pra decidir nada, é detalhe de
// implementação. O resto da linha não tem segredo nenhum (nem senha de
// loja mora aqui, ver control/schema.sql).
function publicTenant(t) {
  return {
    id: t.id, slug: t.slug, razaoSocial: t.razao_social, nomeFantasia: t.nome_fantasia,
    cnpj: t.cnpj, status: t.status, plano: t.plano, createdAt: t.created_at, expiresAt: t.expires_at,
  };
}

router.get('/', (req, res) => {
  res.json({ tenants: listTenants().map(publicTenant), validStatuses: [...VALID_TENANT_STATUSES] });
});

router.post('/:slug/status', (req, res) => {
  try {
    const { status, expiresAt } = req.body || {};
    if (!status) throw new Error('Informe o novo status.');
    const updated = setTenantStatus(req.params.slug, status, expiresAt === undefined ? undefined : expiresAt);
    // Achado do usuário: selecionar "trial" aqui e salvar deve "renovar" a
    // loja — reinicia o relógio de 7 dias do período de teste dela (ver
    // lib/licenseState.js#restartTrial), senão o próprio auto-suspenso
    // (control/db.js#autoSuspendExpiredTrial, disparado na primeira
    // requisição de licença que ela fizer) suspenderia de novo quase na
    // hora, o "trial" nunca teria efeito nenhum de verdade.
    if (status === 'trial') {
      restartTrial(getTenantDb(updated.id));
    }
    res.json({ tenant: publicTenant(updated) });
  } catch (err) {
    respondValidationError(res, err);
  }
});

// Achado do usuário: dono de loja esqueceu a própria senha e não tem
// nenhum outro admin ativo pra redefinir por dentro do sistema (a única
// via normal, ver routes/users.js#POST /:id/redefinir-senha) — fica sem
// jeito nenhum de entrar. Este botão do painel devolve a conta 'admin' pro
// usuário/senha padrão de instalação (lib/seedAdmin.js#resetAdminPassword),
// sem tocar em produto/venda/cliente/estoque — só a conta de login em si.
// Mesma reconfirmação de senha (e mesmo namespace de bloqueio por força
// bruta) da exclusão de loja acima: é a mesma classe de ação sensível,
// dá acesso total a uma loja de outra pessoa.
router.post('/:slug/reset-admin-password', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) throw new Error('Informe sua senha pra confirmar a redefinição.');
    const confirmed = await verifyPlatformAdminPassword(req.platformAdmin?.username_lower, password);
    if (!confirmed) throw new Error('Senha incorreta.');
    const tenant = getTenantBySlug(req.params.slug);
    if (!tenant) throw new Error('Loja não encontrada.');
    const targetDb = getTenantDb(tenant.id);
    const credentials = await resetAdminPassword(targetDb);
    logAction({
      userId: null, userName: `Suporte (${req.platformAdmin?.username_lower})`, role: 'platform-admin',
      action: 'Redefinição de senha (via Super Admin)',
      details: `Senha da conta "${credentials.username}" redefinida pro padrão de instalação pelo painel de Super Admin.`,
      entity: 'user',
    }, targetDb);
    res.json({ credentials });
  } catch (err) {
    respondValidationError(res, err);
  }
});

// Lixeira: lojas excluídas cuja pasta ainda não foi apagada de verdade
// (ver control/db.js#deleteTenant) — listar, restaurar, excluir
// definitivamente (uma ou todas). Acha do usuário/CORREÇÃO: este bloco
// precisa vir ANTES de "DELETE /:slug" logo abaixo — o Express casa rotas
// pela ORDEM de registro, não por especificidade, então um "DELETE
// /lixeira" registrado DEPOIS de "DELETE /:slug" seria interceptado por
// ele primeiro (tratando "lixeira" como se fosse o slug de uma loja).
// Reproduzido no red team destes testes: sem essa ordem, esvaziar a
// lixeira respondia "Loja não encontrada: 'lixeira'." em vez de esvaziar
// de verdade. GET/POST não têm esse risco hoje (não existe GET/POST
// "/:slug" sem sufixo), mas o bloco inteiro fica aqui, agrupado, por
// clareza e pra nunca reintroduzir o mesmo problema se um desses métodos
// ganhar uma rota "/:slug" sozinha no futuro.
router.get('/lixeira', (req, res) => {
  res.json({ trashed: listTrashedTenants() });
});

router.post('/lixeira/:entry/restore', (req, res) => {
  try {
    const restored = restoreTenant(req.params.entry);
    res.json({ tenant: publicTenant(restored) });
  } catch (err) {
    respondValidationError(res, err);
  }
});

// Exclusão DEFINITIVA — mesma reconfirmação de senha do DELETE /:slug
// abaixo (namespace de bloqueio compartilhado entre as duas: são a mesma
// classe de ação destrutiva, ver lib/platformAdminAuth.js).
router.delete('/lixeira/:entry', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) throw new Error('Informe sua senha pra confirmar a exclusão definitiva.');
    const confirmed = await verifyPlatformAdminPassword(req.platformAdmin?.username_lower, password);
    if (!confirmed) throw new Error('Senha incorreta.');
    purgeTrashedTenant(req.params.entry);
    res.json({ ok: true });
  } catch (err) {
    respondValidationError(res, err);
  }
});

// Esvaziar a lixeira inteira de uma vez (achado do usuário) — mesma
// reconfirmação de senha da exclusão definitiva de UMA entrada acima,
// porque é a mesma classe de ação (apaga o .sqlite3 de cada loja de
// verdade, sem volta), só que pra todas de uma vez.
router.delete('/lixeira', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) throw new Error('Informe sua senha pra confirmar o esvaziamento da lixeira.');
    const confirmed = await verifyPlatformAdminPassword(req.platformAdmin?.username_lower, password);
    if (!confirmed) throw new Error('Senha incorreta.');
    const purged = purgeAllTrashedTenants();
    res.json({ ok: true, purged });
  } catch (err) {
    respondValidationError(res, err);
  }
});

// Achado do usuário: excluir loja é uma ação destrutiva demais pra só um
// clique + confirm() do navegador — exige reconfirmar a PRÓPRIA senha do
// admin logado (mesmo raciocínio de routes/cash.js#confirmPassword pro
// fechamento de caixa), contra um namespace de bloqueio por força bruta
// separado do login normal (ver lib/platformAdminAuth.js).
router.delete('/:slug', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) throw new Error('Informe sua senha pra confirmar a exclusão.');
    const confirmed = await verifyPlatformAdminPassword(req.platformAdmin?.username_lower, password);
    if (!confirmed) throw new Error('Senha incorreta.');
    const deleted = deleteTenant(req.params.slug);
    res.json({ tenant: publicTenant(deleted) });
  } catch (err) {
    respondValidationError(res, err);
  }
});

export default router;
