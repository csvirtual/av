// Cálculo de descontos e totais de venda — usado tanto no PDV (nova venda)
// quanto no histórico (exibição/estorno), pra garantir que as duas telas
// calculem exatamente da mesma forma.

/** Aplica um desconto sobre um valor. type: 'percent' | 'fixed' | null. */
export function applyDiscount(amount, type, value) {
  const v = Number(value) || 0;
  if (!type || v <= 0) return amount;
  if (type === 'percent') return Math.max(0, amount - (amount * Math.min(v, 100)) / 100);
  if (type === 'fixed') return Math.max(0, amount - v);
  return amount;
}

/** Valor do desconto em reais (não o valor final) — usado pra somar o total
 * de desconto da venda e comparar contra o limite do vendedor. */
export function discountAmount(baseAmount, type, value) {
  return Math.max(0, baseAmount - applyDiscount(baseAmount, type, value));
}

/** Calcula o juro de parcelamento no cartão de crédito — configurado pelo
 * lojista em Dados da loja → Políticas de venda, nunca decidido pelo
 * vendedor na hora (ver tópico "Vendas (PDV)" na Ajuda). `baseAmount` é a
 * parte do total da venda coberta por aquela forma de pagamento (o
 * "preço do produto", sem o juro embutido ainda).
 *
 * 1x nunca tem juro, não importa a configuração — não é parcelamento de
 * verdade, é só aceitar o cartão como forma de pagamento à vista. Da 2ª
 * parcela em diante, só cobra juro se passar do número de parcelas
 * isentas configurado (ou de qualquer parcela, se a isenção estiver
 * desligada). */
export function computeCreditInterest(baseAmount, installments, policies) {
  const n = Math.max(1, Math.floor(Number(installments) || 1));
  const ci = policies?.creditInterest;
  const base = Math.max(0, Number(baseAmount) || 0);
  if (n <= 1 || !ci) return { interestAmount: 0, totalWithInterest: base, ratePercent: 0 };

  const freeUpTo = ci.freeInstallmentsEnabled ? Math.max(1, Math.floor(Number(ci.freeInstallments)) || 1) : 1;
  if (n <= freeUpTo) return { interestAmount: 0, totalWithInterest: base, ratePercent: 0 };

  // 'fixed': um percentual único, igual não importa quantas parcelas.
  // 'monthly' (padrão): percentual ao mês, multiplicado pelo número de
  // parcelas — quanto mais parcelas, mais juro total, como financiamento
  // de verdade.
  const ratePercent = ci.type === 'fixed'
    ? Math.max(0, Number(ci.fixedPercent) || 0)
    : Math.max(0, Number(ci.monthlyPercent) || 0) * n;

  const interestAmount = Math.max(0, (base * ratePercent) / 100);
  return { interestAmount, totalWithInterest: base + interestAmount, ratePercent };
}

/** Recalcula os totais de um carrinho: subtotal bruto, desconto de itens,
 * desconto geral (aplicado sobre o valor já líquido dos itens) e total
 * final. Usado tanto pra exibir em tempo real no PDV quanto pra montar o
 * registro da venda ao finalizar. */
export function computeCartTotals(items, overallDiscountType, overallDiscountValue) {
  let subtotal = 0;
  let itemsDiscountTotal = 0;
  for (const item of items) {
    const gross = item.unitPrice * item.qty;
    const net = applyDiscount(gross, item.discountType, item.discountValue);
    subtotal += gross;
    itemsDiscountTotal += gross - net;
  }
  const afterItemsDiscount = subtotal - itemsDiscountTotal;
  const overallDiscountAmount = discountAmount(afterItemsDiscount, overallDiscountType, overallDiscountValue);
  const total = Math.max(0, afterItemsDiscount - overallDiscountAmount);
  const totalDiscountPercent = subtotal > 0 ? ((itemsDiscountTotal + overallDiscountAmount) / subtotal) * 100 : 0;
  return { subtotal, itemsDiscountTotal, overallDiscountAmount, total, totalDiscountPercent };
}
