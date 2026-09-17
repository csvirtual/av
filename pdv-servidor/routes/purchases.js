// Fase 5 (compras): pedido de compra a um fornecedor, com recebimento total
// ou em várias entregas parciais. O recebimento é o único jeito de dar
// entrada no estoque a partir de um pedido — credita quantity e (quando o
// custo informado vier diferente) costPrice do produto, tudo na MESMA
// transação atômica do pedido em si (mesmo padrão de routes/sales.js:
// checar quanto ainda cabe receber, marcar recebido e creditar estoque não
// podem ser passos separados — um recebimento marcado sem o estoque
// realmente creditado deixaria o sistema mostrando menos do que a loja tem
// fisicamente na prateleira).
import { Router } from 'express';
import { db, claimIdempotencyKey } from '../db/index.js';
import { broadcast } from '../lib/broadcast.js';

const router = Router();

const CUSTOM_UNIT_VALUE = 'personalizado';

// Etapa 5 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): SQL
// como texto, não mais prepared statements pré-montados — cada handler
// prepara contra `req.db`, sempre já resolvido pro banco certo (o da
// loja, ou o banco fixo do processo em modo legado) — server.js#tenant
// resolution middleware é a ÚNICA fonte dessa decisão agora, nenhuma
// rota mais precisa repetir o fallback.
const INSERT_ORDER_SQL = `
  INSERT INTO purchase_orders (id, supplier_id, status, created_at, data) VALUES (@id, @supplierId, @status, @createdAt, @data)
`;
const UPDATE_ORDER_SQL = 'UPDATE purchase_orders SET status = @status, data = @data WHERE id = @id';
const GET_ORDER_SQL = 'SELECT * FROM purchase_orders WHERE id = ?';
const LIST_ORDERS_SQL = 'SELECT data FROM purchase_orders ORDER BY created_at DESC';
const GET_SUPPLIER_SQL = 'SELECT data FROM suppliers WHERE id = ?';
const GET_PRODUCT_SQL = 'SELECT * FROM products WHERE id = ?';
const UPDATE_PRODUCT_SQL = `
  UPDATE products SET name_lower = @nameLower, active = @active, updated_at = @updatedAt, data = @data WHERE id = @id
`;
const LIST_ACTIVE_PRODUCTS_SQL = 'SELECT data FROM products WHERE active = 1';
// Achado de auditoria (P1, Red Team, Fase 7): recebimento de compra creditava
// `product.quantity` direto (saveProduct) sem nunca gravar em
// `stock_movements` — mesma classe de furo já corrigida em routes/sales.js
// (venda/estorno). Mesmo formato de registro, gravado dentro da MESMA
// transação do recebimento.
const INSERT_MOVEMENT_SQL = 'INSERT INTO stock_movements (id, product_id, timestamp, data) VALUES (@id, @productId, @timestamp, @data)';
function recordStockMovement({ productId, type, qty, userId, userName, note }, targetDb) {
  const record = { id: crypto.randomUUID(), productId, type, qty, userId, userName, note: note || '', timestamp: Date.now() };
  targetDb.prepare(INSERT_MOVEMENT_SQL).run({ id: record.id, productId: record.productId, timestamp: record.timestamp, data: JSON.stringify(record) });
}

function rowToOrder(row) { return JSON.parse(row.data); }
function rowToProduct(row) { return JSON.parse(row.data); }
function saveProduct(product, targetDb) {
  targetDb.prepare(UPDATE_PRODUCT_SQL).run({
    id: product.id, nameLower: product.nameLower, active: product.active ? 1 : 0,
    updatedAt: Date.now(), data: JSON.stringify(product),
  });
}
function formatQty(n) { return Number(n).toString(); }

router.get('/', (req, res) => {
  res.json({ orders: req.db.prepare(LIST_ORDERS_SQL).all().map(rowToOrder) });
});

router.get('/:id', (req, res) => {
  const row = req.db.prepare(GET_ORDER_SQL).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Pedido não encontrado.' });
  res.json({ order: rowToOrder(row) });
});

