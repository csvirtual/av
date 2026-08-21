// Exportação de Relatórios em PDF — mesma técnica do recibo de venda (ver
// components/receipt.js): usa a impressão nativa do navegador em vez de
// qualquer biblioteca de PDF, porque o próprio diálogo de "Imprimir" do
// Chrome já oferece "Salvar como PDF" de graça, sem dependência nenhuma —
// consistente com o resto do projeto (100% local, sem servidor).
//
// O conteúdo fica num elemento escondido (#print-report-root) o tempo
// todo; @media print (ver styles.css) some com o resto da página e mostra
// só ele na hora de imprimir — mesmo mecanismo do recibo, ambos coexistem
// porque o CSS já lista os dois ids na regra de visibilidade.
import { formatMoney, formatDate, escapeHtml } from '../utils/format.js';

const CURVE_LABEL = { A: 'A', B: 'B', C: 'C' };

function buildReportPrintHtml({ report, periodLabel, company }) {
  const r = report;
  const marginPct = r.totalRevenue > 0 ? (r.totalMargin / r.totalRevenue) * 100 : 0;
  const emitido = formatDate(Date.now());

  const sellerRows = r.bySeller.length === 0
    ? '<tr><td colspan="3" class="rp-empty">Nenhuma venda no período.</td></tr>'
    : r.bySeller.map((s) => `<tr><td>${escapeHtml(s.userName)}</td><td>${s.count}</td><td>${formatMoney(s.revenue)}</td></tr>`).join('');

  const categoryLabel = (c) => (c === 'material' ? 'Material de construção' : c === 'mercearia' ? 'Mercearia' : escapeHtml(c));
  const categoryRows = r.byCategory.length === 0
    ? '<tr><td colspan="3" class="rp-empty">Nenhuma venda no período.</td></tr>'
    : r.byCategory.map((c) => `<tr><td>${categoryLabel(c.category)}</td><td>${c.qty.toFixed(0)}</td><td>${formatMoney(c.revenue)}</td></tr>`).join('');

  const productRows = r.byProduct.length === 0
    ? '<tr><td colspan="5" class="rp-empty">Nenhuma venda no período.</td></tr>'
    : r.byProduct.map((p) => `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${p.qty.toFixed(0)}</td>
        <td>${formatMoney(p.revenue)}</td>
        <td>${formatMoney(p.margin)}</td>
        <td class="rp-center">${CURVE_LABEL[p.curveClass] || escapeHtml(p.curveClass)}</td>
      </tr>
    `).join('');

  return `
    <div class="rp-sheet">
      <div class="rp-header">
        <div>
          <div class="rp-store-name">${escapeHtml(company?.nomeFantasia || 'Gestão de Loja')}</div>
          ${company?.cnpj ? `<div class="rp-store-meta">${escapeHtml(company.cnpj)}</div>` : ''}
        </div>
        <div class="rp-title-block">
          <div class="rp-title">Relatório de vendas</div>
          <div class="rp-store-meta">Período: ${escapeHtml(periodLabel)}</div>
          <div class="rp-store-meta">Emitido em ${emitido}</div>
        </div>
      </div>
      <div class="rp-sep"></div>

      <div class="rp-stats">
        <div class="rp-stat"><div class="rp-stat-label">Faturamento</div><div class="rp-stat-value">${formatMoney(r.totalRevenue)}</div></div>
        <div class="rp-stat"><div class="rp-stat-label">Vendas</div><div class="rp-stat-value">${r.totalCount}</div></div>
        <div class="rp-stat"><div class="rp-stat-label">Ticket médio</div><div class="rp-stat-value">${formatMoney(r.avgTicket)}</div></div>
        <div class="rp-stat"><div class="rp-stat-label">Margem estimada</div><div class="rp-stat-value">${formatMoney(r.totalMargin)} (${marginPct.toFixed(1)}%)</div></div>
      </div>

      <div class="rp-section-title">Vendas por vendedor</div>
      <table class="rp-table">
        <thead><tr><th>Vendedor</th><th>Vendas</th><th>Faturamento</th></tr></thead>
        <tbody>${sellerRows}</tbody>
      </table>

      <div class="rp-section-title">Vendas por categoria</div>
      <table class="rp-table">
        <thead><tr><th>Categoria</th><th>Quantidade</th><th>Faturamento</th></tr></thead>
        <tbody>${categoryRows}</tbody>
      </table>

      <div class="rp-section-title">Produtos — curva ABC</div>
      <p class="rp-note">A = 80% do faturamento · B = próximos 15% · C = os 5% restantes</p>
      <table class="rp-table">
        <thead><tr><th>Produto</th><th>Qtd. vendida</th><th>Faturamento</th><th>Margem estimada</th><th class="rp-center">Curva</th></tr></thead>
        <tbody>${productRows}</tbody>
      </table>
    </div>
  `;
}

/** Abre o diálogo de impressão do navegador já com o relatório formatado
 * pra folha A4/Carta — "Salvar como PDF" no próprio diálogo é a forma de
 * exportar (mesma UX já usada pro recibo de venda). */
export function printReport({ report, periodLabel, company }) {
  let root = document.getElementById('print-report-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-report-root';
    document.body.appendChild(root);
  }
  root.innerHTML = buildReportPrintHtml({ report, periodLabel, company });
  // Achado de auditoria: mesmo raciocínio de components/receipt.js —
  // @media print mostra os dois roots ao mesmo tempo, então se um recibo
  // já foi impresso antes nesta sessão, o #print-receipt-root ficava com
  // HTML antigo parado lá e aparecia sobreposto ao relatório. Esvazia o
  // outro root aqui, sempre, antes de imprimir.
  const otherRoot = document.getElementById('print-receipt-root');
  if (otherRoot) otherRoot.innerHTML = '';
  window.print();
}
