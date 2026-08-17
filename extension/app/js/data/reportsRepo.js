// Relatórios gerenciais: agrega dados que já existem (vendas, produtos) —
// não guarda nada novo no banco, só calcula em cima do que já está lá.
//
// Simplificação assumida na margem de lucro: usa o preço de custo ATUAL de
// cada produto pra todas as vendas do período, mesmo as mais antigas — não
// existe (ainda) um histórico de custo por venda. Se o custo mudou desde
// então, a margem de vendas antigas é uma estimativa, não o valor exato
// daquele momento.
import { listSales } from './salesRepo.js';
import { listProducts } from './productsRepo.js';

function netSaleTotal(sale) {
  return sale.total - sale.refundedTotal;
}

export async function computeSalesReport({ from = null, to = null } = {}) {
  const allSales = await listSales();
  const sales = allSales.filter((s) => (!from || s.timestamp >= from) && (!to || s.timestamp <= to));

  const totalRevenue = sales.reduce((sum, s) => sum + netSaleTotal(s), 0);
  const totalCount = sales.length;
  const avgTicket = totalCount > 0 ? totalRevenue / totalCount : 0;

  const bySellerMap = {};
  for (const s of sales) {
    if (!bySellerMap[s.userId]) bySellerMap[s.userId] = { userId: s.userId, userName: s.userName, revenue: 0, count: 0 };
    bySellerMap[s.userId].revenue += netSaleTotal(s);
    bySellerMap[s.userId].count += 1;
  }
  const bySeller = Object.values(bySellerMap).sort((a, b) => b.revenue - a.revenue);

  const products = await listProducts();
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));

  const byProductMap = {};
  for (const s of sales) {
    // item.lineTotal só reflete o desconto por item — o desconto geral do
    // carrinho (aplicado sobre o total da venda, não guardado por item) fica
    // de fora dele. Sem ratear essa diferença aqui, a soma da receita por
    // produto/categoria ficaria maior que o faturamento total de vendas com
    // desconto geral. `ratio` traz cada item pro mesmo total líquido da venda.
    const itemsLineSum = s.items.reduce((sum, i) => sum + i.lineTotal, 0);
    const ratio = itemsLineSum > 0 ? netSaleTotal(s) / itemsLineSum : 1;
    for (const item of s.items) {
      const soldQty = item.qty - item.qtyRefunded;
      if (soldQty <= 0) continue;
      const unitNet = (item.lineTotal / item.qty) * ratio;
      const revenue = unitNet * soldQty;
      const product = productMap[item.productId];
      const cost = (product?.costPrice || 0) * soldQty;
      if (!byProductMap[item.productId]) {
        byProductMap[item.productId] = {
          productId: item.productId, name: item.name, category: product?.category || '',
          qty: 0, revenue: 0, cost: 0,
        };
      }
      byProductMap[item.productId].qty += soldQty;
      byProductMap[item.productId].revenue += revenue;
      byProductMap[item.productId].cost += cost;
    }
  }

  const totalCost = Object.values(byProductMap).reduce((sum, p) => sum + p.cost, 0);
  const totalMargin = totalRevenue - totalCost;

  // Curva ABC: ordena por receita desc e classifica pelo % acumulado do
  // faturamento total — A até 80%, B até 95%, C o resto.
  const byProduct = Object.values(byProductMap)
    .map((p) => ({ ...p, margin: p.revenue - p.cost }))
    .sort((a, b) => b.revenue - a.revenue);
  let cumulative = 0;
  for (const p of byProduct) {
    cumulative += p.revenue;
    const pct = totalRevenue > 0 ? cumulative / totalRevenue : 0;
    p.curveClass = pct <= 0.8 ? 'A' : pct <= 0.95 ? 'B' : 'C';
  }

  const byCategoryMap = {};
  for (const p of byProduct) {
    const cat = p.category || 'sem categoria';
    if (!byCategoryMap[cat]) byCategoryMap[cat] = { category: cat, revenue: 0, qty: 0 };
    byCategoryMap[cat].revenue += p.revenue;
    byCategoryMap[cat].qty += p.qty;
  }
  const byCategory = Object.values(byCategoryMap).sort((a, b) => b.revenue - a.revenue);

  return { totalRevenue, totalCount, avgTicket, totalCost, totalMargin, bySeller, byProduct, byCategory };
}
