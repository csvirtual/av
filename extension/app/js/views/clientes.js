// Clientes e fiado. Cadastrar/editar cliente e registrar pagamento de
// fiado ficam liberados pra admin e vendedor (é operação do dia a dia de
// vendas, não gestão sensível do sistema) — só excluir cliente fica
// restrito ao administrador, por ser uma ação destrutiva sobre o histórico.
import {
  listCustomers, searchCustomers, createCustomer, updateCustomer,
  setCustomerActive, deleteCustomer, listCustomerLedger, getCustomerBalance,
  getAllBalances, recordPayment,
} from '../data/customersRepo.js';
import { getOpenSession } from '../data/cashRepo.js';
import { logAction } from '../data/auditRepo.js';
import { formatMoney, formatDateTime, escapeHtml } from '../utils/format.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';

const PAYMENT_METHODS = ['Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Pix'];

export async function renderClientes(container, ctx) {
  const isAdmin = ctx.user.role === 'admin';
  let currentTerm = '';

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Clientes</h1>
        <div class="desc">Cadastro de clientes e controle de fiado.</div>
      </div>
      <div class="page-actions">
        <button class="btn" id="new-customer-btn">+ Novo cliente</button>
      </div>
    </div>
    <div class="toolbar">
      <input type="search" id="search-input" placeholder="Buscar por nome ou telefone…" autofocus>
    </div>
    <div id="customers-table"></div>
  `;

  const tableBox = document.getElementById('customers-table');

  async function refresh() {
    const customers = currentTerm ? await searchCustomers(currentTerm) : await listCustomers();
    const balances = await getAllBalances();
    tableBox.innerHTML = renderTable(customers, balances);
    wireRowActions(customers, balances);
  }

  document.getElementById('search-input').addEventListener('input', (e) => {
    currentTerm = e.target.value;
    refresh();
  });
  document.getElementById('new-customer-btn').addEventListener('click', () => openCustomerModal(null));

  function wireRowActions(customers, balances) {
    tableBox.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => openDetailModal(customers.find((c) => c.id === btn.dataset.detail), balances));
    });
    tableBox.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => openCustomerModal(customers.find((c) => c.id === btn.dataset.edit)));
    });
    tableBox.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => toggleActive(customers.find((c) => c.id === btn.dataset.toggle)));
    });
    tableBox.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => removeCustomer(customers.find((c) => c.id === btn.dataset.delete)));
    });
  }

  async function toggleActive(customer) {
    const next = !customer.active;
    const ok = await confirmDialog({
      title: next ? 'Reativar cliente' : 'Inativar cliente',
      message: `Deseja ${next ? 'reativar' : 'inativar'} "${escapeHtml(customer.nome)}"?`,
      confirmLabel: next ? 'Reativar' : 'Inativar',
      danger: !next,
    });
    if (!ok) return;
    await setCustomerActive(customer.id, next);
    await logAction({
      userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
      action: next ? 'Reativação de cliente' : 'Inativação de cliente',
      details: `Cliente "${customer.nome}" ${next ? 'reativado' : 'inativado'}.`,
      entity: 'customer', entityId: customer.id,
    });
    showToast(`Cliente ${next ? 'reativado' : 'inativado'}.`, 'success');
    refresh();
  }

  async function removeCustomer(customer) {
    const balance = await getCustomerBalance(customer.id);
    if (balance > 0.01) {
      showToast(`Não é possível excluir: "${customer.nome}" ainda deve ${formatMoney(balance)}. Quite o fiado primeiro ou inative o cliente.`, 'error');
      return;
    }
    const ok = await confirmDialog({
      title: 'Excluir cliente',
      message: `Excluir definitivamente "${escapeHtml(customer.nome)}"? O histórico de vendas dele não é afetado, só o cadastro.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    await deleteCustomer(customer.id);
    await logAction({
      userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
      action: 'Exclusão de cliente',
      details: `Cliente "${customer.nome}" excluído.`,
      entity: 'customer', entityId: customer.id,
    });
    showToast('Cliente excluído.', 'success');
    refresh();
  }

  function openCustomerModal(customer) {
    const isEdit = !!customer;
    openModal({
      title: isEdit ? 'Editar cliente' : 'Novo cliente',
      submitLabel: isEdit ? 'Salvar alterações' : 'Cadastrar cliente',
      bodyHtml: `
        <div id="modal-error"></div>
        <div class="field"><label>Nome *</label><input id="f-nome" value="${isEdit ? escapeHtml(customer.nome) : ''}"></div>
        <div class="form-row">
          <div class="field"><label>Telefone</label><input id="f-telefone" value="${isEdit ? escapeHtml(customer.telefone) : ''}"></div>
          <div class="field"><label>CPF/CNPJ</label><input id="f-documento" value="${isEdit ? escapeHtml(customer.documento) : ''}"></div>
        </div>
        <div class="field"><label>Endereço</label><input id="f-endereco" value="${isEdit ? escapeHtml(customer.endereco) : ''}"></div>
        <div class="field">
          <label>Limite de crédito para fiado (R$)</label>
          <input id="f-limit" type="number" min="0" step="0.01" value="${isEdit ? customer.creditLimit : 0}">
          <span class="hint">0 = sem limite definido (não bloqueia, só avisa se você configurar depois).</span>
        </div>
        <div class="field"><label>Observações</label><input id="f-obs" value="${isEdit ? escapeHtml(customer.observacoes) : ''}"></div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const nome = modalEl.querySelector('#f-nome').value.trim();
        if (!nome) { errBox.innerHTML = '<div class="form-error">Nome é obrigatório.</div>'; return false; }
        const data = {
          nome,
          telefone: modalEl.querySelector('#f-telefone').value,
          documento: modalEl.querySelector('#f-documento').value,
          endereco: modalEl.querySelector('#f-endereco').value,
          creditLimit: modalEl.querySelector('#f-limit').value,
          observacoes: modalEl.querySelector('#f-obs').value,
        };
        try {
          if (isEdit) {
            await updateCustomer(customer.id, data);
            await logAction({
              userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
              action: 'Edição de cliente', details: `Cliente "${nome}" editado.`,
              entity: 'customer', entityId: customer.id,
            });
            showToast('Cliente atualizado.', 'success');
          } else {
            const created = await createCustomer(data);
            await logAction({
              userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
              action: 'Cadastro de cliente', details: `Cliente "${nome}" cadastrado.`,
              entity: 'customer', entityId: created.id,
            });
            showToast('Cliente cadastrado.', 'success');
          }
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${err.message}</div>`;
          return false;
        }
      },
    });
  }

  async function openDetailModal(customer) {
    const [ledger, balance] = await Promise.all([listCustomerLedger(customer.id), getCustomerBalance(customer.id)]);
    openModal({
      title: escapeHtml(customer.nome),
      submitLabel: balance > 0.01 ? 'Registrar pagamento' : 'Fechar',
      cancelLabel: 'Fechar',
      singleButton: balance <= 0.01,
      wide: true,
      bodyHtml: `
        <p class="text-muted" style="font-size:13px;">
          ${escapeHtml(customer.telefone || 'sem telefone')} ${customer.documento ? `· ${escapeHtml(customer.documento)}` : ''}
          ${customer.creditLimit > 0 ? `· limite de crédito ${formatMoney(customer.creditLimit)}` : ''}
        </p>
        <div class="stat-card" style="max-width:220px;margin-bottom:16px;">
          <div class="label">Saldo devedor</div>
          <div class="value ${balance > 0.01 ? 'danger' : ''}">${formatMoney(balance)}</div>
        </div>
        <p class="section-title">Extrato</p>
        ${ledger.length === 0 ? '<div class="table-empty">Nenhum lançamento ainda.</div>' : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Data</th><th>Tipo</th><th>Valor</th><th>Detalhe</th><th>Usuário</th></tr></thead>
              <tbody>
                ${ledger.map((e) => `
                  <tr>
                    <td>${formatDateTime(e.timestamp)}</td>
                    <td>${e.type === 'fiado' ? '<span class="badge badge-red">Fiado</span>' : '<span class="badge badge-green">Pagamento</span>'}</td>
                    <td>${e.type === 'fiado' ? '+' : '−'}${formatMoney(e.amount)}</td>
                    <td class="text-muted">${e.type === 'pagamento' ? escapeHtml(e.paymentMethod || '') + (e.note ? ` — ${escapeHtml(e.note)}` : '') : 'Venda'}</td>
                    <td>${escapeHtml(e.userName)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      `,
      onSubmit: async (modalEl, close) => {
        if (balance <= 0.01) return true;
        close();
        openPaymentModal(customer, balance);
        return false;
      },
    });
  }

  function openPaymentModal(customer, balance) {
    openModal({
      title: `Registrar pagamento — ${escapeHtml(customer.nome)}`,
      submitLabel: 'Confirmar pagamento',
      bodyHtml: `
        <div id="modal-error"></div>
        <p class="text-muted" style="font-size:13px;">Saldo devedor atual: <strong>${formatMoney(balance)}</strong></p>
        <div class="form-row">
          <div class="field"><label>Valor pago *</label><input id="f-amount" type="number" min="0.01" step="0.01" max="${balance.toFixed(2)}" value="${balance.toFixed(2)}"></div>
          <div class="field">
            <label>Forma de pagamento</label>
            <select id="f-method">${PAYMENT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label>Observação</label><input id="f-note" placeholder="Opcional"></div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const amount = Number(modalEl.querySelector('#f-amount').value) || 0;
        const paymentMethod = modalEl.querySelector('#f-method').value;
        const note = modalEl.querySelector('#f-note').value;
        try {
          const session = await getOpenSession();
          const payment = await recordPayment({
            customerId: customer.id, amount, paymentMethod, note,
            cashSessionId: session?.id || null,
            userId: ctx.user.id, userName: ctx.user.nome,
          });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Pagamento de fiado recebido',
            details: `Pagamento de ${formatMoney(payment.amount)} (${paymentMethod}) recebido de "${customer.nome}".`,
            entity: 'customer', entityId: customer.id,
          });
          showToast(`Pagamento de ${formatMoney(payment.amount)} registrado.`, 'success');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${err.message}</div>`;
          return false;
        }
      },
    });
  }

  function renderTable(customers, balances) {
    if (customers.length === 0) return '<div class="table-wrap"><div class="table-empty">Nenhum cliente cadastrado.</div></div>';
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nome</th><th>Telefone</th><th>Saldo devedor</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${customers.map((c) => {
              const balance = balances[c.id] || 0;
              return `
              <tr>
                <td>${escapeHtml(c.nome)}</td>
                <td>${escapeHtml(c.telefone || '—')}</td>
                <td>${balance > 0.01 ? `<span class="badge badge-red">${formatMoney(balance)}</span>` : formatMoney(0)}</td>
                <td>${c.active ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-gray">Inativo</span>'}</td>
                <td style="white-space:nowrap;">
                  <button class="btn btn-ghost btn-sm" data-detail="${c.id}">Extrato</button>
                  <button class="btn btn-ghost btn-sm" data-edit="${c.id}">Editar</button>
                  <button class="btn btn-ghost btn-sm" data-toggle="${c.id}">${c.active ? 'Inativar' : 'Reativar'}</button>
                  ${isAdmin ? `<button class="btn btn-ghost btn-sm" data-delete="${c.id}" style="color:var(--danger);">Excluir</button>` : ''}
                </td>
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  refresh();
}
