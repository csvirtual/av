// Vendas realizadas. Cada venda é uma lista de itens (produto, quantidade,
// preço unitário e desconto no momento da venda) amarrada ao vendedor
// responsável e ao timestamp exato — é o registro que alimenta o histórico
// de vendas (visível a todos os perfis) e o log de auditoria (admin).
//
// Também guarda os pagamentos (pode ser mais de uma forma na mesma venda) e
// o histórico de estornos — uma venda nunca é apagada ou reescrita por um
// estorno, só ganha uma entrada em `refunds` e os itens afetados marcam
// quanto já foi devolvido (`qtyRefunded`), preservando o valor original pra
// auditoria.
import { dbGetAll, dbGet, dbPut, dbAdd, newId } from '../db.js';
import { getProduct } from './productsRepo.js';
import { recordMovement } from './stockRepo.js';
import { recordDebt } from './customersRepo.js';
import { recordEarn, recordReversal, listCustomerLoyaltyLedger } from './loyaltyRepo.js';
import { getCompany } from './companyRepo.js';
import { applyDiscount, discountAmount } from '../utils/pricing.js';

const PAYMENT_TOLERANCE = 0.01; // arredondamento de centavos
const FIADO_METHOD = 'Fiado';

/** Registra uma venda completa: confere estoque de cada item, calcula
 * descontos (por item e geral), debita a quantidade vendida (via stockRepo,
 * que também grava a movimentação) e só então grava o registro da venda.
 * Se qualquer item não tiver estoque suficiente, ou a soma dos pagamentos
 * não bater com o total, nada é gravado. Uma venda com pagamento em
 * "Fiado" precisa de um cliente selecionado — vira uma dívida na conta
 * dele (ver data/customersRepo.js), não dinheiro entrando agora. */
export async function createSale({
  userId, userName, items,
  overallDiscountType = null, overallDiscountValue = 0,
  payments, discountApprovedBy = null, cashSessionId = null, customerId = null,
}) {
  if (!items || items.length === 0) throw new Error('A venda precisa ter pelo menos um item.');
  if (!payments || payments.length === 0) throw new Error('Informe ao menos uma forma de pagamento.');

  const fiadoTotal = payments.filter((p) => p.method === FIADO_METHOD).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  if (fiadoTotal > 0 && !customerId) {
    throw new Error('Selecione um cliente para vender fiado.');
  }

  // Confere estoque de todos os itens antes de debitar qualquer um —
  // evita vender parte do carrinho e travar no meio por falta de estoque.
  const products = [];
  for (const item of items) {
    const product = await getProduct(item.productId);
    if (!product) throw new Error('Produto não encontrado no carrinho.');
    if (product.quantity < item.qty) {
      throw new Error(`Estoque insuficiente de "${product.name}" (disponível: ${product.quantity}).`);
    }
    products.push(product);
  }

  let subtotal = 0;
  let itemsDiscountTotal = 0;
  const saleItems = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const product = products[i];
    const gross = product.price * item.qty;
    const net = applyDiscount(gross, item.discountType, item.discountValue);
    subtotal += gross;
    itemsDiscountTotal += gross - net;
    saleItems.push({
      productId: product.id, name: product.name, barcode: product.barcode, unit: product.unit,
      qty: item.qty, unitPrice: product.price,
      discountType: item.discountType || null, discountValue: Number(item.discountValue) || 0,
      lineTotal: net, qtyRefunded: 0,
    });
  }

  const afterItemsDiscount = subtotal - itemsDiscountTotal;
  const overallDiscountAmount = discountAmount(afterItemsDiscount, overallDiscountType, overallDiscountValue);
  const total = Math.max(0, afterItemsDiscount - overallDiscountAmount);

  const paymentsTotal = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  if (Math.abs(paymentsTotal - total) > PAYMENT_TOLERANCE) {
    throw new Error(`Os pagamentos (${paymentsTotal.toFixed(2)}) não somam o total da venda (${total.toFixed(2)}).`);
  }

  for (const item of items) {
    await recordMovement({
      productId: item.productId, type: 'venda', qty: -item.qty,
      userId, userName, note: 'Baixa por venda',
    });
  }

  const sale = {
    id: newId(),
    timestamp: Date.now(),
    userId, userName,
    items: saleItems,
    subtotal,
    itemsDiscountTotal,
    overallDiscountType: overallDiscountType || null,
    overallDiscountValue: Number(overallDiscountValue) || 0,
    overallDiscountAmount,
    total,
    payments: payments.map((p) => ({ method: p.method, amount: Number(p.amount) || 0 })),
    discountApprovedBy,
    cashSessionId,
    customerId,
    refunds: [],
    refundedTotal: 0,
  };
  await dbAdd('sales', sale);

  if (fiadoTotal > 0) {
    await recordDebt({ customerId, amount: fiadoTotal, saleId: sale.id, userId, userName });
  }

  if (customerId) {
    const company = await getCompany();
    const rate = company?.policies?.loyaltyPointsPerReal ?? 0;
    if (rate > 0) {
      const points = Math.floor(total * rate);
      if (points > 0) await recordEarn({ customerId, points, saleId: sale.id, userId, userName });
    }
  }

  return sale;
}

