// Shim mínimo — só `newId()`, a única coisa que views/sale.js importa de
// db.js na extensão (usado ali como dedupeKey, não como chave real de
// IndexedDB — este servidor não tem IndexedDB nenhum, é só SQLite do lado
// do servidor). Existe só pra views/sale.js funcionar sem reescrever essa
// linha — mesma implementação de app/js/db.js#newId().
export function newId() {
  return crypto.randomUUID();
}
