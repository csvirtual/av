// Relatórios gerenciais: agrega dados que já existem (vendas, produtos) —
// não guarda nada novo no banco, só calcula em cima do que já está lá.
//
// Simplificação assumida na margem de lucro: usa o preço de custo ATUAL de
// cada produto pra todas as vendas do período, mesmo as mais antigas — não
// existe (ainda) um histórico de custo por venda. Se o custo mudou desde
// então, a margem de vendas antigas é uma estimativa, não o valor exato
// daquele momento.
import { reduceSales } from './salesRepo.js';
import { listProducts } from './productsRepo.js';

function netSaleTotal(sale) {
  return sale.total - sale.refundedTotal;
}

// Inclui o juro de parcelamento no cartão (repassado pro cliente — ver
// utils/pricing.js#computeCreditInterest) — é dinheiro real que entra na
// loja além do valor dos produtos, então conta no faturamento total e por
// vendedor. Só usado nesses dois agregados: a divisão por produto/categoria
// e curva ABC abaixo continua usando netSaleTotal() puro (sem juro), porque
// juro é um valor da venda inteira, não de um item — misturar ele na
// proporção por item inflaria a receita atribuída a cada produto sem
// nenhum sentido.
function netSaleTotalWithInterest(sale) {
  return netSaleTotal(sale) + (sale.creditInterestTotal || 0);
}

export async function computeSalesReport({ from = null, to = null } = {}) {
  const products = await listProducts();
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));

  // Uma única varredura pelo índice de data (ver salesRepo.js#reduceSales)
  // acumula os três agregados de uma vez — achado de auditoria: a versão
  // anterior carregava a tabela de vendas INTEIRA (listSales()) mesmo pra
  // períodos curtos como "Hoje"/"7 dias", e ainda percorria o array
  // filtrado duas vezes (uma pra receita/vendedor, outra pra produto). Com
  // anos de histórico acumulado, "Hoje" não deveria pagar o preço de "Todo
  // o período" — agora só as vendas dentro de `from`/`to` são visitadas
  // (um relatório "Todo o período" continua visitando tudo, que é
  // inerente a somar o histórico inteiro).
  const bySellerMap = {};
  const byProductMap = {};
  const { totalRevenue, totalCount } = await reduceSales({
    fromTs: from,
    toTs: to,
    initial: { totalRevenue: 0, totalCount: 0 },
    reduceFn: (acc, s) => {
      if (!bySellerMap[s.userId]) bySellerMap[s.userId] = { userId: s.userId, userName: s.userName, revenue: 0, count: 0 };
      bySellerMap[s.userId].revenue += netSaleTotalWithInterest(s);
      bySellerMap[s.userId].count += 1;

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
        // Item de produto 'personalizado' grava o CUSTO DA FORMA vendida no
        // próprio item (ver data/salesRepo.js#createSale) — não existe um
        // `product.costPrice` único pra esse tipo de produto (cada forma
        // tem o seu, e pode ter sido editada/removida desde a venda). Item
        // normal continua usando o costPrice ATUAL do produto, igual sempre
        // foi (a margem histórica muda se o custo cadastrado for editado —
        // comportamento aceito, não é novo desta mudança).
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

      return { totalRevenue: acc.totalRevenue + netSaleTotalWithInterest(s), totalCount: acc.totalCount + 1 };
    },
  });

  const avgTicket = totalCount > 0 ? totalRevenue / totalCount : 0;
  const bySeller = Object.values(bySellerMap).sort((a, b) => b.revenue - a.revenue);

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
