// Relatórios gerenciais — exclusivo do administrador, envolve margem de
// lucro (calculada a partir do preço de custo, um dado sensível).
import { computeSalesReport } from '../data/reportsRepo.js';
import { getCompany } from '../data/companyRepo.js';
import { formatMoney, formatDate, escapeHtml } from '../utils/format.js';
import { printReport } from '../components/reportPrint.js';
import { showToast } from '../components/toast.js';

const CURVE_BADGE = { A: 'badge-green', B: 'badge-gold', C: 'badge-gray' };

export async function renderRelatorios(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Relatórios</h1>
        <div class="desc">Vendas, margem de lucro e curva ABC de produtos.</div>
      </div>
    </div>
    <div class="toolbar">
      <select id="period-preset">
        <option value="30">Últimos 30 dias</option>
        <option value="7">Últimos 7 dias</option>
        <option value="today">Hoje</option>
        <option value="all">Desde o início</option>
        <option value="custom">Período personalizado</option>
      </select>
      <button class="btn btn-secondary btn-sm" id="export-report-pdf-btn" type="button">🖨️ Exportar PDF</button>
      <label class="text-muted" style="font-size:13px;" id="custom-from-label">De <input type="date" id="date-from"></label>
      <label class="text-muted" style="font-size:13px;" id="custom-to-label">Até <input type="date" id="date-to"></label>
    </div>
    <div id="report-box"></div>
  `;

  const reportBox = document.getElementById('report-box');
  const presetSelect = document.getElementById('period-preset');
  const fromInput = document.getElementById('date-from');
  const toInput = document.getElementById('date-to');

  function toggleCustomInputs() {
    const show = presetSelect.value === 'custom';
    document.getElementById('custom-from-label').style.display = show ? 'inline' : 'none';
    document.getElementById('custom-to-label').style.display = show ? 'inline' : 'none';
  }
  toggleCustomInputs();

  function currentRange() {
    const now = Date.now();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    switch (presetSelect.value) {
      case 'today': return { from: startOfToday.getTime(), to: now };
      case '7': return { from: now - 7 * 86400000, to: now };
      case '30': return { from: now - 30 * 86400000, to: now };
      case 'all': return { from: null, to: null };
      case 'custom': {
        const from = fromInput.value ? new Date(`${fromInput.value}T00:00:00`).getTime() : null;
        // .999, não .000: senão uma venda no último segundo do dia "até"
        // ficava fora do relatório (achado de auditoria).
        const to = toInput.value ? new Date(`${toInput.value}T23:59:59.999`).getTime() : null;
        return { from, to };
      }
      default: return { from: null, to: null };
    }
  }

  // Texto legível do período selecionado, pra mostrar no cabeçalho do PDF
  // exportado — espelha as mesmas opções de currentRange(), incluindo o
  // caso "personalizado" com as datas escolhidas.
  function periodLabel() {
    switch (presetSelect.value) {
      case 'today': return 'Hoje';
      case '7': return 'Últimos 7 dias';
      case '30': return 'Últimos 30 dias';
      case 'all': return 'Desde o início';
      case 'custom': {
        const { from, to } = currentRange();
        const de = from ? formatDate(from) : '—';
        const ate = to ? formatDate(to) : '—';
        return `${de} até ${ate}`;
      }
      default: return '';
    }
  }

  async function refresh() {
    const { from, to } = currentRange();
    const report = await computeSalesReport({ from, to });
    renderReport(report);
  }

  function renderReport(r) {
    const marginPct = r.totalRevenue > 0 ? (r.totalMargin / r.totalRevenue) * 100 : 0;
    reportBox.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="label">Faturamento</div><div class="value">${formatMoney(r.totalRevenue)}</div></div>
        <div class="stat-card"><div class="label">Vendas</div><div class="value">${r.totalCount}</div></div>
        <div class="stat-card"><div class="label">Ticket médio</div><div class="value">${formatMoney(r.avgTicket)}</div></div>
        <div class="stat-card"><div class="label">Margem estimada</div><div class="value">${formatMoney(r.totalMargin)} <span class="text-muted" style="font-size:13px;">(${marginPct.toFixed(1)}%)</span></div></div>
      </div>

      <div class="card" style="margin-bottom:20px;">
        <p class="section-title mt-0">Vendas por vendedor</p>
        ${r.bySeller.length === 0 ? '<div class="table-empty">Nenhuma venda no período.</div>' : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Vendedor</th><th>Vendas</th><th>Faturamento</th></tr></thead>
              <tbody>
                ${r.bySeller.map((s) => `<tr><td>${escapeHtml(s.userName)}</td><td>${s.count}</td><td>${formatMoney(s.revenue)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>

      <div class="card" style="margin-bottom:20px;">
        <p class="section-title mt-0">Vendas por categoria</p>
        ${r.byCategory.length === 0 ? '<div class="table-empty">Nenhuma venda no período.</div>' : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Categoria</th><th>Quantidade</th><th>Faturamento</th></tr></thead>
              <tbody>
                ${r.byCategory.map((c) => `<tr><td>${c.category === 'material' ? 'Material de construção' : c.category === 'mercearia' ? 'Mercearia' : escapeHtml(c.category)}</td><td>${c.qty.toFixed(0)}</td><td>${formatMoney(c.revenue)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>

      <div class="card">
        <p class="section-title mt-0">Produtos — curva ABC</p>
        <p class="text-muted" style="font-size:12.5px;margin-top:-6px;">
          <span class="badge badge-green">A</span> = 80% do faturamento · <span class="badge badge-gold">B</span> = próximos 15% · <span class="badge badge-gray">C</span> = os 5% restantes
        </p>
        ${r.byProduct.length === 0 ? '<div class="table-empty">Nenhuma venda no período.</div>' : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Produto</th><th>Qtd. vendida</th><th>Faturamento</th><th>Margem estimada</th><th>Curva</th></tr></thead>
              <tbody>
                ${r.byProduct.map((p) => `
                  <tr>
                    <td>${escapeHtml(p.name)}</td>
                    <td>${p.qty.toFixed(0)}</td>
                    <td>${formatMoney(p.revenue)}</td>
                    <td>${formatMoney(p.margin)}</td>
                    <td><span class="badge ${CURVE_BADGE[p.curveClass]}">${p.curveClass}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  presetSelect.addEventListener('change', () => { toggleCustomInputs(); refresh(); });
  fromInput.addEventListener('change', refresh);
  toInput.addEventListener('change', refresh);

  document.getElementById('export-report-pdf-btn').addEventListener('click', async () => {
    // Recalcula na hora do clique (em vez de guardar o último relatório
    // renderizado) — garante que o PDF sempre reflete o período
    // selecionado no momento, mesmo que o usuário tenha mexido nos campos
    // de data personalizada sem disparar o "change" ainda (ex: só saiu do
    // campo clicando direto no botão).
    const { from, to } = currentRange();
    try {
      const [report, company] = await Promise.all([
        computeSalesReport({ from, to }),
        getCompany(),
      ]);
      printReport({ report, periodLabel: periodLabel(), company });
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  refresh();
}
