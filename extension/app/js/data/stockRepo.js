// Histórico de movimentações de estoque: toda entrada, saída manual, ajuste
// ou venda que muda a quantidade de um produto fica registrada aqui, com
// quem fez e quando — é o que dá rastreabilidade além do log de auditoria
// (que registra a AÇÃO; isto aqui registra o EFEITO no estoque).
import { dbGetAllByIndex, dbTransaction, newId } from '../db.js';

/** Achado de auditoria (P1): a versão anterior ajustava a quantidade do
 * produto (um dbUpdate, atômico só pra `products`) e DEPOIS, numa
 * transação SEPARADA, gravava o registro em `stockMovements` —
 * exatamente o padrão que qualquer auditoria de estoque deveria caçar:
 * "estoque é atualizado MAS a movimentação histórica falha". Se o
 * navegador fechasse/travasse bem entre as duas escritas, a quantidade
 * do produto já tinha mudado, mas NENHUM registro explicava a mudança —
 * nem pra entrada de compra, nem pra ajuste manual, nem pro crédito de
 * estoque de um estorno (todos passam por esta função). Agora as duas
 * escritas (baixa/alta de quantidade + registro da movimentação) vivem
 * na MESMA transação — mesmo padrão já usado em createSale() pro
 * caminho principal de venda. */
export async function recordMovement({ productId, type, qty, userId, userName, note = '' }) {
  const record = {
    id: newId(),
    productId,
    type,
    qty, // positivo = entrada, negativo = saída
    userId,
    userName,
    note,
    timestamp: Date.now(),
  };
  let adjustError = null;
  await dbTransaction(['products', 'stockMovements'], 'readwrite', (transaction) => {
    const productsStore = transaction.objectStore('products');
    const movementsStore = transaction.objectStore('stockMovements');
    const getReq = productsStore.get(productId);
    getReq.onsuccess = () => {
      const product = getReq.result;
      if (!product) {
        adjustError = 'Produto não encontrado.';
        return;
      }
      const newQuantity = product.quantity + qty;
      if (newQuantity < 0) {
        adjustError = `Estoque insuficiente de "${product.name}".`;
        return;
      }
      productsStore.put({ ...product, quantity: newQuantity, updatedAt: Date.now() });
      movementsStore.add(record);
    };
  });
  if (adjustError) throw new Error(adjustError);
  return record;
}

export async function listMovementsByProduct(productId) {
  const list = await dbGetAllByIndex('stockMovements', 'byProductId', productId);
  return list.sort((a, b) => b.timestamp - a.timestamp);
}
