// Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// listar lojas e mudar status/vencimento — a versão HTTP (painel de Super
// Admin) do que scripts/createTenant.js --set-status já fazia via CLI.
// Mesma função de verdade (control/db.js#setTenantStatus), nenhuma lógica
// duplicada — só um jeito novo (autenticado, pela rede) de chamá-la.
import { Router } from 'express';
import {
  listTenants, setTenantStatus, deleteTenant, VALID_TENANT_STATUSES,
  listTrashedTenants, restoreTenant, purgeTrashedTenant,
} from '../../control/db.js';
import { verifyPlatformAdminPassword } from '../../lib/platformAdminAuth.js';
import { getTenantDb } from '../../db/index.js';
import { restartTrial } from '../../lib/licenseState.js';

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
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
  }
});

// Lixeira: lojas excluídas cuja pasta ainda não foi apagada de verdade
// (ver control/db.js#deleteTenant) — listar e restaurar. Caminhos literais
// ("/lixeira", "/lixeira/:entry/restore") nunca colidem com "/:slug" ou
// "/:slug/status" acima porque o Express casa por método + padrão
// completo, não só o primeiro segmento.
router.get('/lixeira', (req, res) => {
  res.json({ trashed: listTrashedTenants() });
});

router.post('/lixeira/:entry/restore', (req, res) => {
  try {
    const restored = restoreTenant(req.params.entry);
    res.json({ tenant: publicTenant(restored) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Exclusão DEFINITIVA — mesma reconfirmação de senha do DELETE /:slug
// acima (namespace de bloqueio compartilhado entre as duas: são a mesma
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
    res.status(400).json({ error: err.message });
  }
});

export default router;
