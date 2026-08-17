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
import { applyDiscount, discountAmount } from '../utils/pricing.js';

const PAYMENT_TOLERANCE = 0.01; // arredondamento de centavos

/** Registra uma venda completa: confere estoque de cada item, calcula
 * descontos (por item e geral), debita a quantidade vendida (via stockRepo,
 * que também grava a movimentação) e só então grava o registro da venda.
 * Se qualquer item não tiver estoque suficiente, ou a soma dos pagamentos
 * não bater com o total, nada é gravado. */
export async function createSale({
  userId, userName, items,
  overallDiscountType = null, overallDiscountValue = 0,
  payments, discountApprovedBy = null,
}) {
  if (!items || items.length === 0) throw new Error('A venda precisa ter pelo menos um item.');
  if (!payments || payments.length === 0) throw new Error('Informe ao menos uma forma de pagamento.');

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
    refunds: [],
    refundedTotal: 0,
  };
  await dbAdd('sales', sale);
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
    const unitNet = saleItem.lineTotal / saleItem.qty; // preço médio já líquido de desconto
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
