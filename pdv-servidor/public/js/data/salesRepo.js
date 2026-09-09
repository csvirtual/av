// Vendas — versão multi-terminal. Escopo desta primeira fatia: só
// `createSale`, o que `views/sale.js` (PDV) chama de fato — `listSales`,
// `refundSaleItems`, `summarizeSales` etc. (usados por
// views/salesHistory.js, ainda não portada) ficam pra quando essa tela
// for a vez.
//
// Toda a lógica de negócio pesada (validação de estoque, preço "de
// verdade" do produto/forma personalizada nunca confiado do cliente,
// autorização de desconto acima do limite, juro de parcelamento
// recalculado a partir da política da loja, atomicidade, dedupeKey) já
// mora no servidor (ver routes/sales.js#commitSale) — mesmo espírito do
// resto desta camada: aqui é só a chamada formatada.
import { api, newDedupeKey } from './apiClient.js';

export async function createSale({
  userId, userName, cashSessionId, // aceitos só pra bater a assinatura da extensão — servidor sempre resolve quem vendeu (sessão) e qual caixa está aberto (terminalId) sozinho, nunca do que o cliente mandou
  items, overallDiscountType = null, overallDiscountValue = 0,
  payments, discountApproval = null, customerId = null, dedupeKey = null,
}) {
  void userId; void userName; void cashSessionId;
  const { sale } = await api('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items, overallDiscountType, overallDiscountValue, payments,
      discountApproval, customerId, dedupeKey: dedupeKey || newDedupeKey(),
    }),
  });
  return sale;
}
