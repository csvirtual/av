// Pedidos de compra: feitos a um fornecedor, com itens e quantidade
// pedida. O recebimento (total ou em várias entregas parciais) é o único
// jeito de dar entrada no estoque a partir de um pedido — reaproveita
// stockRepo.recordMovement (tipo 'entrada'), então o histórico do produto
// mostra de onde veio cada unidade, igual qualquer outra movimentação.
import { dbGetAll, dbAdd, dbUpdate, newId } from '../db.js';
import { listProducts, updateProduct } from './productsRepo.js';
import { recordMovement } from './stockRepo.js';
import { getSupplier } from './suppliersRepo.js';
// Achado de auditoria: create/receber/cancelar pedido de compra eram
// protegidos só pela TELA (rota "compras" restrita a admin, ver app.js) —
// reaproveita a mesma checagem de usersRepo.js pra não deixar essas funções
// aceitarem chamada direta de um vendedor com acesso ao console.
import { assertActingUserIsAdmin } from './usersRepo.js';

export async function listPurchaseOrders() {
  const orders = await dbGetAll('purchaseOrders');
  return orders.sort((a, b) => b.createdAt - a.createdAt);
}

export async function createPurchaseOrder({ supplierId, items, notes = '', userId, userName }) {
  await assertActingUserIsAdmin();
  if (!supplierId) throw new Error('Selecione um fornecedor.');
  const supplier = await getSupplier(supplierId);
  if (!supplier) throw new Error('Fornecedor não encontrado.');

  const orderItems = (items || [])
    .map((item) => ({
      productId: item.productId,
      name: item.name,
      unit: item.unit || 'un',
      qtyOrdered: Number(item.qty) || 0,
      qtyReceived: 0,
      unitCost: Math.max(0, Number(item.unitCost) || 0),
    }))
    .filter((i) => i.qtyOrdered > 0);
  if (orderItems.length === 0) throw new Error('O pedido precisa ter ao menos um item com quantidade.');

  const order = {
    id: newId(),
    supplierId,
    supplierName: supplier.nome,
    status: 'aberto', // 'aberto' | 'recebido_parcial' | 'recebido' | 'cancelado'
    items: orderItems,
    notes: notes.trim(),
    createdBy: { userId, userName },
    createdAt: Date.now(),
    receivedEntries: [],
  };
  await dbAdd('purchaseOrders', order);
  return order;
}

/** Registra o recebimento de mercadoria — total ou parcial, e pode
 * acontecer em várias entregas ao longo do tempo até o pedido fechar.
 * Atualiza o preço de custo do produto quando o custo informado no
 * recebimento vier diferente do que estava no pedido (o valor real da nota
 * do fornecedor é a fonte de verdade mais atual do custo).
 *
 * A validação de quanto ainda dá pra receber de cada item e o incremento
 * de `qtyReceived` acontecem dentro de um único dbUpdate (get+put na
 * mesma transação) — sem isso, dois recebimentos do mesmo pedido quase
 * juntos liam o mesmo estado "antes" e um podia sobrescrever o outro,
 * perdendo o registro de uma entrega mesmo o estoque já tendo sido
 * creditado por ela (mesma classe de problema já corrigida no estorno de
 * vendas). Crédito de estoque e atualização de custo continuam depois,
 * como efeito colateral — se algo falhar ali, o recebimento em si já está
 * gravado e validado, não fica "pela metade" de um jeito que permita
 * receber a mesma entrega duas vezes. */
