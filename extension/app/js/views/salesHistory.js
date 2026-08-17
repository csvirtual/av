// Histórico de vendas — visível para todos os perfis (é o que dá controle
// rígido sobre "o que foi vendido, por quem, quando" pedido no escopo).
// Vendedores veem as vendas de todos os colegas aqui (é só o LOG interno de
// ações que fica restrito ao admin — ver views/logs.js).
import { listSales } from '../data/salesRepo.js';
import { listUsers } from '../data/usersRepo.js';
import { formatMoney, formatDateTime, escapeHtml } from '../utils/format.js';
import { openModal } from '../components/modal.js';

export async function renderSalesHistory(container, ctx) {
  container.innerHTML = '<div class="card">Carregando…</div>';

  const [sales, users] = await Promise.all([listSales(), listUsers()]);

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Histórico de vendas</h1>
        <div class="desc">Todas as vendas registradas na loja, com data, hora e vendedor responsável.</div>
      </div>
    </div>
    <div class="toolbar">
      <select id="seller-filter">
        <option value="">Todos os vendedores</option>
        ${users.map((u) => `<option value="${u.id}">${escapeHtml(u.nome)}</option>`).join('')}
      </select>
      <label class="text-muted" style="font-size:13px;">De <input type="date" id="date-from"></label>
      <label class="text-muted" style="font-size:13px;">Até <input type="date" id="date-to"></label>
    </div>
    <div id="sales-table"></div>
  `;

  const tableBox = document.getElementById('sales-table');

  function applyFilters() {
    const sellerId = document.getElementById('seller-filter').value;
    const from = document.getElementById('date-from').value;
    const to = document.getElementById('date-to').value;
    let filtered = sales;
    if (sellerId) filtered = filtered.filter((s) => s.userId === sellerId);
    if (from) {
      const fromTs = new Date(`${from}T00:00:00`).getTime();
      filtered = filtered.filter((s) => s.timestamp >= fromTs);
    }
    if (to) {
      const toTs = new Date(`${to}T23:59:59`).getTime();
      filtered = filtered.filter((s) => s.timestamp <= toTs);
    }
    renderTable(filtered);
  }

  function renderTable(list) {
    const total = list.reduce((sum, s) => sum + s.total, 0);
    if (list.length === 0) {
      tableBox.innerHTML = '<div class="table-wrap"><div class="table-empty">Nenhuma venda encontrada para o filtro selecionado.</div></div>';
      return;
    }
    tableBox.innerHTML = `
      <div class="utility-bar">
        <span class="text-muted" style="font-size:13px;">${list.length} venda(s)</span>
        <span style="font-weight:700;">Total: ${formatMoney(total)}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data/Hora</th><th>Vendedor</th><th>Itens</th><th>Pagamento</th><th>Total</th><th></th></tr></thead>
          <tbody>
            ${list.map((s) => `
              <tr>
                <td>${formatDateTime(s.timestamp)}</td>
                <td>${escapeHtml(s.userName)}</td>
                <td>${s.items.length}</td>
                <td>${escapeHtml(s.paymentMethod || '—')}</td>
                <td>${formatMoney(s.total)}</td>
                <td><button class="btn btn-ghost btn-sm" data-detail="${s.id}">Ver itens</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    tableBox.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => showSaleDetail(list.find((s) => s.id === btn.dataset.detail)));
    });
  }

  function showSaleDetail(sale) {
    openModal({
      title: `Venda de ${formatDateTime(sale.timestamp)}`,
      submitLabel: 'Fechar',
      singleButton: true,
      bodyHtml: `
        <p class="text-muted" style="font-size:13px;">Vendedor: <strong>${escapeHtml(sale.userName)}</strong> · Pagamento: ${escapeHtml(sale.paymentMethod || '—')}</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Produto</th><th>Qtd</th><th>Unitário</th><th>Subtotal</th></tr></thead>
            <tbody>
              ${sale.items.map((i) => `
                <tr>
                  <td>${escapeHtml(i.name)}</td>
                  <td>${i.qty} ${escapeHtml(i.unit)}</td>
                  <td>${formatMoney(i.unitPrice)}</td>
                  <td>${formatMoney(i.subtotal)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="cart-total"><span>Total</span><span class="value">${formatMoney(sale.total)}</span></div>
      `,
      onSubmit: () => true,
    });
  }

  document.getElementById('seller-filter').addEventListener('change', applyFilters);
  document.getElementById('date-from').addEventListener('change', applyFilters);
  document.getElementById('date-to').addEventListener('change', applyFilters);

  renderTable(sales);
}
