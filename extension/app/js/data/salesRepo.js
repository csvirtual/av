// Vendas realizadas. Cada venda é list de itens (produto, quantidade, preço
// unitário no momento da venda) amarrada ao vendedor responsável e ao
// timestamp exato — é o registro que alimenta tanto o histórico de vendas
// (visível a todos os perfis) quanto o log de auditoria (admin).
import { dbGetAll, dbAdd, newId } from '../db.js';
import { getProduct } from './productsRepo.js';
import { recordMovement } from './stockRepo.js';

/** Registra uma venda completa: confere estoque de cada item, debita a
 * quantidade vendida (via stockRepo, que também grava a movimentação) e só
 * então grava o registro da venda. Se qualquer item não tiver estoque
 * suficiente, nada é gravado. */
export async function createSale({ userId, userName, items, paymentMethod = '' }) {
  if (!items || items.length === 0) throw new Error('A venda precisa ter pelo menos um item.');

  // Confere estoque de todos os itens antes de debitar qualquer um —
  // evita vender parte do carrinho e travar no meio por falta de estoque.
  for (const item of items) {
    const product = await getProduct(item.productId);
    if (!product) throw new Error('Produto não encontrado no carrinho.');
    if (product.quantity < item.qty) {
      throw new Error(`Estoque insuficiente de "${product.name}" (disponível: ${product.quantity}).`);
    }
  }

  const saleItems = [];
  let total = 0;
  for (const item of items) {
    const product = await getProduct(item.productId);
    await recordMovement({
      productId: product.id,
      type: 'venda',
      qty: -item.qty,
      userId,
      userName,
      note: 'Baixa por venda',
    });
    const subtotal = product.price * item.qty;
    total += subtotal;
    saleItems.push({
      productId: product.id,
      name: product.name,
      barcode: product.barcode,
      unit: product.unit,
      qty: item.qty,
      unitPrice: product.price,
      subtotal,
    });
  }

  const sale = {
    id: newId(),
    timestamp: Date.now(),
    userId,
    userName,
    items: saleItems,
    total,
    paymentMethod,
  };
  await dbAdd('sales', sale);
  return sale;
}

export async function listSales() {
  const sales = await dbGetAll('sales');
  return sales.sort((a, b) => b.timestamp - a.timestamp);
}
