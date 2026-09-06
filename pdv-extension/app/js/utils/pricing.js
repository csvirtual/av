// Cálculo de descontos e totais de venda — usado tanto no PDV (nova venda)
// quanto no histórico (exibição/estorno), pra garantir que as duas telas
// calculem exatamente da mesma forma.

/** Máximo de parcelas no cartão de crédito — padrão comum de "parcelamento
 * sem juros" no varejo brasileiro. Compartilhado entre a tela (que já limita
 * pelo próprio <select>, ver views/sale.js) e o createSale (data/salesRepo.js),
 * que reconfere o valor de novo — nunca confia que uma parcela vinda de fora
 * do <select> da tela (uma chamada direta a createSale) já veio dentro do
 * limite. */
export const MAX_INSTALLMENTS = 12;

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
function discountAmount(baseAmount, type, value) {
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
  //
  // Achado de auditoria (defesa em profundidade): `ci.monthlyPercent`/
  // `fixedPercent` já são limitados a 100% na origem (ver
  // data/companyRepo.js#saveCompany), mas essa função não confia só nisso
  // — `policies` pode vir de um backup restaurado de uma versão anterior
  // (sem o teto ainda), ou de qualquer chamador futuro que monte o objeto
  // na mão. `MAX_RATE_PERCENT` também trava o produto final
  // (monthlyPercent × parcelas), não só cada lado — 100%/mês × 12 parcelas
  // sozinho já daria 1200% sem essa segunda trava.
  const MAX_RATE_PERCENT = 1200;
  const rawRatePercent = ci.type === 'fixed'
    ? Math.max(0, Number(ci.fixedPercent) || 0)
    : Math.max(0, Number(ci.monthlyPercent) || 0) * n;
  const ratePercent = Number.isFinite(rawRatePercent) ? Math.min(MAX_RATE_PERCENT, rawRatePercent) : 0;

  const interestAmount = Math.max(0, (base * ratePercent) / 100);
  return { interestAmount, totalWithInterest: base + interestAmount, ratePercent };
}

/** Quantos dias faltam pra `expiryDate` ('YYYY-MM-DD'), contando a partir da
 * meia-noite de hoje — negativo se já venceu. `null` se o produto não tem
 * validade cadastrada. */
export function daysUntilExpiry(expiryDate, now = Date.now()) {
  if (!expiryDate) return null;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const expiry = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.round((expiry.getTime() - startOfToday.getTime()) / 86400000);
}

/** true quando o produto está dentro da janela de "perto de vencer" que ele
 * mesmo define (validade + dias de antecedência, ambos cadastrados por
 * produto — ver views/products.js) e tem um preço promocional configurado.
 * Continua true depois de vencido (não volta ao preço cheio sozinho) — só
 * muda se o cadastro for atualizado. */
export function isNearExpiry(product, now = Date.now()) {
  // Number.isFinite() de propósito, não `>= 0`: `null >= 0` é `true` em JS
  // (null vira 0 na comparação numérica) — com `>= 0`, um produto com
  // validade e preço promocional cadastrados mas SEM `expiryPromoDays`
  // definido (null, o valor que productsRepo.js grava quando o campo não
  // foi preenchido) passaria batido nessa checagem e caía no `<= null` logo
  // abaixo (que vira `<= 0` pelo mesmo motivo) — entrando em promoção bem
  // antes do previsto (achado de auditoria, nunca alcançável pela tela hoje
  // porque o formulário de produto exige os três campos juntos, mas
  // continua uma armadilha pra qualquer chamada direta ao repositório).
  if (!product?.expiryDate || !(product?.promoPrice > 0) || !Number.isFinite(product?.expiryPromoDays)) return false;
  const days = daysUntilExpiry(product.expiryDate, now);
  return days !== null && days <= product.expiryPromoDays;
}

/** true quando a validade do produto já passou de verdade (dias negativos) —
 * diferente de isNearExpiry, que fica true pra sempre a partir da janela de
 * promoção e nunca é suficiente sozinho pra saber se o produto já venceu. */
export function isExpired(product, now = Date.now()) {
  const days = daysUntilExpiry(product?.expiryDate, now);
  return days !== null && days < 0;
}

/** Preço de verdade a cobrar por este produto agora — o promocional quando
 * perto de vencer, senão o preço normal. Usado tanto pra exibir na tela
 * (Estoque, PDV, Painel) quanto — mais importante — como fonte de verdade do
 * unitPrice gravado na venda (ver data/salesRepo.js), nunca um valor que o
 * carrinho tenha carregado consigo. */
export function effectivePrice(product, now = Date.now()) {
  return isNearExpiry(product, now) ? product.promoPrice : product.price;
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
