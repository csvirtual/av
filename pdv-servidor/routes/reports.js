// Fase 9 (ao ligar views/relatorios.js): relatórios gerenciais — agrega
// dados que já existem (vendas, produtos), não guarda nada novo. Mesma
// lógica de agregação de data/reportsRepo.js#computeSalesReport da
// extensão, portada byte-a-byte, mas calculada AQUI (servidor) em vez de
// no navegador: buscar todas as vendas do período pro cliente reduzir em
// JS jogaria fora exatamente a otimização que a própria extensão já fez
// (varrer só o intervalo pelo índice de timestamp, não a tabela inteira) —
// aqui o servidor já tem a tabela local, faz a mesma varredura indexada,
// e devolve só o relatório pronto (poucos KB), nunca as vendas cruas.
//
// Permissão 'relatorios' no mount (ver server.js) — envolve margem de
// lucro (custo), dado sensível, mesmo critério da extensão (rota
// 'relatorios' com permission própria em app.js).
import { Router } from 'express';
import { db } from '../db/index.js';

const router = Router();

const listSalesInRangeStmt = db.prepare(`
  SELECT data FROM sales
  WHERE (@from IS NULL OR timestamp >= @from) AND (@to IS NULL OR timestamp <= @to)
`);
const listProductsStmt = db.prepare('SELECT data FROM products');

function netSaleTotal(sale) {
  return sale.total - sale.refundedTotal;
}
function netSaleTotalWithInterest(sale) {
  return netSaleTotal(sale) + (sale.creditInterestTotal || 0);
}

router.get('/vendas', (req, res) => {
  const from = req.query.from != null && req.query.from !== '' ? Number(req.query.from) : null;
  const to = req.query.to != null && req.query.to !== '' ? Number(req.query.to) : null;

  const products = listProductsStmt.all().map((r) => JSON.parse(r.data));
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));

  const bySellerMap = {};
  const byProductMap = {};
  let totalRevenue = 0;
  let totalCount = 0;

  const sales = listSalesInRangeStmt.all({ from, to }).map((r) => JSON.parse(r.data));
  for (const s of sales) {
    if (!bySellerMap[s.userId]) bySellerMap[s.userId] = { userId: s.userId, userName: s.userName, revenue: 0, count: 0 };
    bySellerMap[s.userId].revenue += netSaleTotalWithInterest(s);
    bySellerMap[s.userId].count += 1;

    const itemsLineSum = s.items.reduce((sum, i) => sum + i.lineTotal, 0);
    const ratio = itemsLineSum > 0 ? netSaleTotal(s) / itemsLineSum : 1;
    for (const item of s.items) {
      const soldQty = item.qty - item.qtyRefunded;
      if (soldQty <= 0) continue;
      const unitNet = (item.lineTotal / item.qty) * ratio;
      const revenue = unitNet * soldQty;
      const product = productMap[item.productId];
      const cost = (item.costPrice !== undefined ? item.costPrice : (product?.costPrice || 0)) * soldQty;
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

    totalRevenue += netSaleTotalWithInterest(s);
    totalCount += 1;
  }

  const avgTicket = totalCount > 0 ? totalRevenue / totalCount : 0;
  const bySeller = Object.values(bySellerMap).sort((a, b) => b.revenue - a.revenue);

  const totalCost = Object.values(byProductMap).reduce((sum, p) => sum + p.cost, 0);
  const totalMargin = totalRevenue - totalCost;

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

  res.json({ totalRevenue, totalCount, avgTicket, totalCost, totalMargin, bySeller, byProduct, byCategory });
});

export default router;
