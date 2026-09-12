// Cálculo de preço/desconto/juro — espelha app/js/utils/pricing.js da
// extensão single-machine, campo por campo e limite por limite (nunca
// reimplementado "por lembrança"), porque é exatamente daqui que
// routes/sales.js deriva o preço/juro DE VERDADE de cada venda — nunca do
// que o cliente mandou no corpo do pedido (ver achado de auditoria em
// routes/sales.js#commitSale).

export const MAX_INSTALLMENTS = 12;
const CUSTOM_UNIT_VALUE = 'personalizado';

export function applyDiscount(amount, type, value) {
  const v = Number(value) || 0;
  if (!type || v <= 0) return amount;
  if (type === 'percent') return Math.max(0, amount - (amount * Math.min(v, 100)) / 100);
  if (type === 'fixed') return Math.max(0, amount - v);
  return amount;
}

/** Quantos dias faltam pra `expiryDate` ('YYYY-MM-DD'), contando a partir
 * da meia-noite de hoje — negativo se já venceu, `null` sem validade
 * cadastrada. Idêntico a utils/pricing.js#daysUntilExpiry. */
export function daysUntilExpiry(expiryDate, now = Date.now()) {
  if (!expiryDate) return null;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const expiry = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.round((expiry.getTime() - startOfToday.getTime()) / 86400000);
}

/** Idêntico a utils/pricing.js#isNearExpiry — Number.isFinite() de
 * propósito, não `>= 0` (`null >= 0` é `true` em JS). */
export function isNearExpiry(product, now = Date.now()) {
  if (!product?.expiryDate || !(product?.promoPrice > 0) || !Number.isFinite(product?.expiryPromoDays)) return false;
  const days = daysUntilExpiry(product.expiryDate, now);
  return days !== null && days <= product.expiryPromoDays;
}

/** Preço de verdade a cobrar por um produto de unidade normal AGORA — o
 * promocional quando perto de vencer, senão o preço normal. Fonte de
 * verdade do unitPrice gravado numa venda (ver routes/sales.js), nunca um
 * valor que o carrinho tenha mandado. */
export function effectivePrice(product, now = Date.now()) {
  return isNearExpiry(product, now) ? product.promoPrice : product.price;
}

/** Preço/custo/fator de estoque de UM item do carrinho, sempre a partir de
 * `product` recém-lido do banco (nunca do que o pedido mandou) — idêntico
 * a app/js/data/salesRepo.js#resolveSaleItemPricing. Produto
 * 'personalizado' não tem preço único: `item.formName` diz qual forma foi
 * escolhida, buscada de novo agora no produto — se não existir mais
 * (removida/renomeada depois do item já estar no carrinho), rejeita em vez
 * de usar um preço desatualizado. `formFator` fica `undefined` pra produto
 * normal — todo lugar que usa isso faz `(formFator || 1)`. */
export function resolveSaleItemPricing(product, item, now = Date.now()) {
  if (product.unit !== CUSTOM_UNIT_VALUE) {
    return { unitPrice: effectivePrice(product, now), costPrice: undefined, formFator: undefined, unitLabel: product.unit };
  }
  const form = (product.customForms || []).find((f) => f.forma === item.formName);
  if (!form) {
    throw new Error(`A forma de venda "${item.formName || ''}" de "${product.name}" não existe mais — remova o item do carrinho e adicione de novo.`);
  }
  return { unitPrice: form.valor, costPrice: form.custo, formFator: form.fator, unitLabel: form.forma };
}

/** Juro de parcelamento no cartão de crédito — idêntico a
 * utils/pricing.js#computeCreditInterest, incluindo os dois tetos de
 * sanidade (100% por linha, 1200% no produto final monthlyPercent×parcelas)
 * contra erro de digitação/backup de versão antiga na política. */
export function computeCreditInterest(baseAmount, installments, policies) {
  const n = Math.max(1, Math.floor(Number(installments) || 1));
  const ci = policies?.creditInterest;
  const base = Math.max(0, Number(baseAmount) || 0);
  if (n <= 1 || !ci) return { interestAmount: 0, totalWithInterest: base, ratePercent: 0 };

  const freeUpTo = ci.freeInstallmentsEnabled ? Math.max(1, Math.floor(Number(ci.freeInstallments)) || 1) : 1;
  if (n <= freeUpTo) return { interestAmount: 0, totalWithInterest: base, ratePercent: 0 };

  const MAX_RATE_PERCENT = 1200;
  const rawRatePercent = ci.type === 'fixed'
    ? Math.max(0, Number(ci.fixedPercent) || 0)
    : Math.max(0, Number(ci.monthlyPercent) || 0) * n;
  const ratePercent = Number.isFinite(rawRatePercent) ? Math.min(MAX_RATE_PERCENT, rawRatePercent) : 0;

  const interestAmount = Math.max(0, (base * ratePercent) / 100);
  return { interestAmount, totalWithInterest: base + interestAmount, ratePercent };
}
