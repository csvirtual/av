// Contas a pagar/receber — exclusivo de quem tem a permissão 'financeiro'
// (admin sempre tem; um vendedor só se marcado no cadastro dele, ver
// utils/permissions.js). Suporta pagamento parcial de verdade: uma conta só
// fecha como "Pago" quando a soma de tudo que foi registrado bate o valor
// total dela — enquanto sobrar saldo, aparece etiquetada como "Pago
// parcialmente" com o valor que falta em destaque, nunca escondida como se
// já estivesse quitada (ver data/financeRepo.js).
import {
  listEntries, createEntry, registerPayment, deletePayment, cancelEntry, entryStatus, paidTotal, remainingAmount,
} from '../data/financeRepo.js';
import { listSuppliers } from '../data/suppliersRepo.js';
import { logAction } from '../data/auditRepo.js';
import { formatMoney, formatDate, formatDateTime, escapeHtml, BASE_PAYMENT_METHODS } from '../utils/format.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { paginationHtml, wirePagination, createPageState } from '../components/pagination.js';
import { enhanceSelect } from '../components/customSelect.js';

const PAYMENT_METHODS = [...BASE_PAYMENT_METHODS, 'Transferência'];
const STATUS_BADGE = {
  pendente: '<span class="badge badge-gray">Pendente</span>',
  vencido: '<span class="badge badge-red">Vencido</span>',
  parcial: '<span class="badge badge-gold">Pago parcialmente</span>',
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
        <option value="parcial">Pago parcialmente</option>
        <option value="pago">Pago</option>
        <option value="cancelado">Cancelado</option>
      </select>
    </div>
    <div id="entries-table"></div>
  `;

  const summaryBox = document.getElementById('summary-box');
  const tableBox = document.getElementById('entries-table');
  let pgState = createPageState();

  async function refresh({ resetPage = true } = {}) {
    const all = await listEntries();
    renderSummary(all);
    let filtered = all;
    if (typeFilter) filtered = filtered.filter((e) => e.type === typeFilter);
    if (statusFilter) filtered = filtered.filter((e) => entryStatus(e) === statusFilter);
    if (resetPage) pgState.page = 1;
    renderTable(filtered);
  }

  function renderSummary(all) {
    // 'parcial' entra aqui também — inclusive nela, o que ainda falta pagar
    // é o SALDO restante (remainingAmount), nunca o valor cheio da conta:
    // somar e.amount de uma conta já parcialmente paga infla o "a pagar/a
    // receber" com dinheiro que já trocou de mãos (mesmo achado de
    // auditoria do botão "Marcar pago" antigo, aplicado aqui no resumo).
    const pendentes = all.filter((e) => ['pendente', 'vencido', 'parcial'].includes(entryStatus(e)));
    const aPagar = pendentes.filter((e) => e.type === 'pagar').reduce((sum, e) => sum + remainingAmount(e), 0);
    const aReceber = pendentes.filter((e) => e.type === 'receber').reduce((sum, e) => sum + remainingAmount(e), 0);
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
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / pgState.pageSize));
    if (pgState.page > totalPages) pgState.page = totalPages;
    const start = (pgState.page - 1) * pgState.pageSize;
    const visible = list.slice(start, start + pgState.pageSize);
    tableBox.innerHTML = `
      <div class="utility-bar"><span class="text-muted" style="font-size:13px;">${total} conta(s)</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Vencimento</th><th>Valor</th><th style="text-align:center;">Status</th><th></th></tr></thead>
          <tbody>
            ${visible.map((e) => {
              const status = entryStatus(e);
              const canPay = status === 'pendente' || status === 'vencido' || status === 'parcial';
              const hasPayments = paidTotal(e) > 0.001;
              return `
              <tr>
                <td>${e.type === 'pagar' ? '<span class="badge badge-red">Pagar</span>' : '<span class="badge badge-green">Receber</span>'}</td>
                <td>${escapeHtml(e.description)}</td>
                <td class="text-muted">${escapeHtml(e.category || '—')}</td>
                <td>${formatDate(e.dueDate)}</td>
                <td>${valueCell(e, status)}</td>
                <td style="text-align:center;">${STATUS_BADGE[status]}</td>
                <td style="white-space:nowrap;">
                  ${canPay ? `<button class="btn btn-ghost btn-sm" data-pay="${e.id}">${status === 'parcial' ? 'Concluir pagamento' : 'Registrar pagamento'}</button>` : ''}
                  ${hasPayments ? `<button class="btn btn-ghost btn-sm" data-payments="${e.id}">Ver pagamentos</button>` : ''}
                  ${canPay && !hasPayments ? `<button class="btn btn-ghost btn-sm" data-cancel="${e.id}" style="color:var(--danger);">Cancelar</button>` : ''}
                </td>
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${paginationHtml({ page: pgState.page, pageSize: pgState.pageSize, total })}
    `;
    tableBox.querySelectorAll('[data-pay]').forEach((btn) => {
      btn.addEventListener('click', () => openPayModal(visible.find((e) => e.id === btn.dataset.pay)));
    });
    tableBox.querySelectorAll('[data-payments]').forEach((btn) => {
      btn.addEventListener('click', () => openPaymentsModal(visible.find((e) => e.id === btn.dataset.payments)));
    });
    tableBox.querySelectorAll('[data-cancel]').forEach((btn) => {
      btn.addEventListener('click', () => cancel(visible.find((e) => e.id === btn.dataset.cancel)));
    });
    wirePagination(tableBox, pgState, (next) => { pgState = next; renderTable(list); });
  }

  function valueCell(entry, status) {
    if (status !== 'parcial') return formatMoney(entry.amount);
    // Parcial: mostra o valor cheio riscado + o que ainda falta em
    // destaque — nunca só o valor cheio sozinho, que daria a entender que
    // nada foi pago ainda (mesmo raciocínio do preço promocional em
    // views/products.js#priceCell: original riscado, valor que vale de
    // verdade agora embaixo).
    return `
      <div style="text-decoration:line-through;color:var(--text-muted);font-size:12px;">${formatMoney(entry.amount)}</div>
      <div>Falta ${formatMoney(remainingAmount(entry))}</div>
    `;
  }

  async function cancel(entry) {
    const ok = await confirmDialog({
      title: 'Cancelar conta',
      message: `Cancelar "${escapeHtml(entry.description)}"?`,
      confirmLabel: 'Cancelar conta', cancelLabel: 'Fechar', danger: true,
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
    const remaining = remainingAmount(entry);
    const already = paidTotal(entry);
    // Achado de auditoria (P2): gerada uma vez só, na abertura do modal —
    // ver data/financeRepo.js#registerPayment.
    const dedupeKey = crypto.randomUUID();
    openModal({
      title: `Registrar pagamento — ${escapeHtml(entry.description)}`,
      submitLabel: 'Confirmar',
      bodyHtml: `
        <div id="modal-error"></div>
        ${already > 0.001 ? `
          <div class="notice">Já foram pagos ${formatMoney(already)} de ${formatMoney(entry.amount)}. Restam ${formatMoney(remaining)}.</div>
        ` : ''}
        <div class="form-row">
          <div class="field">
            <label>Valor pago agora *</label>
            <input id="f-amount" type="number" min="0.01" max="${remaining.toFixed(2)}" step="0.01" value="${remaining.toFixed(2)}">
            <span class="hint">Pode ser menor que o restante — a conta fica "Pago parcialmente" até o valor bater.</span>
          </div>
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
          const updated = await registerPayment({ id: entry.id, amount: paidAmount, paymentMethod, userId: ctx.user.id, userName: ctx.user.nome, dedupeKey });
          const completed = entryStatus(updated) === 'pago';
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: completed ? 'Conta financeira paga' : 'Pagamento parcial registrado',
            details: `Conta "${entry.description}" — pagamento de ${formatMoney(paidAmount)} (${paymentMethod}) registrado.`
              + (completed ? ' Conta totalmente quitada.' : ` Ainda falta ${formatMoney(remainingAmount(updated))} de ${formatMoney(updated.amount)}.`),
            entity: 'financialEntry', entityId: entry.id,
          });
          showToast(completed ? 'Conta marcada como paga.' : `Pagamento parcial registrado — ainda falta ${formatMoney(remainingAmount(updated))}.`, 'success');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  /** Extrato de pagamentos de uma conta — cada linha pode ser excluída
   * individualmente (pedido explícito: acesso a Financeiro já é restrito a
   * quem tem a permissão 'financeiro', e tudo fica no log de auditoria de
   * qualquer forma, então uma correção não precisa de mais burocracia que
   * isso). Excluir um pagamento que tinha fechado a conta a reabre sozinha
   * como pendente/parcial — nunca fica com o status desalinhado do que
   * ainda está de fato registrado. */
  function openPaymentsModal(entry) {
    const payments = [...(entry.payments || [])].sort((a, b) => b.paidAt - a.paidAt);
    openModal({
      title: `Pagamentos — ${escapeHtml(entry.description)}`,
      submitLabel: 'Fechar',
      singleButton: true,
      wide: true,
      bodyHtml: `
        <p class="text-muted" style="font-size:13px;">
          Total da conta: ${formatMoney(entry.amount)} · Pago até agora: ${formatMoney(paidTotal(entry))} · Falta: <strong>${formatMoney(remainingAmount(entry))}</strong>
        </p>
        ${payments.length === 0 ? `
          <div class="table-empty">Conta paga por uma versão anterior deste sistema, antes de existir o extrato de pagamentos — o valor pago está correto acima, mas não há um pagamento individual pra listar ou excluir aqui.</div>
        ` : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Data/Hora</th><th>Valor</th><th>Forma</th><th>Registrado por</th><th></th></tr></thead>
            <tbody>
              ${payments.map((p) => `
                <tr>
                  <td style="white-space:nowrap;">${formatDateTime(p.paidAt)}</td>
                  <td>${formatMoney(p.amount)}</td>
                  <td>${escapeHtml(p.paymentMethod)}</td>
                  <td>${escapeHtml(p.userName)}</td>
                  <td><button class="btn btn-ghost btn-sm" data-delete-payment="${p.id}" style="color:var(--danger);">Excluir</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        `}
      `,
      onMount: (modalEl, close) => {
        // Achado de auditoria (endurecimento — mesmo raciocínio de
        // views/carreto.js e views/compras.js): cada botão de excluir aqui
        // não é o submit do modal, então não ganha de graça a trava contra
        // clique duplo que components/modal.js já dá ao botão principal.
        // deletePayment() já é protegido contra corrupção de verdade
        // (dbUpdate em financeRepo.js reconfere se o pagamento ainda existe
        // antes de excluir), isto aqui só evita um segundo clique no MESMO
        // botão disparar uma chamada concorrente à toa.
        modalEl.querySelectorAll('[data-delete-payment]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const payment = payments.find((p) => p.id === btn.dataset.deletePayment);
            const ok = await confirmDialog({
              title: 'Excluir pagamento',
              message: `Excluir o pagamento de ${formatMoney(payment.amount)} (${escapeHtml(payment.paymentMethod)}, ${formatDateTime(payment.paidAt)})? O valor volta a fazer parte do saldo em aberto desta conta.`,
              confirmLabel: 'Excluir pagamento', danger: true,
            });
            if (!ok) return;
            btn.disabled = true;
            try {
              await deletePayment({ entryId: entry.id, paymentId: payment.id });
              await logAction({
                userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
                action: 'Exclusão de pagamento (financeiro)',
                details: `Pagamento de ${formatMoney(payment.amount)} (${payment.paymentMethod}, registrado por "${payment.userName}") excluído da conta "${entry.description}".`,
                entity: 'financialEntry', entityId: entry.id,
              });
              showToast('Pagamento excluído.', 'success');
              close();
              refresh();
            } catch (err) {
              showToast(err.message, 'error');
              btn.disabled = false;
            }
          });
        });
      },
      onSubmit: () => true,
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
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  document.getElementById('new-entry-btn').addEventListener('click', openNewEntryModal);
  document.getElementById('type-filter').addEventListener('change', (e) => { typeFilter = e.target.value; refresh(); });
  document.getElementById('status-filter').addEventListener('change', (e) => { statusFilter = e.target.value; refresh(); });
  enhanceSelect(document.getElementById('type-filter'));
  enhanceSelect(document.getElementById('status-filter'));

  refresh();
}
