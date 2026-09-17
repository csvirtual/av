// Fase 5 (financeiro): contas a pagar/receber. Deliberadamente simples,
// igual à extensão — não mexe automaticamente no caixa quando uma conta é
// paga (diferente do fiado, que sempre acontece via venda); quem lança aqui
// decide se aquele pagamento também deve virar uma sangria/suprimento
// manual no caixa. "Vencido" e "parcial" nunca são gravados, são
// calculados a cada leitura a partir de payments[] e dueDate (mesmo
// princípio de saldo do fiado: nunca um número solto que alguém esqueça de
// manter em dia).
import { Router } from 'express';
import { db, claimIdempotencyKey } from '../db/index.js';
import { broadcast } from '../lib/broadcast.js';
import { TOPIC_FINANCE_CHANGED } from '../public/js/utils/liveTopics.js';
import { AMOUNT_TOLERANCE as PAYMENT_TOLERANCE } from '../lib/pricing.js';

const router = Router();

// Achado de auditoria (Red Team, Passada 1): paymentMethod chegava sem
// nenhuma validação — aceitava objeto, string gigante, o que fosse. Nunca
// deu pra manipular saldo com isso (amount é sempre validado à parte), mas
// mesmo raciocínio de defesa em profundidade já aplicado em
// routes/sales.js#VALID_PAYMENT_METHODS: mesma lista que o dropdown desta
// tela mostra (ver public/js/views/financeiro.js#PAYMENT_METHODS).
const VALID_PAYMENT_METHODS = new Set(['Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Pix', 'Transferência']);

// Etapa 5 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): SQL
// como texto, não mais prepared statements pré-montados — cada handler
// prepara contra `req.db`, sempre já resolvido pro banco certo (o da
// loja, ou o banco fixo do processo em modo legado) — server.js#tenant
// resolution middleware é a ÚNICA fonte dessa decisão agora, nenhuma
// rota mais precisa repetir o fallback.
const INSERT_ENTRY_SQL = `
  INSERT INTO financial_entries (id, status, due_date, data) VALUES (@id, @status, @dueDate, @data)
`;
const UPDATE_ENTRY_SQL = 'UPDATE financial_entries SET status = @status, data = @data WHERE id = @id';
const GET_ENTRY_SQL = 'SELECT * FROM financial_entries WHERE id = ?';
const LIST_ENTRIES_SQL = 'SELECT data FROM financial_entries ORDER BY due_date ASC';

function rowToEntry(row) { return JSON.parse(row.data); }

function paidTotal(entry) {
  if (Array.isArray(entry.payments)) return entry.payments.reduce((sum, p) => sum + p.amount, 0);
  return 0;
}
function remainingAmount(entry) {
  return Math.max(0, entry.amount - paidTotal(entry));
}
function entryStatus(entry) {
  if (entry.status === 'cancelado') return 'cancelado';
  if (entry.status === 'pago') return 'pago';
  if (paidTotal(entry) > PAYMENT_TOLERANCE) return 'parcial';
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (entry.dueDate < startOfToday.getTime()) return 'vencido';
  return 'pendente';
}

router.get('/', (req, res) => {
  const entries = req.db.prepare(LIST_ENTRIES_SQL).all().map(rowToEntry);
  res.json({ entries: entries.map((e) => ({ ...e, displayStatus: entryStatus(e), paidTotal: paidTotal(e), remaining: remainingAmount(e) })) });
});

