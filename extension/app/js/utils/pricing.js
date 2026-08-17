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
