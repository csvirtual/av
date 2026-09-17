// Clientes — versão multi-terminal. `getCustomerBalance` (views/sale.js,
// saldo devedor antes de vender fiado) e `searchCustomers`/`createCustomer`
// (components/customerPicker.js, compartilhado por sale.js pro seletor de
// cliente da venda) são da Fase 9 passo 4; `listCustomers` (passo 7) é o
// que o filtro de cliente de views/salesHistory.js precisa. O resto
// (`updateCustomer`, `setCustomerActive`, `deleteCustomer`,
// `listCustomerLedger`, `getAllBalances`, `recordPayment`) é da Fase 9
// passo 8 — o que views/clientes.js precisa.
import { api, newDedupeKey } from './apiClient.js';

/** Lista completa de clientes — mesmo contrato de
 * app/js/data/customersRepo.js#listCustomers() da extensão. */
export async function listCustomers() {
  const { customers } = await api('/api/customers');
  return customers;
}

/** Busca por nome ou telefone (só dígitos, ignora pontuação) — mesmo
 * contrato de app/js/data/customersRepo.js#searchCustomers() da extensão.
 * Filtro já acontece no servidor (ver routes/customers.js GET /?q=),
 * diferente de productsRepo.js#searchProducts (que filtra em memória) —
 * aqui não tem motivo pra trazer a lista inteira só pra filtrar nela de
 * novo do lado do cliente. */
export async function searchCustomers(term) {
  const q = (term || '').trim();
  const { customers } = await api(`/api/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  return customers;
}

export async function createCustomer(data) {
  const { customer } = await api('/api/customers', { method: 'POST', body: JSON.stringify(data) });
  return customer;
}

/** true quando o cliente tem lembrete de vencimento definido, já passou da
 * data e ainda tem saldo devedor de verdade — cópia fiel de
 * app/js/data/customersRepo.js#isDebtOverdue(): puro, não toca rede. */
export function isDebtOverdue(customer, balance) {
  if (!customer?.debtDueDate || balance <= 0.01) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return customer.debtDueDate < startOfToday.getTime();
}

/** Saldo devedor (fiado) do cliente — mesmo contrato de
 * app/js/data/customersRepo.js#getCustomerBalance() da extensão: devolve
 * 0 pra um cliente inexistente, NUNCA lança erro (lá, o cálculo é feito
 * sobre o extrato do cliente, que simplesmente vem vazio se ele não
 * existe — nunca houve uma checagem de existência própria). A rota do
 * servidor devolve 404 nesse caso (ver routes/customers.js), então esta
 * função intercepta e trata como saldo zero, em vez de usar o
 * apiClient.js#api() padrão (que lançaria). */
export async function getCustomerBalance(customerId) {
  const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, { credentials: 'include' });
  if (res.status === 404) return 0;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
  return body.balance;
}

/** Mesmo contrato de updateCustomer() da extensão — envia só os campos
 * presentes em `data`, o servidor mantém os demais (ver routes/customers.js
 * PUT /:id). */
export async function updateCustomer(id, data) {
  const { customer } = await api(`/api/customers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
  return customer;
}

/** Ativar/desativar não é uma rota própria aqui (diferente de
 * productsRepo.js#setProductActive) — o servidor já trata `active` como
 * mais um campo de PUT /:id (ver routes/customers.js), então o contrato
 * de setCustomerActive() da extensão fecha só reaproveitando
 * updateCustomer(). */
export async function setCustomerActive(id, active) {
  return updateCustomer(id, { active });
}

/** Achado de auditoria já corrigido na FONTE (routes/customers.js DELETE
 * /:id reconfere a permissão 'deleteCustomer' contra a sessão real) —
 * este wrapper não duplica a checagem, só deixa o erro do servidor subir
 * (mesmo padrão do resto desta camada: nunca confiar em quem chama). */
export async function deleteCustomer(id) {
  await api(`/api/customers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Extrato de fiado (dívidas e pagamentos) do cliente — mesmo contrato de
 * listCustomerLedger() da extensão. */
export async function listCustomerLedger(customerId) {
  const { entries } = await api(`/api/customers/${encodeURIComponent(customerId)}/ledger`);
  return entries;
}

/** Saldo devedor de todos os clientes de uma vez — mesmo contrato de
 * getAllBalances() da extensão. */
export async function getAllBalances() {
  const { balances } = await api('/api/customers/balances');
  return balances;
}

/** Mesmo contrato de recordPayment() da extensão — a checagem "valor não
 * pode passar da dívida" e a trava contra reenvio (dedupeKey) já vivem no
 * servidor (routes/customers.js#commitPayment, mesma transação atômica),
 * nunca confiadas do cliente. */
export async function recordPayment({ customerId, amount, paymentMethod, cashSessionId = null, note = '', userId, userName, dedupeKey = null }) {
  void cashSessionId; void userId; void userName; // servidor resolve sessão de caixa/identidade sozinho — aceitos só pra bater a assinatura
  const { entry } = await api(`/api/customers/${encodeURIComponent(customerId)}/pagamento`, {
    method: 'POST',
    body: JSON.stringify({ amount, paymentMethod, note, dedupeKey: dedupeKey || newDedupeKey() }),
  });
  return entry;
}
