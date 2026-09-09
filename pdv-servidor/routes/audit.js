// Fase 7 (log): leitura do log de auditoria (gravado por lib/audit.js).
// Fase 9: grava também — client-side data/auditRepo.js#logAction (mesmo
// contrato de app/js/data/auditRepo.js da extensão) chama POST / depois
// de cada mutação bem-sucedida nas telas portadas (produtos, estoque...),
// mesmo padrão da extensão (a VIEW loga, não o repositório de dados —
// nenhum manageProducts/adjustStock etc. exige nem impõe log próprio).
//
// Permissão: só GET (leitura, ver views/logs.js) exige 'logs' — POST fica
// aberto a qualquer usuário autenticado (é só o registro de uma ação que
// já passou pelo gate certo em outro repositório, não uma ação nova em si
// — mesmo raciocínio do logAction() da extensão, sem permissão própria).
import { Router } from 'express';
import { db } from '../db/index.js';
import { requirePermission } from '../lib/permissions.js';
import { logAction } from '../lib/audit.js';

const router = Router();

const listStmt = db.prepare('SELECT data FROM audit_log ORDER BY timestamp DESC');

// userId/userName/role NUNCA vêm do corpo do pedido — sempre resolvidos
// da sessão de verdade (req.userId/req.userName/req.userRole, ver
// server.js), mesmo princípio de "nunca confiar em quem está chamando"
// já aplicado em toda rota sensível deste servidor. action/details/
// entity/entityId são descritivos (o que aconteceu), sem risco de
// autorização — guardados como o cliente mandou, escapados só na hora de
// EXIBIR (mesmo padrão de views/logs.js da extensão via escapeHtml).
router.post('/', (req, res) => {
  const body = req.body || {};
  const record = logAction({
    userId: req.userId, userName: req.userName, role: req.userRole,
    action: String(body.action || ''), details: String(body.details || ''),
    entity: String(body.entity || ''), entityId: String(body.entityId || ''),
  });
  res.status(201).json({ entry: record });
});

router.get('/', requirePermission('logs'), (req, res) => {
  const { role, userId, term, fromTs, toTs, limit = 100 } = req.query;
  const lim = Math.min(500, Number(limit) || 100);
  const termLower = term ? String(term).toLowerCase() : null;

  let entries = listStmt.all().map((r) => JSON.parse(r.data));
  if (role) entries = entries.filter((e) => e.role === role);
  if (userId) entries = entries.filter((e) => e.userId === userId);
  if (fromTs) entries = entries.filter((e) => e.timestamp >= Number(fromTs));
  if (toTs) entries = entries.filter((e) => e.timestamp <= Number(toTs));
  if (termLower) entries = entries.filter((e) => `${e.action} ${e.details}`.toLowerCase().includes(termLower));

  res.json({ entries: entries.slice(0, lim), total: entries.length });
});

export default router;
