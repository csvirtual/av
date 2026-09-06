// Pedidos de compra: feitos a um fornecedor, com itens e quantidade
// pedida. O recebimento (total ou em várias entregas parciais) é o único
// jeito de dar entrada no estoque a partir de um pedido — reaproveita
// stockRepo.recordMovement (tipo 'entrada'), então o histórico do produto
// mostra de onde veio cada unidade, igual qualquer outra movimentação.
import { dbGetAll, dbAdd, dbUpdate, dbTransaction, claimIdempotencyKey, newId } from '../db.js';
import { listProducts } from './productsRepo.js';
import { getSupplier } from './suppliersRepo.js';
import { displayUnit, formatQty } from '../utils/format.js';
const CUSTOM_UNIT_VALUE = 'personalizado';
// Achado de auditoria: create/receber/cancelar pedido de compra eram
// protegidos só pela TELA (rota "compras" restrita a admin, ver app.js) —
// reaproveita a mesma checagem de usersRepo.js pra não deixar essas funções
// aceitarem chamada direta de um vendedor com acesso ao console.
import { assertActingUserHasPermission } from './usersRepo.js';

export async function listPurchaseOrders() {
  const orders = await dbGetAll('purchaseOrders');
  return orders.sort((a, b) => b.createdAt - a.createdAt);
}