router.post('/', (req, res) => {
  try {
    const targetDb = req.db;
    const supplierRow = targetDb.prepare(GET_SUPPLIER_SQL).get(req.body.supplierId);
    if (!supplierRow) throw new Error('Selecione um fornecedor.');
    const supplier = JSON.parse(supplierRow.data);

    const orderItems = (req.body.items || [])
      .map((item) => {
        const qtyOrdered = Number(item.qty);
        const unitCost = Number(item.unitCost);
        return {
          productId: item.productId, name: item.name, unit: item.unit || 'un',
          qtyOrdered: Number.isFinite(qtyOrdered) ? qtyOrdered : 0,
          qtyReceived: 0,
          unitCost: Number.isFinite(unitCost) ? Math.max(0, unitCost) : 0,
        };
      })
      .filter((i) => i.qtyOrdered > 0);
    if (orderItems.length === 0) throw new Error('O pedido precisa ter ao menos um item com quantidade.');

    const order = {
      id: crypto.randomUUID(),
      supplierId: supplier.id,
      supplierName: supplier.nome,
      status: 'aberto',
      items: orderItems,
      notes: (req.body.notes || '').trim(),
      createdBy: { userId: req.userId, userName: req.userName },
      createdAt: Date.now(),
      receivedEntries: [],
    };
    targetDb.prepare(INSERT_ORDER_SQL).run({ id: order.id, supplierId: order.supplierId, status: order.status, createdAt: order.createdAt, data: JSON.stringify(order) });
    broadcast('purchases-changed', { reason: 'created', id: order.id }, req.tenantId);
    res.status(201).json({ order });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function commitReceive(input, targetDb) {
  return targetDb.transaction(() => {
    // Achado de auditoria (P2): dedupeKey agora é obrigatória — ver
    // routes/deliveries.js#commitDelivery pro raciocínio completo.
    claimIdempotencyKey(input.dedupeKey, targetDb);
    const row = targetDb.prepare(GET_ORDER_SQL).get(input.orderId);
    if (!row) throw new Error('Pedido não encontrado.');
    const order = rowToOrder(row);
    if (order.status === 'cancelado') throw new Error('Este pedido foi cancelado.');
    if (order.status === 'recebido') throw new Error('Este pedido já foi totalmente recebido.');

    const receivedItems = [];
    for (const reqItem of input.items || []) {
      const qty = Number(reqItem.qty);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const orderItem = order.items.find((i) => i.productId === reqItem.productId);
      if (!orderItem) throw new Error('Item não encontrado neste pedido.');
      const remaining = orderItem.qtyOrdered - orderItem.qtyReceived;
      if (!Number.isFinite(remaining) || qty > remaining) {
        throw new Error(`Só é possível receber até ${formatQty(remaining)} de "${orderItem.name}" (pedido: ${formatQty(orderItem.qtyOrdered)}, já recebido: ${formatQty(orderItem.qtyReceived)}).`);
      }
      let unitCost = orderItem.unitCost;
      if (reqItem.unitCost !== undefined && reqItem.unitCost !== null && reqItem.unitCost !== '') {
        const parsedCost = Number(reqItem.unitCost);
        unitCost = Number.isFinite(parsedCost) ? Math.max(0, parsedCost) : orderItem.unitCost;
      }
      receivedItems.push({ productId: orderItem.productId, name: orderItem.name, qty, unitCost });
      orderItem.qtyReceived += qty;
      if (unitCost > 0) orderItem.unitCost = unitCost;
    }
    if (receivedItems.length === 0) throw new Error('Informe ao menos uma quantidade recebida.');

    const entry = { id: crypto.randomUUID(), timestamp: Date.now(), userId: input.userId, userName: input.userName, items: receivedItems, note: (input.note || '').trim() };
    order.receivedEntries.push(entry);

    const fullyReceived = order.items.every((i) => i.qtyReceived >= i.qtyOrdered);
    const anyReceived = order.items.some((i) => i.qtyReceived > 0);
    order.status = fullyReceived ? 'recebido' : anyReceived ? 'recebido_parcial' : 'aberto';

    for (const ri of receivedItems) {
      const productRow = targetDb.prepare(GET_PRODUCT_SQL).get(ri.productId);
      if (!productRow) throw new Error(`Produto de "${ri.name}" não existe mais no catálogo — não foi possível creditar o estoque recebido.`);
      const product = rowToProduct(productRow);
      product.quantity += ri.qty;
      // Achado de auditoria (Fase 9, ao ligar views/compras.js): faltava
      // aqui a mesma trava que purchasesRepo.js#receivePurchaseOrder da
      // extensão já tem — produto 'personalizado' não tem UM costPrice (cada
      // forma de venda tem o seu próprio custo, ver
      // routes/products.js#resolveCustomUnitFields), e o campo costPrice do
      // registro do produto fica travado em 0 pra sempre por esse motivo.
      // Sem este `unit !== CUSTOM_UNIT_VALUE`, receber um pedido desse tipo
      // de produto com um custo unitário digitado corrompia esse 0 pra um
      // valor solto, sem onde exibi-lo de propósito — mas sobrevivendo ao
      // recebimento. Furo pré-existente desde a Fase 5, só nunca alcançável
      // por UI nenhuma até esta tela ser ligada.
      if (product.unit !== CUSTOM_UNIT_VALUE && ri.unitCost > 0) product.costPrice = ri.unitCost;
      saveProduct(product, targetDb);
      recordStockMovement({ productId: product.id, type: 'compra', qty: ri.qty, userId: input.userId, userName: input.userName, note: `Recebimento do pedido ${order.id} (entrega ${entry.id})` }, targetDb);
    }

    targetDb.prepare(UPDATE_ORDER_SQL).run({ id: order.id, status: order.status, data: JSON.stringify(order) });
    return { order, entry };
  })();
}

router.post('/:id/receber', (req, res) => {
  try {
    const { order, entry } = commitReceive({ ...req.body, orderId: req.params.id, userId: req.userId, userName: req.userName }, req.db);
    broadcast('purchases-changed', { reason: 'received', id: order.id }, req.tenantId);
    broadcast('products-changed', { reason: 'purchase-received' }, req.tenantId);
    res.json({ order, entry });
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed: idempotency_keys')) {
      return res.status(409).json({ error: 'Este recebimento já foi registrado — evite reenviar.' });
    }
    res.status(400).json({ error: err.message });
  }
});

function commitCancel(orderId, targetDb) {
  return targetDb.transaction(() => {
    const row = targetDb.prepare(GET_ORDER_SQL).get(orderId);
    if (!row) throw new Error('Pedido não encontrado.');
    const order = rowToOrder(row);
    const anyReceived = order.items.some((i) => i.qtyReceived > 0);
    if (anyReceived) throw new Error('Não é possível cancelar um pedido que já teve itens recebidos.');
    order.status = 'cancelado';
    targetDb.prepare(UPDATE_ORDER_SQL).run({ id: order.id, status: order.status, data: JSON.stringify(order) });
    return order;
  })();
}

router.post('/:id/cancelar', (req, res) => {
  try {
    const order = commitCancel(req.params.id, req.db);
    broadcast('purchases-changed', { reason: 'cancelled', id: order.id }, req.tenantId);
    res.json({ order });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Sugestão automática de compra: produtos ativos com estoque no mínimo ou
 * abaixo, agrupados pelo fornecedor padrão de cada um (sem fornecedor
 * cadastrado fica de fora — não tem pra quem sugerir o pedido). Quantidade
 * sugerida repõe até o dobro do estoque mínimo — só um ponto de partida,
 * editável livremente antes de confirmar o pedido. */
router.get('/sugestoes/por-fornecedor', (req, res) => {
  const products = req.db.prepare(LIST_ACTIVE_PRODUCTS_SQL).all().map(rowToProduct);
  const lowStock = products.filter((p) => p.supplierId && p.quantity <= p.minStock);
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
  res.json({ bySupplier });
});

export default router;