export async function receivePurchaseOrder({ orderId, items, userId, userName, note = '' }) {
  await assertActingUserIsAdmin();
  let entry;
  let updatedOrder;
  await dbUpdate('purchaseOrders', orderId, (order) => {
    if (!order) throw new Error('Pedido não encontrado.');
    if (order.status === 'cancelado') throw new Error('Este pedido foi cancelado.');
    if (order.status === 'recebido') throw new Error('Este pedido já foi totalmente recebido.');

    const receivedItems = [];
    for (const req of items || []) {
      const qty = Number(req.qty) || 0;
      if (qty <= 0) continue;
      const orderItem = order.items.find((i) => i.productId === req.productId);
      if (!orderItem) throw new Error('Item não encontrado neste pedido.');
      const remaining = orderItem.qtyOrdered - orderItem.qtyReceived;
      if (qty > remaining) {
        throw new Error(`Só é possível receber até ${remaining} de "${orderItem.name}" (pedido: ${orderItem.qtyOrdered}, já recebido: ${orderItem.qtyReceived}).`);
      }
      const unitCost = req.unitCost !== undefined && req.unitCost !== null && req.unitCost !== '' ? Number(req.unitCost) : orderItem.unitCost;
      receivedItems.push({ productId: orderItem.productId, name: orderItem.name, qty, unitCost });
      orderItem.qtyReceived += qty;
      if (unitCost > 0) orderItem.unitCost = unitCost;
    }
    if (receivedItems.length === 0) throw new Error('Informe ao menos uma quantidade recebida.');

    entry = { id: newId(), timestamp: Date.now(), userId, userName, items: receivedItems, note: note.trim() };
    order.receivedEntries.push(entry);

    const fullyReceived = order.items.every((i) => i.qtyReceived >= i.qtyOrdered);
    const anyReceived = order.items.some((i) => i.qtyReceived > 0);
    order.status = fullyReceived ? 'recebido' : anyReceived ? 'recebido_parcial' : 'aberto';
    updatedOrder = order;
    return order;
  });

  for (const ri of entry.items) {
    await recordMovement({
      productId: ri.productId, type: 'entrada', qty: ri.qty,
      userId, userName, note: `Recebimento do pedido de compra — ${updatedOrder.supplierName}`,
    });
    if (ri.unitCost > 0) {
      await updateProduct(ri.productId, { costPrice: ri.unitCost });
    }
  }

  return { order: updatedOrder, entry };
}

/** dbUpdate garante que a checagem "ainda não recebeu nada" e a gravação
 * do cancelamento vejam o mesmo estado — sem isso, cancelar e receber o
 * mesmo pedido quase ao mesmo tempo (duas abas) podiam os dois passar na
 * validação antes de qualquer um gravar. */
export async function cancelPurchaseOrder(orderId) {
  await assertActingUserIsAdmin();
  return dbUpdate('purchaseOrders', orderId, (order) => {
    if (!order) throw new Error('Pedido não encontrado.');
    const anyReceived = order.items.some((i) => i.qtyReceived > 0);
    if (anyReceived) throw new Error('Não é possível cancelar um pedido que já teve itens recebidos.');
    return { ...order, status: 'cancelado' };
  });
}

/** Sugestão automática de compra: produtos ativos com estoque no mínimo ou
 * abaixo, agrupados pelo fornecedor padrão de cada um (produto sem
 * fornecedor cadastrado fica de fora — não tem pra quem sugerir o pedido).
 * Quantidade sugerida repõe até o dobro do estoque mínimo — só um ponto de
 * partida, editável livremente antes de confirmar o pedido. */
export async function suggestPurchasesBySupplier() {
  const products = await listProducts();
  const lowStock = products.filter((p) => p.active && p.supplierId && p.quantity <= p.minStock);
  const bySupplier = {};
  for (const p of lowStock) {
    if (!bySupplier[p.supplierId]) bySupplier[p.supplierId] = [];
    const target = Math.max(p.minStock * 2, p.minStock + 1);
    bySupplier[p.supplierId].push({
      productId: p.id, name: p.name, unit: p.unit,
      currentQty: p.quantity, minStock: p.minStock,
      suggestedQty: Math.max(1, target - p.quantity),
      unitCost: p.costPrice,
    });
  }
  return bySupplier;
}
