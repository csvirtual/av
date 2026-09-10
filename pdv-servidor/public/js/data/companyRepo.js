// Dados/políticas da loja — versão multi-terminal. `getCompany`/
// `saveCompany` cobrem a política de venda (desconto máximo do vendedor,
// exigir caixa aberto, juro do parcelamento no cartão) — o que
// views/company.js (nova, enxuta) edita e views/sale.js lê
// (`company.policies.X`). `isCompanyRegistered`/cadastro inicial (cnpj,
// endereço, ATIVAÇÃO DE LICENÇA) ficam de fora de propósito: o servidor
// não tem esse conceito (sem trial/demo bloqueando o uso, ver
// README) — a extensão original mistura isso tudo numa `views/company.js`
// só; aqui a tela nova extrai SÓ a política de venda, que é a parte sem
// nenhuma relação com licenciamento comercial.
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

/** Grava um PATCH das políticas — só os campos presentes no objeto são
 * alterados (ver routes/company.js#PUT, que ecoa esse mesmo raciocínio de
 * patch parcial). Exige a permissão 'empresa' no servidor; sem ela, a
 * chamada rejeita com a mensagem amigável já pronta (ver api(), que
 * lança Error com `body.error`) — a tela mostra isso direto, sem
 * precisar checar a permissão aqui antes de propósito (mesmo padrão já
 * estabelecido em financeiro.js/backup.js: nunca confiar só na tela). */
export async function saveCompany(patch) {
  const policies = await api('/api/company', { method: 'PUT', body: JSON.stringify(patch) });
  return { policies };
}
