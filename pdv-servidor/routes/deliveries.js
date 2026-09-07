// Fase 6 (carreto): lista organizada do que precisa ser entregue pro
// cliente numa entrega — comum em loja de material de construção. É só um
// registro de controle/logística: NÃO mexe em estoque nem em dinheiro (a
// baixa de estoque de verdade já acontece na Venda) — o carreto só ajuda a
// organizar o que precisa sair, pra quem, e se já foi entregue ou não.
import { Router } from 'express';
import { db } from '../db/index.js';
import { broadcast } from '../lib/broadcast.js';

const router = Router();

const insertDeliveryStmt = db.prepare(`
  INSERT INTO deliveries (id, customer_id, status, created_at, data) VALUES (@id, @customerId, @status, @createdAt, @data)
`);
const updateDeliveryStmt = db.prepare('UPDATE deliveries SET status = @status, data = @data WHERE id = @id');
const getDeliveryStmt = db.prepare('SELECT * FROM deliveries WHERE id = ?');
const listDeliveriesStmt = db.prepare('SELECT data FROM deliveries ORDER BY created_at DESC');
const getCustomerStmt = db.prepare('SELECT data FROM customers WHERE id = ?');

function rowToDelivery(row) { return JSON.parse(row.data); }

router.get('/', (req, res) => {
  const status = req.query.status;
  let deliveries = listDeliveriesStmt.all().map(rowToDelivery);
  if (status) deliveries = deliveries.filter((d) => d.status === status);
  res.json({ deliveries });
});

router.post('/', (req, res) => {
  try {
    const customerRow = getCustomerStmt.get(req.body.customerId);
    if (!customerRow) throw new Error('Selecione um cliente para o carreto.');
    const customer = JSON.parse(customerRow.data);

    const items = (req.body.items || [])
      .map((item) => ({
        source: item.source === 'avulso' ? 'avulso' : 'estoque',
        productId: item.source === 'avulso' ? null : (item.productId || null),
        name: (item.name || '').trim(),
        unit: (item.unit || 'un').trim() || 'un',
        qty: Math.max(0, Number(item.qty) || 0),
      }))
      .filter((i) => i.name && i.qty > 0 && (i.source === 'avulso' || i.productId));
    if (items.length === 0) throw new Error('Adicione ao menos um item ao carreto.');

    const delivery = {
      id: crypto.randomUUID(),
      customerId: customer.id,
      customerName: customer.nome,
      items,
      address: (req.body.address || '').trim() || customer.endereco || '',
      responsible: (req.body.responsible || '').trim(),
      notes: (req.body.notes || '').trim(),
      status: 'pendente',
      saleId: req.body.saleId || null,
      createdBy: { userId: req.userId, userName: req.userName },
      createdAt: Date.now(),
      deliveredBy: null,
      deliveredAt: null,
    };
    insertDeliveryStmt.run({ id: delivery.id, customerId: delivery.customerId, status: delivery.status, createdAt: delivery.createdAt, data: JSON.stringify(delivery) });
    broadcast('deliveries-changed', { reason: 'created', id: delivery.id });
    res.status(201).json({ delivery });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// markDelivered/cancelar: a checagem "ainda está pendente?" e a gravação da
// transição de status acontecem na mesma transação — duas ações
// concorrentes sobre o mesmo carreto (marcar entregue e cancelar, em
// terminais diferentes) não conseguem as duas passar na checagem antes de
// qualquer uma gravar.
const commitTransition = db.transaction((input) => {
  const row = getDeliveryStmt.get(input.id);
  if (!row) throw new Error('Carreto não encontrado.');
  const delivery = rowToDelivery(row);
  if (delivery.status !== 'pendente') {
    throw new Error(input.newStatus === 'entregue' ? 'Este carreto não está mais pendente.' : 'Só é possível cancelar um carreto pendente.');
  }
  delivery.status = input.newStatus;
  if (input.newStatus === 'entregue') {
    delivery.deliveredBy = { userId: input.userId, userName: input.userName };
    delivery.deliveredAt = Date.now();
  }
  updateDeliveryStmt.run({ id: delivery.id, status: delivery.status, data: JSON.stringify(delivery) });
  return delivery;
});

router.post('/:id/entregar', (req, res) => {
  try {
    const delivery = commitTransition({ id: req.params.id, newStatus: 'entregue', userId: req.userId, userName: req.userName });
    broadcast('deliveries-changed', { reason: 'delivered', id: delivery.id });
    res.json({ delivery });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/cancelar', (req, res) => {
  try {
    const delivery = commitTransition({ id: req.params.id, newStatus: 'cancelado' });
    broadcast('deliveries-changed', { reason: 'cancelled', id: delivery.id });
    res.json({ delivery });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
