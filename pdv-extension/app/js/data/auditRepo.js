// Log de auditoria: toda ação relevante do sistema (login, logout, cadastro
// de empresa/usuário/produto, venda, ajuste de estoque etc.) fica registrada
// aqui com quem fez, qual perfil, e quando. Visível só para o Administrador
// Geral (a tela em views/logs.js já bloqueia o acesso; este módulo não
// impõe permissão — é só a camada de dados).
import { dbAdd, dbScanByIndex, newId } from '../db.js';

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

/** Lista paginada, pro Log do sistema — mesmo espírito
 * de listSalesPage() em salesRepo.js (ver dbScanByIndex em db.js): o
 * filtro de data já corta o índice de timestamp direto no banco; perfil,
 * usuário e termo de busca (sem índice pra texto livre) são conferidos
 * registro a registro durante a varredura, mas sem acumular a tabela
 * inteira num array nem desenhar tudo na tela de uma vez. */
export async function listAuditLogPage({ role, userId, term, fromTs, toTs, limit = 50, afterKey, afterId } = {}) {
  let range;
  if (fromTs != null && toTs != null) range = IDBKeyRange.bound(fromTs, toTs);
  else if (fromTs != null) range = IDBKeyRange.lowerBound(fromTs);
  else if (toTs != null) range = IDBKeyRange.upperBound(toTs);
  const termLower = term ? term.toLowerCase() : null;
  const matches = (l) => {
    if (role && l.role !== role) return false;
    if (userId && l.userId !== userId) return false;
    if (termLower && !`${l.action} ${l.details}`.toLowerCase().includes(termLower)) return false;
    return true;
  };
  return dbScanByIndex('auditLog', 'byTimestamp', { range, limit, afterKey, afterId, matches });
}
