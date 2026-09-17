// Shim mínimo — só o que as telas portadas importam de db.js na extensão,
// sem trazer o resto (IndexedDB nem existe aqui, é só SQLite do lado do
// servidor).
export function newId() {
  return crypto.randomUUID();
}

// `STORE_NAMES` — usado por views/backup.js só pra decidir a ORDEM e as
// LINHAS da tabela "o que vai ser substituído" (ver countsTableHtml lá),
// nunca como chave de IndexedDB de verdade. Mesma lista de app/js/db.js da
// extensão (as 15 "gavetas" do backup dela), MAIS `storeCredits` no final —
// crédito de troca cross-terminal (tabela `store_credits`, ver lib/
// backup.js), um conceito que só existe neste servidor multi-terminal, sem
// equivalente na extensão single-machine.
export const STORE_NAMES = [
  'company', 'users', 'products', 'sales', 'stockMovements', 'auditLog',
  'cashSessions', 'cashMovements', 'customers', 'customerDebts',
  'suppliers', 'purchaseOrders', 'financialEntries', 'loyaltyEntries',
  'deliveries', 'storeCredits',
];
