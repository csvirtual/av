// Fase 4 (clientes/fiado): saldo devedor nunca é um número gravado solto —
// é sempre calculado a partir do extrato em `customer_debts` (cada venda
// fiada lança uma dívida, cada pagamento/estorno abate dela). Mesmo
// princípio já usado no estoque (stock_movements) e no caixa
// (cash_movements) — dá pra reconstruir o saldo a qualquer momento e nunca
// perde o histórico de como ele chegou nesse valor. Mesma lógica de
// data/customersRepo.js da extensão, portada pro servidor.
import { Router } from 'express';
import { db } from '../db/index.js';
import { broadcast } from '../lib/broadcast.js';
import { resolveOpenSession } from '../lib/cashSession.js';
import { userCan } from '../lib/permissions.js';

const router = Router();

const insertCustomerStmt = db.prepare('INSERT INTO customers (id, name_lower, data) VALUES (@id, @nameLower, @data)');
const updateCustomerStmt = db.prepare('UPDATE customers SET name_lower = @nameLower, data = @data WHERE id = @id');
const deleteCustomerStmt = db.prepare('DELETE FROM customers WHERE id = ?');
const getCustomerStmt = db.prepare('SELECT data FROM customers WHERE id = ?');
const listCustomersStmt = db.prepare('SELECT data FROM customers');
const listLedgerStmt = db.prepare('SELECT data FROM customer_debts WHERE customer_id = ? ORDER BY timestamp DESC');
const listAllDebtsStmt = db.prepare('SELECT data FROM customer_debts');
const insertDebtEntryStmt = db.prepare('INSERT INTO customer_debts (id, customer_id, timestamp, data) VALUES (@id, @customerId, @timestamp, @data)');
const claimIdempotencyStmt = db.prepare('INSERT INTO idempotency_keys (key, created_at) VALUES (?, ?)');

function rowToCustomer(row) { return JSON.parse(row.data); }
function money(n) { return 'R$ ' + Number(n).toFixed(2).replace('.', ','); }
function onlyDigits(s) { return (s || '').replace(/\D/g, ''); }

function listCustomers() {
  return listCustomersStmt.all().map(rowToCustomer).sort((a, b) => a.nameLower.localeCompare(b.nameLower, 'pt-BR'));
}

function customerBalance(customerId) {
  const entries = listLedgerStmt.all(customerId).map((r) => JSON.parse(r.data));
  return entries.reduce((sum, e) => sum + (e.type === 'fiado' ? e.amount : -e.amount), 0);
}

function sanitizeDebtDueDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let items = listCustomers();
  if (q) {
    const qDigits = onlyDigits(q);
    items = items.filter((c) => c.nameLower.includes(q)
      || (c.telefone || '').includes(q)
      || (qDigits && onlyDigits(c.telefone).includes(qDigits)));
  }
  res.json({ customers: items });
});

router.get('/balances', (req, res) => {
  const all = listAllDebtsStmt.all().map((r) => JSON.parse(r.data));
  const balances = {};
  for (const e of all) {
    const delta = e.type === 'fiado' ? e.amount : -e.amount;
    balances[e.customerId] = (balances[e.customerId] || 0) + delta;
  }
  res.json({ balances });
});

router.get('/:id', (req, res) => {
  const row = getCustomerStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const customer = rowToCustomer(row);
  res.json({ customer, balance: customerBalance(customer.id) });
});

router.get('/:id/ledger', (req, res) => {
  const row = getCustomerStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const entries = listLedgerStmt.all(req.params.id).map((r) => JSON.parse(r.data));
  res.json({ entries });
});

// Achado de auditoria (P2): saldo de fiado e de fidelidade são sempre
// calculados por `customer.id` (extrato, ver customerBalance acima) — dois
// cadastros diferentes pra mesma pessoa (mesmo CPF/CNPJ) resultam em dois
// saldos INDEPENDENTES, sem nenhuma trava impedindo isso hoje (schema não
// tem UNIQUE pra documento — ele vive dentro do JSON de `data`). Um cliente
// (ou um vendedor desatento) podia comprar fiado até o limite num cadastro,
// e voltar a comprar fiado do zero criando outro com o mesmo documento.
// Mesmo padrão de checagem que products.js já faz pra barcode.
function findCustomerByDocument(digits, excludeId = null) {
  if (!digits) return null;
  return listCustomers().find((c) => c.id !== excludeId && onlyDigits(c.documento) === digits);
}

