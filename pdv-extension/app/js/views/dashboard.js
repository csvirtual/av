// Painel inicial: visão rápida do estado da loja — disponível para admin e
// vendedores (todos têm acesso ao panorama geral do estoque e das vendas).
import { listProducts } from '../data/productsRepo.js';
import { listSalesPage, summarizeSales } from '../data/salesRepo.js';
import { getOpenSession } from '../data/cashRepo.js';
import { listCustomers, getAllBalances, isDebtOverdue } from '../data/customersRepo.js';
import { getAllPointsBalances } from '../data/loyaltyRepo.js';
import { getCompany } from '../data/companyRepo.js';
import { listDeliveries } from '../data/deliveriesRepo.js';
import { openEstoqueFilteredByStatus } from './products.js';
import { formatMoney, formatDate, formatDateTime, escapeHtml } from '../utils/format.js';
import { isNearExpiry, isExpired } from '../utils/pricing.js';
import { icon } from '../components/icon.js';

export async function renderDashboard(container, ctx) {
  container.innerHTML = '<div class="card loading-state"><span class="spinner"></span>Carregando painel…</div>';

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Achado de auditoria: o Painel — a tela mais visitada do sistema —
  // carregava TODAS as vendas da loja (listSales()) só pra pegar as 8 mais
  // recentes e somar o faturamento de hoje. Com anos de histórico
  // acumulado, isso cresce pra sempre a cada visita. `listSalesPage` já
  // busca só as 8 mais recentes direto do índice de data, e
  // `summarizeSales` soma "hoje" sem carregar as vendas em si (ver
  // data/salesRepo.js) — nenhum dos dois precisa da tabela inteira.
  const [products, recentPage, todaySummary, cashSession, balances, pointsBalances, company, deliveries, customers] = await Promise.all([
    listProducts(),
    listSalesPage({ limit: 8 }),
    summarizeSales({ fromTs: startOfDay.getTime() }),
    getOpenSession(), getAllBalances(), getAllPointsBalances(), getCompany(), listDeliveries(), listCustomers(),
  ]);
  const pendingDeliveries = deliveries.filter((d) => d.status === 'pendente');
  const totalFiado = Object.values(balances).reduce((sum, v) => sum + v, 0);
  const totalPoints = Object.values(pointsBalances).reduce((sum, v) => sum + v, 0);
  const loyaltyOn = (company?.policies?.loyaltyPointsPerReal ?? 0) > 0;

  const activeProducts = products.filter((p) => p.active);
  const lowStock = activeProducts.filter((p) => p.quantity <= p.minStock);
  // Mesma distinção usada no filtro de status da tela Estoque (ver
  // views/products.js#STATUS_FILTERS) — "próximo da validade" e "fora da
  // validade" são conjuntos que NUNCA se sobrepõem (isNearExpiry sozinho
  // continua true pra sempre depois de vencido, ver utils/pricing.js), pra
  // os dois indicadores do Painel abaixo levarem pro filtro certo na tela
  // Estoque, sem um produto vencido contando em dobro.
  const nearExpiryOnly = activeProducts.filter((p) => isNearExpiry(p) && !isExpired(p));
  const expiredOnly = activeProducts.filter((p) => isExpired(p));
  const overdueCustomers = customers.filter((c) => isDebtOverdue(c, balances[c.id] || 0));

  // Faturado líquido: desconta estornos já feitos hoje sobre vendas de hoje
  // (inclui o juro de parcelamento no cartão, repassado pro cliente — é
  // dinheiro real recebido, mesmo cálculo de data/reportsRepo.js). Estorno
  // de uma venda de outro dia não mexe no "hoje" (é a venda que define a
  // data, não o estorno) — mantém o painel simples e previsível.
  const salesTodayCount = todaySummary.count;
  const totalToday = todaySummary.netTotal;

  const recentSales = recentPage.items;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Olá, ${escapeHtml(ctx.user.nome.split(' ')[0])}</h1>
        <div class="desc">Resumo geral da loja em tempo real.</div>
      </div>
      <div class="page-actions">
        <button class="btn" id="go-venda">${icon('receipt', { size: 15 })} Nova venda</button>
        <div class="stat-card" id="cash-stat-card" style="cursor:pointer; text-align:center;">
          <div class="label">Caixa</div>
          <div class="value" style="font-size:18px;">${cashSession ? '<span class="badge badge-green">Aberto</span>' : '<span class="badge badge-gray">Fechado</span>'}</div>
        </div>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card" id="products-stat-card" style="cursor:pointer;">
        <div class="label">Produtos ativos</div>
        <div class="value">${activeProducts.length}</div>
      </div>
      <div class="stat-card" id="lowstock-stat-card" style="cursor:pointer;">
        <div class="label">Estoque baixo</div>
        <div class="value ${lowStock.length > 0 ? 'danger' : ''}">${lowStock.length}</div>
      </div>
      <div class="stat-card" id="salestoday-stat-card" style="cursor:pointer;">
        <div class="label">Vendas hoje</div>
        <div class="value">${salesTodayCount}</div>
      </div>
      <div class="stat-card" id="revenue-stat-card" style="cursor:pointer;">
        <div class="label">Faturado hoje</div>
        <div class="value">${formatMoney(totalToday)}</div>
      </div>
      <div class="stat-card" id="fiado-stat-card" style="cursor:pointer;">
        <div class="label">Total em fiado</div>
        <div class="value ${totalFiado > 0 ? 'warn' : ''}">${formatMoney(totalFiado)}</div>
      </div>
      <div class="stat-card" id="carreto-stat-card" style="cursor:pointer;">
        <div class="label">Carretos pendentes</div>
        <div class="value ${pendingDeliveries.length > 0 ? 'warn' : ''}">${pendingDeliveries.length}</div>
      </div>
      <div class="stat-card" id="nearexpiry-stat-card" style="cursor:pointer;">
        <div class="label">Próximo da validade</div>
        <div class="value ${nearExpiryOnly.length > 0 ? 'warn' : ''}">${nearExpiryOnly.length}</div>
      </div>
      <div class="stat-card" id="expired-stat-card" style="cursor:pointer;">
        <div class="label">Fora da validade</div>
        <div class="value ${expiredOnly.length > 0 ? 'danger' : ''}">${expiredOnly.length}</div>
      </div>
      ${loyaltyOn || totalPoints > 0 ? `
        <div class="stat-card" id="points-stat-card" style="cursor:pointer;">
          <div class="label">Pontos de fidelidade em aberto</div>
          <div class="value">${totalPoints}</div>
        </div>
      ` : ''}
    </div>

    <div class="card" style="margin-bottom:20px;">
      <p class="section-title mt-0">Últimas vendas</p>
      ${renderSalesTable(recentSales)}
    </div>

    <div class="card" id="carreto-section-card" style="margin-bottom:20px;cursor:pointer;">
      <p class="section-title mt-0 section-title-row" style="justify-content:space-between;">Carretos pendentes <span class="text-muted" style="font-weight:400;font-size:12.5px;">Ver tudo →</span></p>
      ${renderPendingDeliveriesTable(pendingDeliveries.slice(0, 8))}
    </div>

    <div class="card" id="fiado-section-card" style="cursor:pointer;">
      <p class="section-title mt-0 section-title-row" style="justify-content:space-between;">Fiado vencido <span class="text-muted" style="font-weight:400;font-size:12.5px;">Ver tudo →</span></p>
      ${renderOverdueDebtTable(overdueCustomers, balances)}
    </div>
  `;

  container.querySelector('#go-venda').addEventListener('click', () => ctx.navigate('venda'));
  container.querySelector('#products-stat-card').addEventListener('click', () => ctx.navigate('estoque'));
  container.querySelector('#lowstock-stat-card').addEventListener('click', () => {
    openEstoqueFilteredByStatus('low-stock');
    ctx.navigate('estoque');
  });
  container.querySelector('#nearexpiry-stat-card').addEventListener('click', () => {
    openEstoqueFilteredByStatus('near-expiry');
    ctx.navigate('estoque');
  });
  container.querySelector('#expired-stat-card').addEventListener('click', () => {
    openEstoqueFilteredByStatus('expired');
    ctx.navigate('estoque');
  });
  container.querySelector('#salestoday-stat-card').addEventListener('click', () => ctx.navigate('vendas'));
  container.querySelector('#revenue-stat-card').addEventListener('click', () => ctx.navigate('vendas'));
  container.querySelector('#cash-stat-card').addEventListener('click', () => ctx.navigate('caixa'));
  container.querySelector('#fiado-stat-card').addEventListener('click', () => ctx.navigate('clientes'));
  container.querySelector('#points-stat-card')?.addEventListener('click', () => ctx.navigate('clientes'));
  container.querySelector('#carreto-stat-card').addEventListener('click', () => ctx.navigate('carreto'));
  container.querySelector('#carreto-section-card').addEventListener('click', () => ctx.navigate('carreto'));
  container.querySelector('#fiado-section-card').addEventListener('click', () => ctx.navigate('clientes'));
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
              <td>${formatMoney((s.total - s.refundedTotal) + (s.creditInterestTotal || 0))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderPendingDeliveriesTable(deliveries) {
  if (deliveries.length === 0) return `<div class="table-empty">${icon('checkCircle', { size: 15 })} Nenhum carreto pendente.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Data/Hora</th><th>Cliente</th><th>Endereço</th><th>Itens</th><th>Responsável</th></tr></thead>
        <tbody>
          ${deliveries.map((d) => `
            <tr>
              <td>${formatDateTime(d.createdAt)}</td>
              <td>${escapeHtml(d.customerName)}</td>
              <td class="text-muted">${escapeHtml(d.address || '—')}</td>
              <td>${d.items.length}</td>
              <td class="text-muted">${escapeHtml(d.responsible || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderOverdueDebtTable(customers, balances) {
  if (customers.length === 0) return `<div class="table-empty">${icon('checkCircle', { size: 15 })} Nenhum fiado vencido.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Cliente</th><th>Vencimento</th><th>Saldo devedor</th></tr></thead>
        <tbody>
          ${customers.map((c) => `
            <tr class="low-stock-row">
              <td>${escapeHtml(c.nome)}</td>
              <td>${formatDate(c.debtDueDate)}</td>
              <td>${formatMoney(balances[c.id] || 0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

