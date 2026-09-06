// Clientes e fiado. O saldo devedor de um cliente nunca é guardado como um
// número solto — é sempre calculado a partir do "extrato" (customerDebts):
// cada venda fiada lança uma dívida, cada pagamento recebido abate dela. Dá
// pra reconstruir o saldo a qualquer momento e nunca perde o histórico de
// como ele chegou nesse valor — o mesmo princípio já usado no estoque
// (stockMovements) e no caixa (cashMovements).
import { dbGetAll, dbGet, dbAdd, dbDelete, dbGetAllByIndex, dbTransaction, dbUpdate, claimIdempotencyKey, newId } from '../db.js';
import { assertActingUserHasPermission } from './usersRepo.js';
import { formatMoney, onlyDigits } from '../utils/format.js';

export async function listCustomers() {
  const customers = await dbGetAll('customers');
  return customers.sort((a, b) => a.nameLower.localeCompare(b.nameLower, 'pt-BR'));
}

export async function getCustomer(id) {
  return dbGet('customers', id);
}

// Sempre null ou um timestamp de verdade — nunca confia que o que chamou
// mandou um número válido (mesmo vindo só de dentro do próprio sistema, ver
// updateCustomer). Sem isso, um valor esquisito gravado aqui quebra a
// pré-carga do campo de data na edição do cliente lá na frente
// (`new Date(lixo).toISOString()` joga RangeError e derruba o modal inteiro
// — ver views/clientes.js#openCustomerModal).
function sanitizeDebtDueDate(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function searchCustomers(term) {
  const all = await listCustomers();
  const q = (term || '').trim().toLowerCase();
  if (!q) return all;
  // Telefone é guardado formatado ("(xx) x xxxx-xxxx", ver utils/phone.js),
  // então além do match literal também compara só os dígitos — pra buscar
  // só os números do telefone continuar achando o registro mesmo sem
  // digitar a pontuação.
  const qDigits = onlyDigits(q);
  return all.filter((c) => c.nameLower.includes(q)
    || (c.telefone || '').includes(q)
    || (qDigits && onlyDigits(c.telefone).includes(qDigits)));
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
    creditLimit: Math.max(0, Number(data.creditLimit) || 0), // 0 = sem limite definido
    // Lembrete de vencimento do saldo devedor ATUAL (não é parcelamento —
    // o fiado continua sendo um saldo único em aberto, ver comentário no
    // topo do arquivo; isto é só "até quando cobrar", editável a qualquer
    // momento). null = sem lembrete definido.
    debtDueDate: sanitizeDebtDueDate(data.debtDueDate),
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
    if (data.creditLimit !== undefined) customer.creditLimit = Math.max(0, Number(data.creditLimit) || 0);
    if (data.debtDueDate !== undefined) customer.debtDueDate = sanitizeDebtDueDate(data.debtDueDate);
    customer.updatedAt = Date.now();
    return customer;
  });
}

/** true quando o cliente tem lembrete de vencimento definido, já passou da
 * data e ainda tem saldo devedor de verdade (sem saldo, "vencido" não tem
 * sentido nenhum — mesmo raciocínio do entryStatus() em data/financeRepo.js). */
export function isDebtOverdue(customer, balance) {
  if (!customer?.debtDueDate || balance <= 0.01) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return customer.debtDueDate < startOfToday.getTime();
}

export async function setCustomerActive(id, active) {
  return dbUpdate('customers', id, (customer) => {
    if (!customer) throw new Error('Cliente não encontrado.');
    customer.active = active;
    customer.updatedAt = Date.now();
    return customer;
  });
}

