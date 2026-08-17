// Histórico de movimentações de estoque: toda entrada, saída manual, ajuste
// ou venda que muda a quantidade de um produto fica registrada aqui, com
// quem fez e quando — é o que dá rastreabilidade além do log de auditoria
// (que registra a AÇÃO; isto aqui registra o EFEITO no estoque).
import { dbGetAllByIndex, dbAdd, newId } from '../db.js';
import { adjustQuantity } from './productsRepo.js';

/** type: 'entrada' | 'saida' | 'venda' | 'ajuste' */
export async function recordMovement({ productId, type, qty, userId, userName, note = '' }) {
  await adjustQuantity(productId, qty);
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
  await dbAdd('stockMovements', record);
  return record;
}

export async function listMovementsByProduct(productId) {
  const list = await dbGetAllByIndex('stockMovements', 'byProductId', productId);
  return list.sort((a, b) => b.timestamp - a.timestamp);
}