router.post('/', (req, res) => {
  try {
    const nome = (req.body.nome || '').trim();
    if (!nome) throw new Error('Nome do cliente é obrigatório.');
    const documento = (req.body.documento || '').trim();
    const documentoDigits = onlyDigits(documento);
    if (documentoDigits && findCustomerByDocument(documentoDigits)) {
      throw new Error('Já existe um cliente cadastrado com esse CPF/CNPJ.');
    }
    const customer = {
      id: crypto.randomUUID(),
      nome,
      nameLower: nome.toLowerCase(),
      telefone: (req.body.telefone || '').trim(),
      documento,
      endereco: (req.body.endereco || '').trim(),
      observacoes: (req.body.observacoes || '').trim(),
      creditLimit: Math.max(0, Number(req.body.creditLimit) || 0),
      debtDueDate: sanitizeDebtDueDate(req.body.debtDueDate),
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    insertCustomerStmt.run({ id: customer.id, nameLower: customer.nameLower, data: JSON.stringify(customer) });
    broadcast('customers-changed', { reason: 'created', id: customer.id });
    res.status(201).json({ customer });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const row = getCustomerStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });
  try {
    const customer = rowToCustomer(row);
    const body = req.body;
    if (body.nome !== undefined) {
      const nome = body.nome.trim();
      if (!nome) throw new Error('Nome do cliente é obrigatório.');
      customer.nome = nome;
      customer.nameLower = nome.toLowerCase();
    }
    if (body.telefone !== undefined) customer.telefone = body.telefone.trim();
    if (body.documento !== undefined) {
      const documento = body.documento.trim();
      const documentoDigits = onlyDigits(documento);
      if (documentoDigits && findCustomerByDocument(documentoDigits, customer.id)) {
        throw new Error('Já existe outro cliente cadastrado com esse CPF/CNPJ.');
      }
      customer.documento = documento;
    }
    if (body.endereco !== undefined) customer.endereco = body.endereco.trim();
    if (body.observacoes !== undefined) customer.observacoes = body.observacoes.trim();
    if (body.creditLimit !== undefined) customer.creditLimit = Math.max(0, Number(body.creditLimit) || 0);
    if (body.debtDueDate !== undefined) customer.debtDueDate = sanitizeDebtDueDate(body.debtDueDate);
    if (body.active !== undefined) customer.active = !!body.active;
    customer.updatedAt = Date.now();
    updateCustomerStmt.run({ id: customer.id, nameLower: customer.nameLower, data: JSON.stringify(customer) });
    broadcast('customers-changed', { reason: 'updated', id: customer.id });
    res.json({ customer });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  // Achado de auditoria (mesma classe corrigida em customersRepo.js da
  // extensão): excluir cliente é sensível o bastante pra exigir a permissão
  // 'deleteCustomer' especificamente (admin sempre tem; vendedor só se
  // marcado no cadastro dele) — reconferido aqui, na rota, não só escondido
  // atrás de um botão que a tela poderia ou não mostrar.
  if (!userCan(req.userRole, req.userPermissions, 'deleteCustomer')) {
    return res.status(403).json({ error: 'Você não tem permissão para excluir clientes.' });
  }
  const row = getCustomerStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });
  deleteCustomerStmt.run(req.params.id);
  broadcast('customers-changed', { reason: 'deleted', id: req.params.id });
  res.json({ ok: true });
});

/** Igual ao restante do sistema (vendas, caixa): a checagem do saldo e a
 * gravação do pagamento acontecem na MESMA transação — sem isso, dois
 * cliques rápidos (ou duas máquinas registrando o pagamento do mesmo cliente
 * ao mesmo tempo) liam o mesmo saldo antes de qualquer um gravar, e os dois
 * passavam na validação "valor <= saldo", quitando o dobro do que o cliente
 * pagou de fato. A chave de idempotência só é reivindicada DEPOIS da
 * checagem de saldo passar — uma tentativa rejeitada por saldo insuficiente
 * nunca queima a dedupeKey, então corrigir o valor e reenviar no mesmo modal
 * (mesma dedupeKey, de propósito) não é barrado como "duplicado". */
const commitPayment = db.transaction((input) => {
  const value = Number(input.amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Informe um valor de pagamento maior que zero.');

  const entries = listLedgerStmt.all(input.customerId).map((r) => JSON.parse(r.data));
  const balance = entries.reduce((sum, e) => sum + (e.type === 'fiado' ? e.amount : -e.amount), 0);
  if (value > balance + 0.01) {
    throw new Error(`O cliente deve ${money(balance)} — não é possível registrar um pagamento maior que a dívida.`);
  }
  // Achado de auditoria (P2): dedupeKey agora é obrigatória — ver
  // routes/deliveries.js#commitDelivery pro raciocínio completo.
  if (!input.dedupeKey) throw new Error('Requisição sem identificador de deduplicação.');
  claimIdempotencyStmt.run(input.dedupeKey, Date.now());

  const openSession = resolveOpenSession(input.terminalId);
  const entry = {
    id: crypto.randomUUID(), customerId: input.customerId, type: 'pagamento', amount: value,
    saleId: null, paymentMethod: input.paymentMethod, cashSessionId: openSession ? openSession.id : null,
    note: (input.note || '').trim(), userId: input.userId, userName: input.userName, timestamp: Date.now(),
  };
  insertDebtEntryStmt.run({ id: entry.id, customerId: entry.customerId, timestamp: entry.timestamp, data: JSON.stringify(entry) });
  return entry;
});

router.post('/:id/pagamento', (req, res) => {
  const row = getCustomerStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });
  try {
    const entry = commitPayment({ ...req.body, customerId: req.params.id, userId: req.userId, userName: req.userName, terminalId: req.terminalId });
    broadcast('customers-changed', { reason: 'payment', id: req.params.id });
    res.status(201).json({ entry, balance: customerBalance(req.params.id) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed: idempotency_keys')) {
      return res.status(409).json({ error: 'Este pagamento já foi registrado — evite reenviar.' });
    }
    res.status(400).json({ error: err.message });
  }
});

export default router;