export async function createPurchaseOrder({ supplierId, items, notes = '', userId, userName }) {
  await assertActingUserHasPermission('compras');
  if (!supplierId) throw new Error('Selecione um fornecedor.');
  const supplier = await getSupplier(supplierId);
  if (!supplier) throw new Error('Fornecedor não encontrado.');

  // Achado de auditoria (P1): `Number(item.qty) || 0` bloqueia negativo e
  // NaN, mas não `Infinity` (sobrevive ao `|| 0` por ser um valor
  // "verdadeiro" em JS) — um `qtyOrdered: Infinity` aqui fazia o guard
  // "não pode receber mais que o pedido" de receivePurchaseOrder falhar
  // (`Infinity > Infinity` é `false`), permitindo corromper `quantity`/
  // `costPrice` do produto pra sempre no recebimento. `Number.isFinite`
  // fecha os dois lados de uma vez.
  const orderItems = (items || [])
    .map((item) => {
      const qtyOrdered = Number(item.qty);
      const unitCost = Number(item.unitCost);
      return {
        productId: item.productId,
        name: item.name,
        unit: item.unit || 'un',
        qtyOrdered: Number.isFinite(qtyOrdered) ? qtyOrdered : 0,
        qtyReceived: 0,
        unitCost: Number.isFinite(unitCost) ? Math.max(0, unitCost) : 0,
      };
    })
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
 * A validação de quanto ainda dá pra receber de cada item, o incremento de
 * `qtyReceived`, o crédito de estoque (produto + movimentação) E a
 * atualização do preço de custo acontecem dentro de UMA ÚNICA transação do
 * IndexedDB cobrindo `purchaseOrders`, `products` e `stockMovements` —
 * mesmo padrão de createSale()/refundSaleItems() em data/salesRepo.js.
 *
 * Achado de auditoria extrema (pré-lançamento): antes, o recebimento do
 * pedido em si já era atômico (get+put na mesma transação, evitando o
 * "lost update" de dois recebimentos quase simultâneos do mesmo pedido),
 * mas o crédito de estoque e a atualização de custo aconteciam DEPOIS, em
 * chamadas separadas — exatamente a mesma classe de problema já corrigida
 * no estorno de vendas: se o navegador fechasse/travasse bem entre o
 * pedido já marcado como recebido e essas chamadas terminarem, o pedido
 * ficava corretamente marcado (não dava pra receber a mesma entrega duas
 * vezes), mas o estoque do produto não refletia a mercadoria que já tinha
 * chegado de verdade — o sistema mostraria menos estoque do que a loja
 * fisicamente tem, o oposto do problema mais comum (vender sem ter). */
// Achado de auditoria (P2, dinheiro/estoque não pode ter brecha): o guard
// "não pode receber mais que o pedido" já bloqueava um valor MAIOR que o
// que resta — mas não uma submissão DUPLICADA de exatamente a mesma
// entrega (ex: uma chamada repetida sem passar pela tela). `dedupeKey`
// (opcional, gerada uma vez por abertura do modal de recebimento) fecha
// isso: a mesma chave só pode ser usada uma vez, verificado dentro da
// MESMA transação atômica (ver db.js#claimIdempotencyKey).
export async function receivePurchaseOrder({ orderId, items, userId, userName, note = '', dedupeKey }) {
  await assertActingUserHasPermission('compras');
  let entry;
  let updatedOrder;
  let receiveError = null;

  try {
    await dbTransaction(['purchaseOrders', 'products', 'stockMovements', 'idempotencyKeys'], 'readwrite', (transaction) => {
    const ordersStore = transaction.objectStore('purchaseOrders');
    const productsStore = transaction.objectStore('products');
    const movementsStore = transaction.objectStore('stockMovements');

    const fail = (message) => {
      receiveError = message;
      try { transaction.abort(); } catch { /* já pode não ter requisição pendente */ }
    };

    claimIdempotencyKey(transaction, dedupeKey, () => fail('Este recebimento já foi registrado — evite reenviar.'));

    const getOrderReq = ordersStore.get(orderId);
    getOrderReq.onsuccess = () => {
      const order = getOrderReq.result;
      if (!order) { fail('Pedido não encontrado.'); return; }
      if (order.status === 'cancelado') { fail('Este pedido foi cancelado.'); return; }
      if (order.status === 'recebido') { fail('Este pedido já foi totalmente recebido.'); return; }

      // Achado de auditoria (P1): `Number(req.qty) || 0` não barra
      // `Infinity` — se `orderItem.qtyOrdered` também fosse `Infinity` (ver
      // createPurchaseOrder, já corrigido), `qty > remaining` virava
      // `Infinity > Infinity` (`false`, não bloqueia), creditando
      // `product.quantity`/`costPrice` como `Infinity` pra sempre logo
      // abaixo. `Number.isFinite` nos dois lados fecha isso mesmo que uma
      // das duas pontas já esteja corrigida. `unitCost` do recebimento
      // (achado P3 à parte) também não tinha `Math.max(0, ...)`/
      // `Number.isFinite` — um valor negativo ou NaN aqui não corrompia o
      // custo ATIVO do produto (o guard `unitCost > 0` na linha de baixo já
      // protegia isso), mas ficava gravado pra sempre no extrato imutável
      // de recebimento (`receivedEntries`, sem função de exclusão).
      const receivedItems = [];
      for (const req of items || []) {
        const qty = Number(req.qty);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const orderItem = order.items.find((i) => i.productId === req.productId);
        if (!orderItem) { fail('Item não encontrado neste pedido.'); return; }
        const remaining = orderItem.qtyOrdered - orderItem.qtyReceived;
        if (!Number.isFinite(remaining) || qty > remaining) {
          fail(`Só é possível receber até ${formatQty(remaining)} de "${orderItem.name}" (pedido: ${formatQty(orderItem.qtyOrdered)}, já recebido: ${formatQty(orderItem.qtyReceived)}).`);
          return;
        }
        let unitCost = orderItem.unitCost;
        if (req.unitCost !== undefined && req.unitCost !== null && req.unitCost !== '') {
          const parsedCost = Number(req.unitCost);
          unitCost = Number.isFinite(parsedCost) ? Math.max(0, parsedCost) : orderItem.unitCost;
        }
        receivedItems.push({ productId: orderItem.productId, name: orderItem.name, qty, unitCost });
        orderItem.qtyReceived += qty;
        if (unitCost > 0) orderItem.unitCost = unitCost;
      }
      if (receivedItems.length === 0) { fail('Informe ao menos uma quantidade recebida.'); return; }

      entry = { id: newId(), timestamp: Date.now(), userId, userName, items: receivedItems, note: note.trim() };
      order.receivedEntries.push(entry);

      const fullyReceived = order.items.every((i) => i.qtyReceived >= i.qtyOrdered);
      const anyReceived = order.items.some((i) => i.qtyReceived > 0);
      order.status = fullyReceived ? 'recebido' : anyReceived ? 'recebido_parcial' : 'aberto';
      updatedOrder = order;

      // Credita o estoque (e o custo) de cada item recebido — sequencial,
      // mesmo raciocínio de createSale()/refundSaleItems(): se o mesmo
      // produto aparecer mais de uma vez, a leitura seguinte precisa
      // enxergar o efeito da anterior.
      function creditItem(idx) {
        if (idx >= receivedItems.length) {
          ordersStore.put(order);
          return;
        }
        const ri = receivedItems[idx];
        const getProductReq = productsStore.get(ri.productId);
        getProductReq.onsuccess = () => {
          const product = getProductReq.result;
          if (!product) {
            fail(`Produto de "${ri.name}" não existe mais no catálogo — não foi possível creditar o estoque recebido.`);
            return;
          }
          // Achado de auditoria: produto 'personalizado' não tem UM
          // costPrice — cada forma de venda tem o seu próprio custo (ver
          // data/productsRepo.js#resolveCustomUnitFields), e o campo
          // `costPrice` no registro do produto fica travado em 0 pra sempre
          // por esse motivo. Sem este `unit !== CUSTOM_UNIT_VALUE`, receber
          // um pedido de compra desse tipo de produto (a busca de item do
          // pedido não filtra por unidade — dá pra escolher qualquer
          // produto) com um custo unitário digitado corrompia esse 0 pra um
          // valor solto, violando a garantia documentada ali (o número não
          // representa nada — não existe onde exibi-lo de propósito — mas
          // ficava gravado e sobrevivia a esse recebimento).
          productsStore.put({
            ...product,
            quantity: product.quantity + ri.qty,
            costPrice: product.unit === CUSTOM_UNIT_VALUE ? product.costPrice : (ri.unitCost > 0 ? ri.unitCost : product.costPrice),
            updatedAt: Date.now(),
          });
          movementsStore.add({
            id: newId(), productId: ri.productId, type: 'entrada', qty: ri.qty,
            userId, userName, note: `Recebimento do pedido de compra — ${order.supplierName}`, timestamp: Date.now(),
          });
          creditItem(idx + 1);
        };
      }
      creditItem(0);
    };
    });
  } catch (err) {
    throw new Error(receiveError || err.message);
  }

  return { order: updatedOrder, entry };
}

/** dbUpdate garante que a checagem "ainda não recebeu nada" e a gravação
 * do cancelamento vejam o mesmo estado — sem isso, cancelar e receber o
 * mesmo pedido quase ao mesmo tempo (duas abas) podiam os dois passar na
 * validação antes de qualquer um gravar. */
export async function cancelPurchaseOrder(orderId) {
  await assertActingUserHasPermission('compras');
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
      productId: p.id, name: p.name, unit: displayUnit(p),
      currentQty: p.quantity, minStock: p.minStock,
      suggestedQty: Math.max(1, target - p.quantity),
      unitCost: p.costPrice,
    });
  }
  return bySupplier;
}
