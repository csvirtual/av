// Log de auditoria: toda ação relevante do sistema (login, logout, cadastro
// de empresa/usuário/produto, venda, ajuste de estoque etc.) fica registrada
// aqui com quem fez, qual perfil, e quando. Visível só para o Administrador
// Geral (a tela em views/logs.js já bloqueia o acesso; este módulo não
// impõe permissão — é só a camada de dados).
import { dbGetAll, dbAdd, newId } from '../db.js';

export async function logAction({ userId, userName, role, action, details = '', entity = '', entityId = '' }) {
  const record = {
    id: newId(),
    timestamp: Date.now(),
    userId,
    userName,
    role,
    action,
    details,
    entity,
    entityId,
  };
  await dbAdd('auditLog', record);
  return record;
}

export async function listAuditLog() {
  const log = await dbGetAll('auditLog');
  return log.sort((a, b) => b.timestamp - a.timestamp);
}
