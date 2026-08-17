// Contas a pagar/receber — exclusivo do administrador, é controle
// financeiro da loja.
import {
  listEntries, createEntry, markAsPaid, cancelEntry, entryStatus,
} from '../data/financeRepo.js';
import { listSuppliers } from '../data/suppliersRepo.js';
import { logAction } from '../data/auditRepo.js';
import { formatMoney, formatDate, escapeHtml } from '../utils/format.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';

const PAYMENT_METHODS = ['Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Pix', 'Transferência'];
const STATUS_BADGE = {
  pendente: '<span class="badge badge-gray">Pendente</span>',
  vencido: '<span class="badge badge-red">Vencido</span>',
  pago: '<span class="badge badge-green">Pago</span>',
  cancelado: '<span class="badge badge-gray">Cancelado</span>',
};

export async function renderFinanceiro(container, ctx) {
  let typeFilter = '';
  let statusFilter = '';

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Financeiro</h1>
        <div class="desc">Contas a pagar e a receber.</div>
      </div>
      <div class="page-actions">
        <button class="btn" id="new-entry-btn">+ Nova conta</button>
      </div>
    </div>
    <div id="summary-box"></div>
    <div class="toolbar">
      <select id="type-filter">
        <option value="">Pagar e receber</option>
        <option value="pagar">A pagar</option>
        <option value="receber">A receber</option>
      </select>
      <select id="status-filter">
        <option value="">Todos os status</option>
        <option value="pendente">Pendente</option>
        <option value="vencido">Vencido</option>
        <option value="pago">Pago</option>
        <option value="cancelado">Cancelado</option>
      </select>
    </div>
    <div id="entries-table"></div>
  `;

  const summaryBox = document.getElementById('summary-box');
  const tableBox = document.getElementById('entries-table');

  async function refresh() {
    const all = await listEntries();
    renderSummary(all);
    let filtered = all;
    if (typeFilter) filtered = filtered.filter((e) => e.type === typeFilter);
    if (statusFilter) filtered = filtered.filter((e) => entryStatus(e) === statusFilter);
    renderTable(filtered);
  }

  function renderSummary(all) {
    const pendentes = all.filter((e) => ['pendente', 'vencido'].includes(entryStatus(e)));
    const aPagar = pendentes.filter((e) => e.type === 'pagar').reduce((sum, e) => sum + e.amount, 0);
    const aReceber = pendentes.filter((e) => e.type === 'receber').reduce((sum, e) => sum + e.amount, 0);
    const vencidas = all.filter((e) => entryStatus(e) === 'vencido').length;
    summaryBox.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="label">A pagar (pendente)</div><div class="value">${formatMoney(aPagar)}</div></div>
        <div class="stat-card"><div class="label">A receber (pendente)</div><div class="value">${formatMoney(aReceber)}</div></div>
        <div class="stat-card"><div class="label">Contas vencidas</div><div class="value ${vencidas > 0 ? 'danger' : ''}">${vencidas}</div></div>
      </div>
    `;
  }

  function renderTable(list) {
    if (list.length === 0) {
      tableBox.innerHTML = '<div class="table-wrap"><div class="table-empty">Nenhuma conta encontrada.</div></div>';
      return;
    }
    tableBox.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${list.map((e) => `
              <tr>
                <td>${e.type === 'pagar' ? '<span class="badge badge-red">Pagar</span>' : '<span class="badge badge-green">Receber</span>'}</td>
                <td>${escapeHtml(e.description)}</td>
                <td class="text-muted">${escapeHtml(e.category || '—')}</td>
                <td>${formatDate(e.dueDate)}</td>
                <td>${formatMoney(e.amount)}</td>
                <td>${STATUS_BADGE[entryStatus(e)]}</td>
                <td style="white-space:nowrap;">
                  ${entryStatus(e) === 'pendente' || entryStatus(e) === 'vencido' ? `
                    <button class="btn btn-ghost btn-sm" data-pay="${e.id}">Marcar pago</button>
                    <button class="btn btn-ghost btn-sm" data-cancel="${e.id}" style="color:var(--danger);">Cancelar</button>
                  ` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    tableBox.querySelectorAll('[data-pay]').forEach((btn) => {
      btn.addEventListener('click', () => openPayModal(list.find((e) => e.id === btn.dataset.pay)));
    });
    tableBox.querySelectorAll('[data-cancel]').forEach((btn) => {
      btn.addEventListener('click', () => cancel(list.find((e) => e.id === btn.dataset.cancel)));
    });
  }

  async function cancel(entry) {
    const ok = await confirmDialog({
      title: 'Cancelar conta',
      message: `Cancelar "${escapeHtml(entry.description)}"?`,
      confirmLabel: 'Cancelar conta', danger: true,
    });
    if (!ok) return;
    await cancelEntry(entry.id);
    await logAction({
      userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
      action: 'Cancelamento de conta financeira',
      details: `Conta "${entry.description}" (${formatMoney(entry.amount)}) cancelada.`,
      entity: 'financialEntry', entityId: entry.id,
    });
    showToast('Conta cancelada.', 'success');
    refresh();
  }

  function openPayModal(entry) {
    openModal({
      title: `Marcar como pago — ${escapeHtml(entry.description)}`,
      submitLabel: 'Confirmar',
      bodyHtml: `
        <div id="modal-error"></div>
        <div class="form-row">
          <div class="field"><label>Valor pago *</label><input id="f-amount" type="number" min="0.01" step="0.01" value="${entry.amount.toFixed(2)}"></div>
          <div class="field">
            <label>Forma de pagamento</label>
            <select id="f-method">${PAYMENT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join('')}</select>
          </div>
        </div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const paidAmount = Number(modalEl.querySelector('#f-amount').value) || 0;
        const paymentMethod = modalEl.querySelector('#f-method').value;
        try {
          await markAsPaid({ id: entry.id, paidAmount, paymentMethod, userId: ctx.user.id, userName: ctx.user.nome });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Conta financeira paga',
            details: `Conta "${entry.description}" paga (${formatMoney(paidAmount)}, ${paymentMethod}).`,
            entity: 'financialEntry', entityId: entry.id,
          });
          showToast('Conta marcada como paga.', 'success');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${err.message}</div>`;
          return false;
        }
      },
    });
  }

  async function openNewEntryModal() {
    const suppliers = await listSuppliers();
    openModal({
      title: 'Nova conta',
      submitLabel: 'Cadastrar conta',
      bodyHtml: `
        <div id="modal-error"></div>
        <div class="field">
          <label>Tipo *</label>
          <select id="f-type"><option value="pagar">A pagar</option><option value="receber">A receber</option></select>
        </div>
        <div class="field"><label>Descrição *</label><input id="f-description" placeholder="Ex: Aluguel de agosto"></div>
        <div class="form-row">
          <div class="field"><label>Valor *</label><input id="f-amount" type="number" min="0.01" step="0.01"></div>
          <div class="field"><label>Vencimento *</label><input id="f-duedate" type="date"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Categoria</label><input id="f-category" placeholder="Ex: aluguel, salário, fornecedor…"></div>
          <div class="field">
            <label>Fornecedor (opcional)</label>
            <select id="f-supplier"><option value="">Nenhum</option>${suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.nome)}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label>Observações</label><input id="f-notes"></div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const type = modalEl.querySelector('#f-type').value;
        const description = modalEl.querySelector('#f-description').value;
        const amount = modalEl.querySelector('#f-amount').value;
        const dueDateStr = modalEl.querySelector('#f-duedate').value;
        if (!dueDateStr) { errBox.innerHTML = '<div class="form-error">Informe a data de vencimento.</div>'; return false; }
        const dueDate = new Date(`${dueDateStr}T00:00:00`).getTime();
        try {
          const entry = await createEntry({
            type, description, amount, dueDate,
            category: modalEl.querySelector('#f-category').value,
            supplierId: modalEl.querySelector('#f-supplier').value || null,
            notes: modalEl.querySelector('#f-notes').value,
            userId: ctx.user.id, userName: ctx.user.nome,
          });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Cadastro de conta financeira',
            details: `Conta "${entry.description}" (${entry.type === 'pagar' ? 'a pagar' : 'a receber'}, ${formatMoney(entry.amount)}, venc. ${formatDate(entry.dueDate)}) cadastrada.`,
            entity: 'financialEntry', entityId: entry.id,
          });
          showToast('Conta cadastrada.', 'success');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${err.message}</div>`;
          return false;
        }
      },
    });
  }

  document.getElementById('new-entry-btn').addEventListener('click', openNewEntryModal);
  document.getElementById('type-filter').addEventListener('change', (e) => { typeFilter = e.target.value; refresh(); });
  document.getElementById('status-filter').addEventListener('change', (e) => { statusFilter = e.target.value; refresh(); });

  refresh();
}
