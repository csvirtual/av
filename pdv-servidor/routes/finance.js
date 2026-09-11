// Fase 5 (financeiro): contas a pagar/receber. Deliberadamente simples,
// igual à extensão — não mexe automaticamente no caixa quando uma conta é
// paga (diferente do fiado, que sempre acontece via venda); quem lança aqui
// decide se aquele pagamento também deve virar uma sangria/suprimento
// manual no caixa. "Vencido" e "parcial" nunca são gravados, são
// calculados a cada leitura a partir de payments[] e dueDate (mesmo
// princípio de saldo do fiado: nunca um número solto que alguém esqueça de
// manter em dia).
import { Router } from 'express';
import { db } from '../db/index.js';
import { broadcast } from '../lib/broadcast.js';

const router = Router();

const PAYMENT_TOLERANCE = 0.01;

const insertEntryStmt = db.prepare(`
  INSERT INTO financial_entries (id, status, due_date, data) VALUES (@id, @status, @dueDate, @data)
`);
const updateEntryStmt = db.prepare('UPDATE financial_entries SET status = @status, data = @data WHERE id = @id');
const getEntryStmt = db.prepare('SELECT * FROM financial_entries WHERE id = ?');
const listEntriesStmt = db.prepare('SELECT data FROM financial_entries ORDER BY due_date ASC');
const claimIdempotencyStmt = db.prepare('INSERT INTO idempotency_keys (key, created_at) VALUES (?, ?)');

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
  const entries = listEntriesStmt.all().map(rowToEntry);
  res.json({ entries: entries.map((e) => ({ ...e, displayStatus: entryStatus(e), paidTotal: paidTotal(e), remaining: remainingAmount(e) })) });
});

router.post('/', (req, res) => {
  try {
    const type = req.body.type;
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
    insertEntryStmt.run({ id: entry.id, status: entry.status, dueDate: entry.dueDate, data: JSON.stringify(entry) });
    broadcast('finance-changed', { reason: 'created', id: entry.id });
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
const commitPayment = db.transaction((input) => {
  const value = Number(input.amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Informe um valor pago maior que zero.');

  const row = getEntryStmt.get(input.id);
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
  if (!input.dedupeKey) throw new Error('Requisição sem identificador de deduplicação.');
  claimIdempotencyStmt.run(input.dedupeKey, Date.now());

  const payment = { id: crypto.randomUUID(), amount: value, paymentMethod: input.paymentMethod, paidAt: Date.now(), userId: input.userId, userName: input.userName };
  entry.payments = Array.isArray(entry.payments) ? [...entry.payments, payment] : [payment];
  if (paidTotal(entry) >= entry.amount - PAYMENT_TOLERANCE) entry.status = 'pago';
  updateEntryStmt.run({ id: entry.id, status: entry.status, data: JSON.stringify(entry) });
  return entry;
});

router.post('/:id/pagamento', (req, res) => {
  try {
    const entry = commitPayment({ ...req.body, id: req.params.id, userId: req.userId, userName: req.userName });
    broadcast('finance-changed', { reason: 'payment', id: entry.id });
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
const commitDeletePayment = db.transaction((input) => {
  const row = getEntryStmt.get(input.entryId);
  if (!row) throw new Error('Conta não encontrada.');
  const entry = rowToEntry(row);
  const payments = Array.isArray(entry.payments) ? entry.payments : [];
  if (!payments.some((p) => p.id === input.paymentId)) throw new Error('Pagamento não encontrado.');
  entry.payments = payments.filter((p) => p.id !== input.paymentId);
  entry.status = paidTotal(entry) >= entry.amount - PAYMENT_TOLERANCE ? 'pago' : 'pendente';
  updateEntryStmt.run({ id: entry.id, status: entry.status, data: JSON.stringify(entry) });
  return entry;
});

router.delete('/:id/pagamento/:paymentId', (req, res) => {
  try {
    const entry = commitDeletePayment({ entryId: req.params.id, paymentId: req.params.paymentId });
    broadcast('finance-changed', { reason: 'payment-deleted', id: entry.id });
    res.json({ entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const commitCancel = db.transaction((entryId) => {
  const row = getEntryStmt.get(entryId);
  if (!row) throw new Error('Conta não encontrada.');
  const entry = rowToEntry(row);
  if (entry.status === 'pago') throw new Error('Não é possível cancelar uma conta já paga.');
  if (paidTotal(entry) > PAYMENT_TOLERANCE) {
    throw new Error('Esta conta já tem pagamento(s) registrado(s) — exclua os pagamentos antes de cancelar.');
  }
  entry.status = 'cancelado';
  updateEntryStmt.run({ id: entry.id, status: entry.status, data: JSON.stringify(entry) });
  return entry;
});

router.post('/:id/cancelar', (req, res) => {
  try {
    const entry = commitCancel(req.params.id);
    broadcast('finance-changed', { reason: 'cancelled', id: entry.id });
    res.json({ entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