router.post('/', (req, res) => {
  try {
    const type = req.body.type;
    const targetDb = req.db;
    if (type !== 'pagar' && type !== 'receber') throw new Error('Tipo de conta inválido.');
    const description = (req.body.description || '').trim();
    if (!description) throw new Error('Descrição é obrigatória.');
    const value = Number(req.body.amount);
    if (!Number.isFinite(value) || value <= 0) throw new Error('Informe um valor maior que zero.');
    const dueDate = Number(req.body.dueDate);
    if (!Number.isFinite(dueDate)) throw new Error('Informe a data de vencimento.');

    const entry = {
      id: crypto.randomUUID(),
      type,
      description,
      amount: value,
      dueDate,
      category: (req.body.category || '').trim(),
      supplierId: req.body.supplierId || null,
      status: 'pendente',
      payments: [],
      notes: (req.body.notes || '').trim(),
      createdBy: { userId: req.userId, userName: req.userName },
      createdAt: Date.now(),
    };
    targetDb.prepare(INSERT_ENTRY_SQL).run({ id: entry.id, status: entry.status, dueDate: entry.dueDate, data: JSON.stringify(entry) });
    broadcast(TOPIC_FINANCE_CHANGED, { reason: 'created', id: entry.id }, req.tenantId);
    res.status(201).json({ entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Igual ao resto do sistema (vendas, caixa, fiado): checagem do que ainda
 * falta pagar e gravação do pagamento na MESMA transação, e a chave de
 * idempotência só é reivindicada DEPOIS de passar na checagem — uma
 * tentativa rejeitada por valor maior que o restante nunca queima a
 * dedupeKey. A conta só fecha ('pago') quando a SOMA de tudo bate (ou
 * passa) o valor total; enquanto sobrar saldo, continua disponível pra
 * novos pagamentos parciais. */
function commitPayment(input, targetDb) {
  return targetDb.transaction(() => {
    const value = Number(input.amount);
    if (!Number.isFinite(value) || value <= 0) throw new Error('Informe um valor pago maior que zero.');
    if (!VALID_PAYMENT_METHODS.has(input.paymentMethod)) throw new Error('Forma de pagamento inválida.');

    const row = targetDb.prepare(GET_ENTRY_SQL).get(input.id);
    if (!row) throw new Error('Conta não encontrada.');
    const entry = rowToEntry(row);
    if (entry.status === 'pago') throw new Error('Esta conta já está totalmente paga.');
    if (entry.status === 'cancelado') throw new Error('Esta conta foi cancelada.');
    const remaining = remainingAmount(entry);
    if (value > remaining + PAYMENT_TOLERANCE) {
      throw new Error(`O valor informado (${value.toFixed(2)}) é maior que o restante a pagar (${remaining.toFixed(2)}).`);
    }
    // Achado de auditoria (P2): dedupeKey agora é obrigatória — ver
    // routes/deliveries.js#commitDelivery pro raciocínio completo.
    claimIdempotencyKey(input.dedupeKey, targetDb);

    const payment = { id: crypto.randomUUID(), amount: value, paymentMethod: input.paymentMethod, paidAt: Date.now(), userId: input.userId, userName: input.userName };
    entry.payments = Array.isArray(entry.payments) ? [...entry.payments, payment] : [payment];
    if (paidTotal(entry) >= entry.amount - PAYMENT_TOLERANCE) entry.status = 'pago';
    targetDb.prepare(UPDATE_ENTRY_SQL).run({ id: entry.id, status: entry.status, data: JSON.stringify(entry) });
    return entry;
  })();
}

router.post('/:id/pagamento', (req, res) => {
  try {
    const entry = commitPayment({ ...req.body, id: req.params.id, userId: req.userId, userName: req.userName }, req.db);
    broadcast(TOPIC_FINANCE_CHANGED, { reason: 'payment', id: entry.id }, req.tenantId);
    res.status(201).json({ entry });
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed: idempotency_keys')) {
      return res.status(409).json({ error: 'Este pagamento já foi registrado — evite reenviar.' });
    }
    res.status(400).json({ error: err.message });
  }
});

/** Excluir um pagamento já registrado — se isso tirar a conta de "paga",
 * ela volta sozinha a aparecer pendente/parcial (nunca fica presa em
 * status 'pago' com menos dinheiro registrado do que o total exige). */
function commitDeletePayment(input, targetDb) {
  return targetDb.transaction(() => {
    const row = targetDb.prepare(GET_ENTRY_SQL).get(input.entryId);
    if (!row) throw new Error('Conta não encontrada.');
    const entry = rowToEntry(row);
    const payments = Array.isArray(entry.payments) ? entry.payments : [];
    if (!payments.some((p) => p.id === input.paymentId)) throw new Error('Pagamento não encontrado.');
    entry.payments = payments.filter((p) => p.id !== input.paymentId);
    entry.status = paidTotal(entry) >= entry.amount - PAYMENT_TOLERANCE ? 'pago' : 'pendente';
    targetDb.prepare(UPDATE_ENTRY_SQL).run({ id: entry.id, status: entry.status, data: JSON.stringify(entry) });
    return entry;
  })();
}

router.delete('/:id/pagamento/:paymentId', (req, res) => {
  try {
    const entry = commitDeletePayment({ entryId: req.params.id, paymentId: req.params.paymentId }, req.db);
    broadcast(TOPIC_FINANCE_CHANGED, { reason: 'payment-deleted', id: entry.id }, req.tenantId);
    res.json({ entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function commitCancel(entryId, targetDb) {
  return targetDb.transaction(() => {
    const row = targetDb.prepare(GET_ENTRY_SQL).get(entryId);
    if (!row) throw new Error('Conta não encontrada.');
    const entry = rowToEntry(row);
    if (entry.status === 'pago') throw new Error('Não é possível cancelar uma conta já paga.');
    if (paidTotal(entry) > PAYMENT_TOLERANCE) {
      throw new Error('Esta conta já tem pagamento(s) registrado(s) — exclua os pagamentos antes de cancelar.');
    }
    entry.status = 'cancelado';
    targetDb.prepare(UPDATE_ENTRY_SQL).run({ id: entry.id, status: entry.status, data: JSON.stringify(entry) });
    return entry;
  })();
}

router.post('/:id/cancelar', (req, res) => {
  try {
    const entry = commitCancel(req.params.id, req.db);
    broadcast(TOPIC_FINANCE_CHANGED, { reason: 'cancelled', id: entry.id }, req.tenantId);
    res.json({ entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
