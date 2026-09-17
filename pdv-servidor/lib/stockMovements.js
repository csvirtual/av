// Achado de auditoria (DRY): registrar um movimento de estoque (mesmo
// formato de registro — id, productId, type, qty com sinal, userId,
// userName, note, timestamp) e persistir `product.quantity` já debitado/
// creditado eram exatamente a mesma dupla de operações copiada, com o
// mesmo texto de SQL, em routes/sales.js (venda/estorno) e
// routes/purchases.js (recebimento de compra) — cada arquivo com sua
// própria cópia da constante e da função. Fonte única agora.
//
// `saveProductAfterStockChange` NÃO grava `barcode` de propósito: sales.js
// e purchases.js nunca mudam o código de barras de um produto, só a
// quantidade — a versão de routes/products.js (que também atualiza
// barcode/nome/etc via cadastro) continua com sua própria query, mais
// ampla, porque faz um trabalho genuinamente diferente (edição completa do
// cadastro, não só débito/crédito de estoque).
const UPDATE_PRODUCT_QUANTITY_SQL = `
  UPDATE products SET name_lower = @nameLower, active = @active, updated_at = @updatedAt, data = @data WHERE id = @id
`;
export function saveProductAfterStockChange(product, targetDb) {
  targetDb.prepare(UPDATE_PRODUCT_QUANTITY_SQL).run({
    id: product.id, nameLower: product.nameLower, active: product.active ? 1 : 0,
    updatedAt: Date.now(), data: JSON.stringify(product),
  });
}

const INSERT_MOVEMENT_SQL = 'INSERT INTO stock_movements (id, product_id, timestamp, data) VALUES (@id, @productId, @timestamp, @data)';
export function recordStockMovement({ productId, type, qty, userId, userName, note }, targetDb) {
  const record = { id: crypto.randomUUID(), productId, type, qty, userId, userName, note: note || '', timestamp: Date.now() };
  targetDb.prepare(INSERT_MOVEMENT_SQL).run({ id: record.id, productId: record.productId, timestamp: record.timestamp, data: JSON.stringify(record) });
  return record;
}