// Achado de auditoria (mesma classe corrigida em usersRepo.js e nos outros
// repositórios sensíveis): excluir cliente era protegido só pela TELA
// (botão escondido de quem não tem a permissão 'deleteCustomer', ver
// views/clientes.js) — reconfere aqui, na fonte, contra a permissão
// realmente gravada do usuário logado.
export async function deleteCustomer(id) {
  await assertActingUserHasPermission('deleteCustomer');
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

/** Achado de auditoria: estornar uma venda paga (total ou parcialmente) em
 * fiado não reduzia a dívida do cliente em nada — devolvia a mercadoria pro
 * estoque (ver salesRepo.js#refundSaleItems) mas o extrato de fiado
 * continuava cobrando o valor cheio, mesmo com o produto de volta na
 * prateleira. Corrige gravando um lançamento de tipo 'estorno' (nunca
 * reescreve a dívida original — mesmo princípio de sempre somar no
 * extrato, nunca apagar histórico, usado em todo o resto deste arquivo).
 * Tipo 'estorno', não 'pagamento' de propósito: não é dinheiro recebido —
 * por isso listPaymentsForCashSession() não conta isso na conferência do
 * caixa (filtra só 'pagamento'), sem inflar o "dinheiro esperado na
 * gaveta" com um estorno que não passou pelo caixa. */
export async function recordDebtRefund({ customerId, amount, saleId, refundId, userId, userName }) {
  // Achado de auditoria (re-auditoria): igual às outras funções de
  // dinheiro deste arquivo, `Number(x) || 0` sozinho bloqueia negativo e
  // NaN mas não Infinity (`Number(Infinity) || 0` é `Infinity`, que é
  // truthy). Sem função de exclusão de lançamento em customerDebts, um
  // valor Infinity aqui corrompe o extrato do cliente PRA SEMPRE.
  const value = Number(amount);
  if (!customerId || !Number.isFinite(value) || value <= 0) return null;
  const entry = {
    id: newId(),
    customerId,
    type: 'estorno',
    amount: value,
    saleId: saleId || null,
    refundId: refundId || null,
    paymentMethod: null,
    cashSessionId: null,
    note: 'Redução de dívida por estorno de venda',
    userId, userName,
    timestamp: Date.now(),
  };
  await dbAdd('customerDebts', entry);
  return entry;
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
 * (senão o caixa nunca bate quando alguém quita uma dívida antiga).
 *
 * Achado de auditoria (Caixa não pode engasgar com fluxo grande de vendas):
 * antes carregava `customerDebts` INTEIRA (toda dívida/pagamento já
 * registrado na loja) só pra filtrar em memória os poucos pagamentos desta
 * sessão — chamado a cada renderização do Caixa. `cashSessionId` já é
 * gravado em todo registro desde sempre (`null` por padrão em criação de
 * dívida), então o índice `byCashSessionId` (ver db.js#DB_VERSION 9) cobre
 * o histórico inteiro sem precisar de backfill. */
export async function listPaymentsForCashSession(cashSessionId) {
  const entries = await dbGetAllByIndex('customerDebts', 'byCashSessionId', cashSessionId);
  return entries.filter((e) => e.type === 'pagamento');
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
// Achado de auditoria (P2, dinheiro não pode ter brecha): a trava acima
// (dbTransaction cobrindo a leitura E a gravação) já impedia o LOST UPDATE
// clássico — mas não impedia uma submissão DUPLICADA e legítima (ex: uma
// chamada repetida sem passar pela tela): duas chamadas de R$150 contra uma
// dívida de R$300 são cada uma, isoladamente, "menor que o saldo", e as
// duas passam, quitando R$300 de dívida real por só R$150 recebidos de
// verdade. `dedupeKey` (opcional, gerada uma vez por abertura do modal de
// pagamento) fecha essa segunda classe: a mesma chave só pode ser usada uma
// vez, verificado dentro da MESMA transação atômica (ver
// db.js#claimIdempotencyKey).
// Achado de auditoria (P1, re-auditoria): a versão anterior chamava
// `claimIdempotencyKey` incondicionalmente no INÍCIO da transação, antes de
// checar o saldo. Quando a checagem de saldo abaixo rejeitava o pagamento,
// a transação terminava normalmente (sem abort) — e a reivindicação da
// chave já tinha sido gravada, queimando `dedupeKey` PRA SEMPRE mesmo sem
// nenhum pagamento ter sido registrado. Resultado: usuário digita valor
// maior que a dívida, vê o erro amigável, corrige o valor e reenvia no
// MESMO modal (mesma dedupeKey, de propósito — ver comentário acima do
// caller) — e é rejeitado como "duplicado" mesmo sendo a primeira tentativa
// que de fato tentou gravar algo. Corrigido: só reivindica a chave DEPOIS
// de passar na checagem de saldo, logo antes do `store.add` — assim uma
// tentativa que falha na validação nunca consome a chave, e uma duplicata
// de verdade (mesma dedupeKey reenviada após um pagamento que já teve
// sucesso) ainda é barrada normalmente.
export async function recordPayment({ customerId, amount, paymentMethod, cashSessionId = null, note = '', userId, userName, dedupeKey }) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Informe um valor de pagamento maior que zero.');

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
  try {
    await dbTransaction(['customerDebts', 'idempotencyKeys'], 'readwrite', (transaction) => {
      const store = transaction.objectStore('customerDebts');
      const getAllReq = store.index('byCustomerId').getAll(customerId);
      getAllReq.onsuccess = () => {
        const balance = getAllReq.result.reduce((sum, e) => sum + (e.type === 'fiado' ? e.amount : -e.amount), 0);
        if (value > balance + 0.01) {
          // Não aborta a transação (abortar perderia a mensagem de erro
          // amigável — ver db.js) — só não grava nada. A transação
          // completa normalmente, vazia, e o erro é lançado depois, fora
          // dela, com o saldo real que foi lido. Como a chave de
          // idempotência ainda não foi reivindicada neste ponto (só é
          // reivindicada logo abaixo, depois desta checagem), essa
          // transação vazia NÃO consome `dedupeKey`.
          validationError = `O cliente deve ${formatMoney(balance)} — não é possível registrar um pagamento maior que a dívida.`;
          return;
        }
        claimIdempotencyKey(transaction, dedupeKey, () => {
          validationError = 'Este pagamento já foi registrado — evite reenviar.';
          try { transaction.abort(); } catch { /* já pode não ter requisição pendente */ }
        });
        store.add(entry);
      };
    });
  } catch (err) {
    throw new Error(validationError || err.message);
  }

  if (validationError) throw new Error(validationError);
  return entry;
}
