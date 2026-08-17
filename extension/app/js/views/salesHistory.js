// Histórico de vendas — visível para todos os perfis (é o que dá controle
// rígido sobre "o que foi vendido, por quem, quando" pedido no escopo).
// Vendedores veem as vendas de todos os colegas aqui (é só o LOG interno de
// ações que fica restrito ao admin — ver views/logs.js).
//
// Estorno (total ou por item) fica restrito ao administrador: é uma ação
// que mexe em dinheiro e estoque já fechados, então evita que um vendedor
// desfaça sozinho uma venda pra encobrir erro ou furto — todo estorno feito
// aqui já sai com motivo obrigatório e vai pro log de auditoria.
import { listSales, refundSaleItems, saleStatus } from '../data/salesRepo.js';
import { listUsers } from '../data/usersRepo.js';
import { listCustomers } from '../data/customersRepo.js';
import { logAction } from '../data/auditRepo.js';
import { setPendingCredit } from '../session.js';
import { formatMoney, formatDateTime, escapeHtml } from '../utils/format.js';
import { openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

const STATUS_BADGE = {
  completa: '<span class="badge badge-green">Completa</span>',
  parcial: '<span class="badge badge-gold">Parcialmente estornada</span>',
  estornada: '<span class="badge badge-red">Estornada</span>',
};

export async function renderSalesHistory(container, ctx) {
  container.innerHTML = '<div class="card">Carregando…</div>';

  let [sales, users, customers] = await Promise.all([listSales(), listUsers(), listCustomers()]);
  const customerName = (id) => customers.find((c) => c.id === id)?.nome || null;

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

  async function reload() {
    sales = await listSales();
    applyFilters();
  }

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

  function netTotal(sale) {
    return sale.total - sale.refundedTotal;
  }

  function renderTable(list) {
    const total = list.reduce((sum, s) => sum + netTotal(s), 0);
    if (list.length === 0) {
      tableBox.innerHTML = '<div class="table-wrap"><div class="table-empty">Nenhuma venda encontrada para o filtro selecionado.</div></div>';
      return;
    }
    tableBox.innerHTML = `
      <div class="utility-bar">
        <span class="text-muted" style="font-size:13px;">${list.length} venda(s)</span>
        <span style="font-weight:700;">Total líquido: ${formatMoney(total)}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data/Hora</th><th>Vendedor</th><th>Cliente</th><th>Itens</th><th>Pagamento</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${list.map((s) => `
              <tr>
                <td>${formatDateTime(s.timestamp)}</td>
                <td>${escapeHtml(s.userName)}</td>
                <td>${s.customerId ? escapeHtml(customerName(s.customerId) || 'cliente removido') : '<span class="text-muted">—</span>'}</td>
                <td>${s.items.length}</td>
                <td>${s.payments.map((p) => escapeHtml(p.method)).join(', ') || '—'}</td>
                <td>
                  ${s.refundedTotal > 0 ? `<div class="text-muted" style="font-size:11.5px;text-decoration:line-through;">${formatMoney(s.total)}</div>` : ''}
                  ${formatMoney(netTotal(s))}
                </td>
                <td>${STATUS_BADGE[saleStatus(s)]}</td>
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
    const canRefund = ctx.user.role === 'admin' && saleStatus(sale) !== 'estornada';
    openModal({
      title: `Venda de ${formatDateTime(sale.timestamp)}`,
      submitLabel: canRefund ? 'Estornar itens' : 'Fechar',
      cancelLabel: canRefund ? 'Fechar' : undefined,
      singleButton: !canRefund,
      wide: true,
      bodyHtml: `
        <p class="text-muted" style="font-size:13px;">
          Vendedor: <strong>${escapeHtml(sale.userName)}</strong>
          ${sale.customerId ? ` · Cliente: <strong>${escapeHtml(customerName(sale.customerId) || 'cliente removido')}</strong>` : ''}
          · ${STATUS_BADGE[saleStatus(sale)]}
        </p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Produto</th><th>Qtd</th><th>Unitário</th><th>Desconto</th><th>Total</th></tr></thead>
            <tbody>
              ${sale.items.map((i) => `
                <tr>
                  <td>${escapeHtml(i.name)}${i.qtyRefunded > 0 ? ` <span class="badge badge-red">${i.qtyRefunded} estornado(s)</span>` : ''}</td>
                  <td>${i.qty} ${escapeHtml(i.unit)}</td>
                  <td>${formatMoney(i.unitPrice)}</td>
                  <td>${i.discountType ? (i.discountType === 'percent' ? `${i.discountValue}%` : formatMoney(i.discountValue)) : '—'}</td>
                  <td>${formatMoney(i.lineTotal)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:10px;font-size:13px;">
          <div style="display:flex;justify-content:space-between;color:var(--text-muted);"><span>Subtotal</span><span>${formatMoney(sale.subtotal)}</span></div>
          ${sale.itemsDiscountTotal > 0 ? `<div style="display:flex;justify-content:space-between;color:var(--danger);"><span>Desconto nos itens</span><span>−${formatMoney(sale.itemsDiscountTotal)}</span></div>` : ''}
          ${sale.overallDiscountAmount > 0 ? `<div style="display:flex;justify-content:space-between;color:var(--danger);"><span>Desconto geral</span><span>−${formatMoney(sale.overallDiscountAmount)}</span></div>` : ''}
        </div>
        <div class="cart-total"><span>Total</span><span class="value">${formatMoney(sale.total)}</span></div>
        <p class="section-title" style="margin-top:14px;">Pagamento</p>
        ${sale.payments.map((p) => `<div style="display:flex;justify-content:space-between;font-size:13px;"><span>${escapeHtml(p.method)}</span><span>${formatMoney(p.amount)}</span></div>`).join('')}
        ${sale.refunds.length > 0 ? `
          <p class="section-title" style="margin-top:14px;">Estornos</p>
          ${sale.refunds.map((r) => `
            <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:8px;padding:8px;background:var(--surface-alt);border-radius:6px;">
              <div><strong>${formatMoney(r.totalRefunded)}</strong> em ${formatDateTime(r.timestamp)} por ${escapeHtml(r.userName)}</div>
              <div>Motivo: ${escapeHtml(r.reason)}</div>
              <div>${r.items.map((i) => `${i.qty}× ${escapeHtml(i.name)}`).join(', ')}</div>
            </div>
          `).join('')}
        ` : ''}
      `,
      onSubmit: (modalEl, close) => {
        if (!canRefund) return true;
        close();
        openRefundModal(sale);
        return false;
      },
    });
  }

  function openRefundModal(sale) {
    const refundableItems = sale.items.filter((i) => i.qty - i.qtyRefunded > 0);
    openModal({
      title: `Estornar itens — venda de ${formatDateTime(sale.timestamp)}`,
      submitLabel: 'Confirmar estorno',
      bodyHtml: `
        <div id="modal-error"></div>
        <p class="text-muted" style="font-size:13px;">Marque a quantidade de cada item que está sendo devolvido.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Produto</th><th>Disponível p/ estorno</th><th>Estornar</th></tr></thead>
            <tbody>
              ${refundableItems.map((i) => `
                <tr>
                  <td>${escapeHtml(i.name)}</td>
                  <td>${i.qty - i.qtyRefunded} ${escapeHtml(i.unit)}</td>
                  <td><input type="number" min="0" max="${i.qty - i.qtyRefunded}" value="0" data-refund-qty="${i.productId}" style="width:70px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;"></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Motivo do estorno *</label>
          <input id="f-reason" placeholder="Ex: produto com defeito, troca, erro no pedido…">
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;margin-top:6px;">
          <input type="checkbox" id="f-credit"> Gerar crédito de troca (o cliente leva outro produto em vez do dinheiro de volta)
        </label>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const reason = modalEl.querySelector('#f-reason').value.trim();
        const generateCredit = modalEl.querySelector('#f-credit').checked;
        const items = refundableItems
          .map((i) => ({ productId: i.productId, qty: Number(modalEl.querySelector(`[data-refund-qty="${i.productId}"]`).value) || 0 }))
          .filter((i) => i.qty > 0);

        if (!reason) { errBox.innerHTML = '<div class="form-error">Informe o motivo do estorno.</div>'; return false; }
        if (items.length === 0) { errBox.innerHTML = '<div class="form-error">Marque ao menos um item para estornar.</div>'; return false; }

        try {
          const { refund } = await refundSaleItems({
            saleId: sale.id, userId: ctx.user.id, userName: ctx.user.nome, reason, items, generateCredit,
          });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Estorno de venda',
            details: `Estorno de ${formatMoney(refund.totalRefunded)} na venda de ${formatDateTime(sale.timestamp)}. Motivo: ${reason}.`,
            entity: 'sale', entityId: sale.id,
          });
          if (generateCredit) {
            await setPendingCredit({ amount: refund.totalRefunded, sourceSaleId: sale.id, sourceRefundId: refund.id, reason: `Troca da venda de ${formatDateTime(sale.timestamp)}` });
            showToast(`Estorno confirmado. Crédito de ${formatMoney(refund.totalRefunded)} disponível na próxima venda.`, 'success');
          } else {
            showToast(`Estorno de ${formatMoney(refund.totalRefunded)} confirmado.`, 'success');
          }
          reload();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${err.message}</div>`;
          return false;
        }
      },
    });
  }

  document.getElementById('seller-filter').addEventListener('change', applyFilters);
  document.getElementById('date-from').addEventListener('change', applyFilters);
  document.getElementById('date-to').addEventListener('change', applyFilters);

  renderTable(sales);
}
