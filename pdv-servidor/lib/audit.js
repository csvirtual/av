// Log de auditoria: ações administrativas relevantes (login, gestão de
// usuários...) ficam registradas aqui com quem fez, qual perfil, e quando.
// Visível só a quem tem a permissão 'logs' (admin sempre tem) — ver
// routes/audit.js.
import { db } from '../db/index.js';

const INSERT_SQL = `
  INSERT INTO audit_log (id, timestamp, user_id, data) VALUES (@id, @timestamp, @userId, @data)
`;

// `targetDb` opcional em todo este arquivo (etapa 5 do roteiro multi-tenant,
// ver artifact "PDV Multi-Tenant") — normalmente req.db, resolvido pelo
// tenant da requisição. Sem ele (todo call site de hoje), grava no banco
// fixo do processo, comportamento idêntico a sempre.
export function logAction({ userId, userName, role, action, details = '', entity = '', entityId = '' }, targetDb = db) {
  const record = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    userId, userName, role, action, details, entity, entityId,
  };
  targetDb.prepare(INSERT_SQL).run({ id: record.id, timestamp: record.timestamp, userId: record.userId, data: JSON.stringify(record) });
  return record;
}
