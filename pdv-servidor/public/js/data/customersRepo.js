// Clientes — versão multi-terminal. Escopo desta primeira fatia: só
// `getCustomerBalance`, o que views/sale.js lê (saldo devedor do cliente
// selecionado, antes de vender fiado). `createCustomer`/`listCustomers`/
// `recordPayment`/extrato (usados por uma futura views/clientes.js
// portada) ficam pra quando essa tela for a vez.
import { api } from './apiClient.js';

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
