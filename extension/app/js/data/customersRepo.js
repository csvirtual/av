// Clientes e fiado. O saldo devedor de um cliente nunca é guardado como um
// número solto — é sempre calculado a partir do "extrato" (customerDebts):
// cada venda fiada lança uma dívida, cada pagamento recebido abate dela. Dá
// pra reconstruir o saldo a qualquer momento e nunca perde o histórico de
// como ele chegou nesse valor — o mesmo princípio já usado no estoque
// (stockMovements) e no caixa (cashMovements).
import { dbGetAll, dbGet, dbAdd, dbDelete, dbGetAllByIndex, dbTransaction, dbUpdate, newId } from '../db.js';

export async function listCustomers() {
  const customers = await dbGetAll('customers');
  return customers.sort((a, b) => a.nameLower.localeCompare(b.nameLower, 'pt-BR'));
}

export async function getCustomer(id) {
  return dbGet('customers', id);
}

export async function searchCustomers(term) {
  const all = await listCustomers();
  const q = (term || '').trim().toLowerCase();
  if (!q) return all;
  return all.filter((c) => c.nameLower.includes(q) || (c.telefone || '').includes(q));
}

export async function createCustomer(data) {
  const nome = (data.nome || '').trim();
  if (!nome) throw new Error('Nome do cliente é obrigatório.');
  const record = {
    id: newId(),
    nome,
    nameLower: nome.toLowerCase(),
    telefone: (data.telefone || '').trim(),
    documento: (data.documento || '').trim(),
    endereco: (data.endereco || '').trim(),
    observacoes: (data.observacoes || '').trim(),
    creditLimit: Number(data.creditLimit) || 0, // 0 = sem limite definido
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await dbAdd('customers', record);
  return record;
}

export async function updateCustomer(id, data) {
  return dbUpdate('customers', id, (customer) => {
    if (!customer) throw new Error('Cliente não encontrado.');
    if (data.nome !== undefined) {
      const nome = data.nome.trim();
      if (!nome) throw new Error('Nome do cliente é obrigatório.');
      customer.nome = nome;
      customer.nameLower = nome.toLowerCase();
    }
    if (data.telefone !== undefined) customer.telefone = data.telefone.trim();
    if (data.documento !== undefined) customer.documento = data.documento.trim();
    if (data.endereco !== undefined) customer.endereco = data.endereco.trim();
    if (data.observacoes !== undefined) customer.observacoes = data.observacoes.trim();
    if (data.creditLimit !== undefined) customer.creditLimit = Number(data.creditLimit) || 0;
    customer.updatedAt = Date.now();
    return customer;
  });
}

export async function setCustomerActive(id, active) {
  return dbUpdate('customers', id, (customer) => {
    if (!customer) throw new Error('Cliente não encontrado.');
    customer.active = active;
    customer.updatedAt = Date.now();
    return customer;
  });
}

export async function deleteCustomer(id) {
  await dbDelete('customers', id);
}

// ---------- Extrato de fiado (dívidas e pagamentos) ----------

export async function listCustomerLedger(customerId) {
  const entries = await dbGetAllByIndex('customerDebts', 'byCustomerId', customerId);
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

export async function getCustomerBalance(customerId) {
  const entries = await listCustomerLedger(customerId);
  return entries.reduce((sum, e) => sum + (e.type === 'fiado' ? e.amount : -e.amount), 0);
}

/** Saldo devedor de todos os clientes de uma vez (evita N consultas
 * separadas nas telas que precisam listar todo mundo com o saldo). */
export async function getAllBalances() {
  const all = await dbGetAll('customerDebts');
  const balances = {};
  for (const e of all) {
    const delta = e.type === 'fiado' ? e.amount : -e.amount;
    balances[e.customerId] = (balances[e.customerId] || 0) + delta;
  }
  return balances;
}

/** Pagamentos de fiado recebidos durante uma sessão de caixa específica —
 * usado pelo cashRepo pra somar esse dinheiro na conferência de fechamento
 * (senão o caixa nunca bate quando alguém quita uma dívida antiga). */
export async function listPaymentsForCashSession(cashSessionId) {
  const all = await dbGetAll('customerDebts');
  return all.filter((e) => e.type === 'pagamento' && e.cashSessionId === cashSessionId);
}

/** Lança uma dívida de fiado — chamado pelo salesRepo quando uma venda tem
 * um pagamento com forma "Fiado". Não mexe em caixa (fiado não é dinheiro
 * entrando agora, é uma promessa de pagamento futuro). */
export async function recordDebt({ customerId, amount, saleId, userId, userName }) {
  const entry = {
    id: newId(),
    customerId,
    type: 'fiado',
    amount: Number(amount) || 0,
    saleId,
    paymentMethod: null,
    cashSessionId: null,
    note: '',
    userId, userName,
    timestamp: Date.now(),
  };
  await dbAdd('customerDebts', entry);
  return entry;
}

/** Registra o pagamento (total ou parcial) de uma dívida existente. Se feito
 * com o caixa aberto, o valor entra na conferência de fechamento — por isso
 * recebe cashSessionId separadamente (ver views/clientes.js).
 *
 * A checagem do saldo e a gravação do pagamento acontecem dentro da MESMA
 * transação do IndexedDB (dbTransaction), não como um dbGet (via
 * getCustomerBalance) seguido de um dbAdd separados. Antes, dois cliques
 * rápidos no botão de confirmar (ou duas abas registrando pagamento do
 * mesmo cliente ao mesmo tempo) liam o mesmo saldo "antes" de qualquer um
 * gravar — os dois passavam na validação "valor <= saldo" e os dois
 * gravavam um lançamento de pagamento, quitando o dobro do que o cliente
 * pagou de fato. Como o "saldo" aqui não é um campo único (é a soma de um
 * extrato inteiro, ver comentário no topo do arquivo), a trava não pode
 * usar dbUpdate (que é get+put de UM registro) — em vez disso, a leitura
 * de todo o extrato e a decisão de gravar ou não ficam dentro do mesmo
 * `work` síncrono do dbTransaction, serializadas pelo próprio IndexedDB. */
export async function recordPayment({ customerId, amount, paymentMethod, cashSessionId = null, note = '', userId, userName }) {
  const value = Number(amount) || 0;
  if (value <= 0) throw new Error('Informe um valor de pagamento maior que zero.');

  const entry = {
    id: newId(),
    customerId,
    type: 'pagamento',
    amount: value,
    saleId: null,
    paymentMethod,
    cashSessionId,
    note: note.trim(),
    userId, userName,
    timestamp: Date.now(),
  };

  let validationError = null;
  await dbTransaction('customerDebts', 'readwrite', (transaction) => {
    const store = transaction.objectStore('customerDebts');
    const getAllReq = store.index('byCustomerId').getAll(customerId);
    getAllReq.onsuccess = () => {
      const balance = getAllReq.result.reduce((sum, e) => sum + (e.type === 'fiado' ? e.amount : -e.amount), 0);
      if (value > balance + 0.01) {
        // Não aborta a transação (abortar perderia a mensagem de erro
        // amigável — ver db.js) — só não grava nada. A transação
        // completa normalmente, vazia, e o erro é lançado depois, fora
        // dela, com o saldo real que foi lido.
        validationError = `O cliente deve ${balance.toFixed(2)} — não é possível registrar um pagamento maior que a dívida.`;
        return;
      }
      store.add(entry);
    };
  });

  if (validationError) throw new Error(validationError);
  return entry;
}
