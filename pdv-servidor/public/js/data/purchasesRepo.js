// Pedidos de compra — versão multi-terminal, mesmo contrato de
// app/js/data/purchasesRepo.js da extensão single-machine. Toda a
// atomicidade (recebimento credita estoque+custo na MESMA transação do
// pedido, cancelamento reconfere "ainda não recebeu nada" antes de gravar)
// já existia pronta no servidor desde a Fase 5 (ver routes/purchases.js) —
// esta é só a camada de tradução HTTP, igual suppliersRepo.js.
import { api } from './apiClient.js';

export async function listPurchaseOrders() {
  const { orders } = await api('/api/purchases');
  return orders;
}

/** userId/userName aceitos só pra bater a assinatura da extensão — o
 * servidor sempre resolve quem criou pela sessão de verdade (mesmo motivo
 * de auditRepo.js#logAction e cashRepo.js#openSession), nunca pelo que o
 * cliente afirma. */
export async function createPurchaseOrder({ supplierId, items, notes = '', userId, userName }) {
  void userId; void userName;
  const { order } = await api('/api/purchases', {
    method: 'POST',
    body: JSON.stringify({ supplierId, items, notes }),
  });
  return order;
}

export async function receivePurchaseOrder({ orderId, items, userId, userName, note = '', dedupeKey }) {
  void userId; void userName;
  const { order, entry } = await api(`/api/purchases/${encodeURIComponent(orderId)}/receber`, {
    method: 'POST',
    body: JSON.stringify({ items, note, dedupeKey }),
  });
  return { order, entry };
}

export async function cancelPurchaseOrder(orderId) {
  const { order } = await api(`/api/purchases/${encodeURIComponent(orderId)}/cancelar`, { method: 'POST' });
  return order;
}

export async function suggestPurchasesBySupplier() {
  const { bySupplier } = await api('/api/purchases/sugestoes/por-fornecedor');
  return bySupplier;
}
