// Painel inicial: visão rápida do estado da loja — disponível para admin e
// vendedores (todos têm acesso ao panorama geral do estoque e das vendas).
import { listProducts } from '../data/productsRepo.js';
import { listSales } from '../data/salesRepo.js';
import { formatMoney, formatDateTime, escapeHtml } from '../utils/format.js';

export async function renderDashboard(container, ctx) {
  container.innerHTML = '<div class="card">Carregando painel…</div>';

  const [products, sales] = await Promise.all([listProducts(), listSales()]);

  const activeProducts = products.filter((p) => p.active);
  const lowStock = activeProducts.filter((p) => p.quantity <= p.minStock);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const salesToday = sales.filter((s) => s.timestamp >= startOfDay.getTime());
  const totalToday = salesToday.reduce((sum, s) => sum + s.total, 0);

  const recentSales = sales.slice(0, 8);

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Olá, ${escapeHtml(ctx.user.nome.split(' ')[0])}</h1>
        <div class="desc">Resumo geral da loja em tempo real.</div>
      </div>
      <div class="page-actions">
        <button class="btn" id="go-venda">🧾 Nova venda</button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Produtos ativos</div>
        <div class="value">${activeProducts.length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Estoque baixo</div>
        <div class="value ${lowStock.length > 0 ? 'danger' : ''}">${lowStock.length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Vendas hoje</div>
        <div class="value">${salesToday.length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Faturado hoje</div>
        <div class="value">${formatMoney(totalToday)}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <p class="section-title mt-0">Últimas vendas</p>
      ${renderSalesTable(recentSales)}
    </div>

    <div class="card">
      <p class="section-title mt-0">Produtos com estoque baixo</p>
      ${renderLowStockTable(lowStock)}
    </div>
  `;

  container.querySelector('#go-venda').addEventListener('click', () => ctx.navigate('venda'));
}

function renderSalesTable(sales) {
  if (sales.length === 0) return '<div class="table-empty">Nenhuma venda registrada ainda.</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Data/Hora</th><th>Vendedor</th><th>Itens</th><th>Total</th></tr></thead>
        <tbody>
          ${sales.map((s) => `
            <tr>
              <td>${formatDateTime(s.timestamp)}</td>
              <td>${escapeHtml(s.userName)}</td>
              <td>${s.items.length}</td>
              <td>${formatMoney(s.total)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderLowStockTable(products) {
  if (products.length === 0) return '<div class="table-empty">Nenhum produto com estoque baixo. 🎉</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Produto</th><th>Categoria</th><th>Estoque atual</th><th>Mínimo</th></tr></thead>
        <tbody>
          ${products.map((p) => `
            <tr class="low-stock-row">
              <td>${escapeHtml(p.name)}</td>
              <td>${p.category === 'material' ? 'Material de construção' : 'Mercearia'}</td>
              <td>${p.quantity} ${escapeHtml(p.unit)}</td>
              <td>${p.minStock} ${escapeHtml(p.unit)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
