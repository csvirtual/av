// Vendas — versão multi-terminal. `createSale` (Fase 9, passo 4) mais
// `listSalesPage`/`summarizeSales`/`refundSaleItems`/`saleStatus` (passo
// 7, o que views/salesHistory.js precisa). `listSales`/`rebuildDailySales`/
// `reduceSales` (sem tela dona ainda) ficam de fora por enquanto.
//
// Toda a lógica de negócio pesada (validação de estoque, preço "de
// verdade" do produto/forma personalizada nunca confiado do cliente,
// autorização de desconto acima do limite, juro de parcelamento
// recalculado a partir da política da loja, atomicidade, dedupeKey) já
// mora no servidor (ver routes/sales.js#commitSale/commitRefund) — mesmo
// espírito do resto desta camada: aqui é só a chamada formatada.
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

function buildQuery({ sellerId, customerId, fromTs, toTs, limit, afterKey, afterId }) {
  const params = new URLSearchParams();
  if (sellerId) params.set('sellerId', sellerId);
  if (customerId) params.set('customerId', customerId);
  if (fromTs != null) params.set('fromTs', fromTs);
  if (toTs != null) params.set('toTs', toTs);
  if (limit != null) params.set('limit', limit);
  // `afterKey`, na extensão, é o valor do índice byTimestamp da última
  // linha da página anterior — aqui o servidor pagina pelo mesmo
  // par (timestamp, id), só com outro nome (ver routes/sales.js GET /).
  if (afterKey != null) params.set('afterTs', afterKey);
  if (afterId != null) params.set('afterId', afterId);
  return params.toString();
}

/** Página do Histórico de vendas — mesmo contrato de
 * app/js/data/salesRepo.js#listSalesPage() da extensão (`afterKey`/`afterId`
 * vêm da página anterior, undefined pra primeira). A paginação real (não
 * carregar a tabela `sales` inteira) já é feita pelo servidor. */
export async function listSalesPage({ sellerId, customerId, fromTs, toTs, limit = 50, afterKey, afterId } = {}) {
  const qs = buildQuery({ sellerId, customerId, fromTs, toTs, limit, afterKey, afterId });
  const { items, hasMore, nextAfterTs, nextAfterId } = await api(`/api/sales?${qs}`);
  return { items, hasMore, nextKey: nextAfterTs, nextId: nextAfterId };
}

/** Contagem + total líquido do filtro, sem carregar as vendas em si — mesmo
 * contrato de summarizeSales() da extensão. O servidor já calcula isso na
 * mesma consulta de listSalesPage (ver routes/sales.js#`summary`); `limit:
 * 1` aqui é só pra não trazer página nenhuma de item, só o resumo. */
export async function summarizeSales({ sellerId, customerId, fromTs, toTs } = {}) {
  const qs = buildQuery({ sellerId, customerId, fromTs, toTs, limit: 1 });
  const { summary } = await api(`/api/sales?${qs}`);
  return summary;
}

/** Estorno total ou parcial — mesmo contrato de refundSaleItems() da
 * extensão. `cashSessionId` é aceito só pra bater a assinatura: o servidor
 * sempre resolve a sessão de caixa ABERTA agora a partir do terminal (nunca
 * do que o cliente mandou — mesmo raciocínio de createSale acima). */
export async function refundSaleItems({
  saleId, userId, userName, reason, items, generateCredit = false, cashSessionId = null, dedupeKey = null,
}) {
  void userId; void userName; void cashSessionId;
  return api(`/api/sales/${encodeURIComponent(saleId)}/refund`, {
    method: 'POST',
    body: JSON.stringify({ reason, items, generateCredit, dedupeKey: dedupeKey || newDedupeKey() }),
  });
}

/** Status derivado da venda pra exibição — cópia fiel de
 * app/js/data/salesRepo.js#saleStatus(): puro, não toca rede nenhuma. */
export function saleStatus(sale) {
  const totalQty = sale.items.reduce((sum, i) => sum + i.qty, 0);
  const refundedQty = sale.items.reduce((sum, i) => sum + i.qtyRefunded, 0);
  if (refundedQty === 0) return 'completa';
  if (refundedQty >= totalQty) return 'estornada';
  return 'parcial';
}
