// Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// listar lojas e mudar status/vencimento — a versão HTTP (painel de Super
// Admin) do que scripts/createTenant.js --set-status já fazia via CLI.
// Mesma função de verdade (control/db.js#setTenantStatus), nenhuma lógica
// duplicada — só um jeito novo (autenticado, pela rede) de chamá-la.
import { Router } from 'express';
import { listTenants, setTenantStatus, deleteTenant, VALID_TENANT_STATUSES } from '../../control/db.js';

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
    res.json({ tenant: publicTenant(updated) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:slug', (req, res) => {
  try {
    const deleted = deleteTenant(req.params.slug);
    res.json({ tenant: publicTenant(deleted) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
