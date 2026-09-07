// Log de auditoria: ações administrativas relevantes (login, gestão de
// usuários...) ficam registradas aqui com quem fez, qual perfil, e quando.
// Visível só a quem tem a permissão 'logs' (admin sempre tem) — ver
// routes/audit.js.
import { db } from '../db/index.js';

const insertStmt = db.prepare(`
  INSERT INTO audit_log (id, timestamp, user_id, data) VALUES (@id, @timestamp, @userId, @data)
`);

export function logAction({ userId, userName, role, action, details = '', entity = '', entityId = '' }) {
  const record = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    userId, userName, role, action, details, entity, entityId,
  };
  insertStmt.run({ id: record.id, timestamp: record.timestamp, userId: record.userId, data: JSON.stringify(record) });
  return record;
}
