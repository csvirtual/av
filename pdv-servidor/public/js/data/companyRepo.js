// Dados/políticas da loja — versão multi-terminal. Escopo desta primeira
// fatia: só `getCompany`, o que views/sale.js lê (`company.policies.X`
// pro limite de desconto e juro de parcelamento). `saveCompany`/
// `isCompanyRegistered` (usados por uma futura views/company.js e pelo
// assistente de instalação portados) ficam pra quando essa tela for a
// vez — o servidor ainda nem tem um fluxo de cadastro inicial da loja
// (cnpj, endereço etc.), só a política de venda em si.
import { api } from './apiClient.js';

/** Devolve `{ policies: { vendorMaxDiscountPercent, requireOpenCashSession,
 * creditInterest } }` — mesmo formato de acesso de
 * app/js/data/companyRepo.js#getCompany() da extensão
 * (`company.policies.X`), mesmo a rota do servidor guardando esses campos
 * soltos na raiz da resposta (ver routes/company.js). */
export async function getCompany() {
  const policies = await api('/api/company');
  return { policies };
}
