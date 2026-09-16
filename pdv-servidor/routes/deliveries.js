// Fase 6 (carreto): lista organizada do que precisa ser entregue pro
// cliente numa entrega — comum em loja de material de construção. É só um
// registro de controle/logística: NÃO mexe em estoque nem em dinheiro (a
// baixa de estoque de verdade já acontece na Venda) — o carreto só ajuda a
// organizar o que precisa sair, pra quem, e se já foi entregue ou não.
import { Router } from 'express';
import { db } from '../db/index.js';
import { broadcast } from '../lib/broadcast.js';

const router = Router();

// Etapa 5 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): SQL
// como texto, não mais prepared statements pré-montados — cada handler
// prepara contra `req.db || db` (o tenant da requisição, com o banco fixo
// do processo como fallback), comportamento idêntico a antes desta etapa
// quando não há multi-tenant configurado.
const INSERT_DELIVERY_SQL = `
  INSERT INTO deliveries (id, customer_id, status, created_at, data) VALUES (@id, @customerId, @status, @createdAt, @data)
`;
const UPDATE_DELIVERY_SQL = 'UPDATE deliveries SET status = @status, data = @data WHERE id = @id';
const GET_DELIVERY_SQL = 'SELECT * FROM deliveries WHERE id = ?';
const LIST_DELIVERIES_SQL = 'SELECT data FROM deliveries ORDER BY created_at DESC';
const GET_CUSTOMER_SQL = 'SELECT data FROM customers WHERE id = ?';
const CLAIM_IDEMPOTENCY_SQL = 'INSERT INTO idempotency_keys (key, created_at) VALUES (?, ?)';

function rowToDelivery(row) { return JSON.parse(row.data); }

router.get('/', (req, res) => {
  const status = req.query.status;
  let deliveries = (req.db || db).prepare(LIST_DELIVERIES_SQL).all().map(rowToDelivery);
  if (status) deliveries = deliveries.filter((d) => d.status === status);
  res.json({ deliveries });
});

// Achado de auditoria (mesma classe já corrigida em products/stock/sales):
// a versão anterior não tinha proteção nenhuma contra reenvio — um duplo
// clique em "Criar carreto" (ou o clique automático de "Finalizar venda +
// carreto" em sale.js, que cria a venda E o carreto numa sequência) criava
// dois registros idênticos. deliveriesRepo.js#createDelivery da extensão
// já reivindica um dedupeKey pra isso — porta o mesmo aqui.
function commitDelivery(input, targetDb) {
  return targetDb.transaction(() => {
    // Achado de auditoria (P2): antes, `dedupeKey` era inteiramente opcional
    // — o servidor nunca EXIGIA a chave, só a usava se o chamador decidisse
    // mandar. Uma chamada direta à API (fora das telas, que sempre mandam)
    // não tinha proteção nenhuma contra reenvio duplicado. Agora é exigida
    // em toda rota com efeito de negócio real.
    if (!input.dedupeKey) throw new Error('Requisição sem identificador de deduplicação.');
    targetDb.prepare(CLAIM_IDEMPOTENCY_SQL).run(input.dedupeKey, Date.now());
    targetDb.prepare(INSERT_DELIVERY_SQL).run({
      id: input.delivery.id, customerId: input.delivery.customerId, status: input.delivery.status,
      createdAt: input.delivery.createdAt, data: JSON.stringify(input.delivery),
    });
    return input.delivery;
  })();
}

router.post('/', (req, res) => {
  try {
    const targetDb = req.db || db;
    const customerRow = targetDb.prepare(GET_CUSTOMER_SQL).get(req.body.customerId);
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
    commitDelivery({ delivery, dedupeKey: req.body.dedupeKey || null }, targetDb);
    broadcast('deliveries-changed', { reason: 'created', id: delivery.id }, req.tenantId);
    res.status(201).json({ delivery });
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed: idempotency_keys')) {
      return res.status(409).json({ error: 'Este carreto já foi registrado — evite reenviar.' });
    }
    res.status(400).json({ error: err.message });
  }
});

// markDelivered/cancelar: a checagem "ainda está pendente?" e a gravação da
// transição de status acontecem na mesma transação — duas ações
// concorrentes sobre o mesmo carreto (marcar entregue e cancelar, em
// terminais diferentes) não conseguem as duas passar na checagem antes de
// qualquer uma gravar.
function commitTransition(input, targetDb) {
  return targetDb.transaction(() => {
    const row = targetDb.prepare(GET_DELIVERY_SQL).get(input.id);
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
    targetDb.prepare(UPDATE_DELIVERY_SQL).run({ id: delivery.id, status: delivery.status, data: JSON.stringify(delivery) });
    return delivery;
  })();
}

router.post('/:id/entregar', (req, res) => {
  try {
    const delivery = commitTransition({ id: req.params.id, newStatus: 'entregue', userId: req.userId, userName: req.userName }, req.db || db);
    broadcast('deliveries-changed', { reason: 'delivered', id: delivery.id }, req.tenantId);
    res.json({ delivery });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/cancelar', (req, res) => {
  try {
    const delivery = commitTransition({ id: req.params.id, newStatus: 'cancelado' }, req.db || db);
    broadcast('deliveries-changed', { reason: 'cancelled', id: delivery.id }, req.tenantId);
    res.json({ delivery });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
