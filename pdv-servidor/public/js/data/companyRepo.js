// Dados/políticas da loja — versão multi-terminal. Cobre os dois blocos
// que views/company.js edita: os dados cadastrais de verdade (CNPJ, razão
// social, endereço...) — sem eles, o recibo/relatório impresso saem sem
// nome/CNPJ da loja (ver components/receipt.js/reportPrint.js, que já
// esperavam esses campos prontos) e não valem pra fiscalização — e a
// política de venda (desconto máximo, exigir caixa aberto, juro do
// parcelamento). Diferente da extensão: sem assistente de primeira
// execução separado (este servidor nunca teve um) — o CNPJ nasce vazio e
// é editável direto nesta mesma tela; uma vez salvo, trava (ver
// `cnpjLocked`/`cnpjUnlockToken` abaixo, e a validação de verdade em
// routes/company.js).
import { api } from './apiClient.js';

const POLICY_KEYS = ['vendorMaxDiscountPercent', 'requireOpenCashSession', 'creditInterest', 'loyaltyPointsPerReal'];

/** Devolve `{ cnpj, razaoSocial, ..., cnpjLocked, policies: { X } }` —
 * mesmo formato de acesso de app/js/data/companyRepo.js#getCompany() da
 * extensão (`company.cnpj` na raiz, `company.policies.X` aninhado),
 * mesmo o servidor devolvendo tudo solto na raiz da resposta (ver
 * routes/company.js). */
export async function getCompany() {
  const data = await api('/api/company');
  const info = {};
  const policies = {};
  for (const [key, value] of Object.entries(data)) {
    if (POLICY_KEYS.includes(key)) policies[key] = value;
    else info[key] = value;
  }
  return { ...info, policies };
}

/** Grava um PATCH — só os campos presentes no objeto são alterados (ver
 * routes/company.js#PUT, mesmo raciocínio de patch parcial de sempre).
 * `patch.cnpjUnlockToken` (opcional) só é necessário quando `patch.cnpj`
 * está tentando MUDAR um CNPJ que já estava cadastrado — o servidor é
 * quem decide se precisa dele ou não, esta função só repassa. */
export async function saveCompany(patch) {
  const data = await api('/api/company', { method: 'PUT', body: JSON.stringify(patch) });
  const info = {};
  const policies = {};
  for (const [key, value] of Object.entries(data)) {
    if (POLICY_KEYS.includes(key)) policies[key] = value;
    else info[key] = value;
  }
  return { ...info, policies };
}
