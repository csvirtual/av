// Fase 7 (log): leitura do log de auditoria (gravado por lib/audit.js).
// Acesso já gated pela permissão 'logs' no mount (server.js) — aqui só
// lista, com filtros simples (perfil, usuário, termo livre em ação/
// detalhes, intervalo de datas) e um limite, mais recente primeiro.
import { Router } from 'express';
import { db } from '../db/index.js';

const router = Router();

const listStmt = db.prepare('SELECT data FROM audit_log ORDER BY timestamp DESC');

router.get('/', (req, res) => {
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