export async function listSales() {
  const sales = await dbGetAll('sales');
  return sales.sort((a, b) => b.timestamp - a.timestamp);
}

export async function getSale(id) {
  return dbGet('sales', id);
}

/** Estorna um ou mais itens de uma venda (total ou parcial). Devolve a
 * quantidade ao estoque (via stockRepo, que também grava a movimentação de
 * tipo 'estorno'), marca quanto de cada item já foi devolvido e adiciona um
 * registro em `refunds` — a venda original nunca é alterada retroativamente,
 * só ganha esse histórico por cima. `generateCredit` sinaliza que o valor
 * pode virar crédito de troca numa venda futura (ver session.js); quem usa
 * o crédito depois é a tela de Nova Venda, não este módulo. */
export async function refundSaleItems({ saleId, userId, userName, reason, items, generateCredit = false }) {
  if (!reason || !reason.trim()) throw new Error('Informe o motivo do estorno.');
  if (!items || items.length === 0) throw new Error('Selecione ao menos um item para estornar.');

  const sale = await getSale(saleId);
  if (!sale) throw new Error('Venda não encontrada.');

  // `lineTotal` de cada item reflete só o desconto por item — o desconto
  // geral do carrinho (aplicado sobre o total da venda, não guardado por
  // item) fica de fora dele. Sem ratear essa diferença aqui, um estorno
  // devolveria mais do que o cliente pagou de fato numa venda com desconto
  // geral. `discountRatio` traz o valor de cada unidade pro preço líquido
  // realmente cobrado (mesmo raciocínio usado em reportsRepo.js).
  const lineTotalSum = sale.items.reduce((sum, i) => sum + i.lineTotal, 0);
  const discountRatio = lineTotalSum > 0 ? sale.total / lineTotalSum : 1;

  const refundItems = [];
  let totalRefunded = 0;

  for (const req of items) {
    const qty = Number(req.qty) || 0;
    if (qty <= 0) continue;
    const saleItem = sale.items.find((i) => i.productId === req.productId);
    if (!saleItem) throw new Error('Item não encontrado nesta venda.');
    const available = saleItem.qty - saleItem.qtyRefunded;
    if (qty > available) {
      throw new Error(`Só é possível estornar até ${available} de "${saleItem.name}" (já estornado: ${saleItem.qtyRefunded}).`);
    }
    const unitNet = (saleItem.lineTotal / saleItem.qty) * discountRatio;
    const amount = unitNet * qty;
    refundItems.push({ productId: saleItem.productId, name: saleItem.name, qty, amount });
    totalRefunded += amount;
    saleItem.qtyRefunded += qty;
  }

  if (refundItems.length === 0) throw new Error('Selecione ao menos um item para estornar.');

  for (const ri of refundItems) {
    await recordMovement({
      productId: ri.productId, type: 'estorno', qty: ri.qty,
      userId, userName, note: `Estorno da venda — ${reason.trim()}`,
    });
  }

  const refund = {
    id: newId(),
    timestamp: Date.now(),
    userId, userName,
    reason: reason.trim(),
    items: refundItems,
    totalRefunded,
    creditGenerated: !!generateCredit,
  };
  sale.refunds.push(refund);
  sale.refundedTotal += totalRefunded;
  await dbPut('sales', sale);

  // Reverte proporcionalmente os pontos de fidelidade ganhos por esta
  // venda — sem isso, um cliente manteria pontos de compras que devolveu.
  // Fica negativo se ele já tiver resgatado esses pontos antes do estorno;
  // é o mesmo compromisso de qualquer programa de fidelidade real.
  if (sale.customerId && sale.total > 0) {
    const ledger = await listCustomerLoyaltyLedger(sale.customerId);
    const pointsEarned = ledger
      .filter((e) => e.saleId === sale.id && e.type === 'ganho')
      .reduce((sum, e) => sum + e.points, 0);
    if (pointsEarned > 0) {
      const pointsToReverse = Math.floor(pointsEarned * (totalRefunded / sale.total));
      if (pointsToReverse > 0) {
        await recordReversal({ customerId: sale.customerId, points: pointsToReverse, saleId: sale.id, userId, userName });
      }
    }
  }

  return { sale, refund };
}

/** Status derivado da venda, pra exibição (badge na lista, etc.) — não é
 * gravado no registro, é calculado a partir de qtyRefunded de cada item. */
export function saleStatus(sale) {
  const totalQty = sale.items.reduce((sum, i) => sum + i.qty, 0);
  const refundedQty = sale.items.reduce((sum, i) => sum + i.qtyRefunded, 0);
  if (refundedQty === 0) return 'completa';
  if (refundedQty >= totalQty) return 'estornada';
  return 'parcial';
}
