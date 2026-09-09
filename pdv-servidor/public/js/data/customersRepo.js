// Clientes — versão multi-terminal. Escopo desta fatia: `getCustomerBalance`
// (views/sale.js, saldo devedor antes de vender fiado) e
// `searchCustomers`/`createCustomer` (components/customerPicker.js,
// compartilhado por sale.js pro seletor de cliente da venda).
// `recordPayment`/extrato/edição (usados por uma futura views/clientes.js
// portada) ficam pra quando essa tela for a vez.
import { api } from './apiClient.js';

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
