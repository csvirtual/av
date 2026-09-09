// Clientes e fiado. Cadastrar/editar cliente e registrar pagamento de
// fiado ficam liberados pra admin e vendedor (é operação do dia a dia de
// vendas, não gestão sensível do sistema) — só excluir cliente exige a
// permissão 'deleteCustomer' (admin sempre tem; vendedor só se o admin
// marcar no cadastro dele, ver utils/permissions.js), por ser uma ação
// destrutiva sobre o histórico.
import {
  listCustomers, searchCustomers, createCustomer, updateCustomer,
  setCustomerActive, deleteCustomer, listCustomerLedger, getCustomerBalance,
  getAllBalances, recordPayment, isDebtOverdue,
} from '../data/customersRepo.js';
import {
  listCustomerLoyaltyLedger, getCustomerPoints, recordRedemption,
} from '../data/loyaltyRepo.js';
import { getOpenSession } from '../data/cashRepo.js';
import { getCompany } from '../data/companyRepo.js';
import { listSalesPage, saleStatus } from '../data/salesRepo.js';
import { addPendingCredit } from '../session.js';
import { logAction } from '../data/auditRepo.js';
import { formatMoney, formatDate, formatDateTime, escapeHtml, BASE_PAYMENT_METHODS } from '../utils/format.js';
import { formatPhoneBR } from '../utils/phone.js';
import { formatCpfOrCnpj, isValidCpfOrCnpj } from '../utils/document.js';
import { userCan } from '../utils/permissions.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { paginationHtml, wirePagination, createPageState } from '../components/pagination.js';
import { showSaleItemsModal, SALE_STATUS_BADGE, paymentMethodLabel } from '../components/saleDetail.js';
import { wireMaskedInput } from '../components/maskedInput.js';

const PAYMENT_METHODS = BASE_PAYMENT_METHODS;
const LOYALTY_BADGE = {
  ganho: '<span class="badge badge-green">Ganho</span>',
  resgate: '<span class="badge badge-gold">Resgate</span>',
  estorno: '<span class="badge badge-red">Estorno</span>',
};

// `new Date(x).toISOString()` joga RangeError pra qualquer timestamp que não
// dê uma data válida — nunca deixa isso quebrar o formulário inteiro (ver
// data/customersRepo.js#sanitizeDebtDueDate, que evita gravar lixo aqui,
// mas esta função protege mesmo assim contra qualquer dado antigo/estranho
// que já esteja gravado).
function dateInputValue(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export async function renderClientes(container, ctx) {
  const canDeleteCustomer = userCan(ctx.user, 'deleteCustomer');
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
  let pgState = createPageState();

  async function refresh({ resetPage = true } = {}) {
    const customers = currentTerm ? await searchCustomers(currentTerm) : await listCustomers();
    const balances = await getAllBalances();
    if (resetPage) pgState.page = 1;
    const total = customers.length;
    const totalPages = Math.max(1, Math.ceil(total / pgState.pageSize));
    if (pgState.page > totalPages) pgState.page = totalPages;
    const start = (pgState.page - 1) * pgState.pageSize;
    const visible = customers.slice(start, start + pgState.pageSize);
    tableBox.innerHTML = `
      ${total > 0 ? `<div class="utility-bar"><span class="text-muted" style="font-size:13px;">${total} cliente(s)</span></div>` : ''}
      ${renderTable(visible, balances)}
      ${paginationHtml({ page: pgState.page, pageSize: pgState.pageSize, total })}
    `;
    wireRowActions(visible);
    wirePagination(tableBox, pgState, (next) => { pgState = next; refresh({ resetPage: false }); });
  }

  document.getElementById('search-input').addEventListener('input', (e) => {
    currentTerm = e.target.value;
    refresh();
  });
  document.getElementById('new-customer-btn').addEventListener('click', () => openCustomerModal(null));

  function wireRowActions(customers) {
    tableBox.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => openDetailModal(customers.find((c) => c.id === btn.dataset.detail)));
    });
    tableBox.querySelectorAll('[data-purchases]').forEach((btn) => {
      btn.addEventListener('click', () => openCustomerSalesModal(customers.find((c) => c.id === btn.dataset.purchases)));
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
    try {
      await setCustomerActive(customer.id, next);
      await logAction({
        userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
        action: next ? 'Reativação de cliente' : 'Inativação de cliente',
        details: `Cliente "${customer.nome}" ${next ? 'reativado' : 'inativado'}.`,
        entity: 'customer', entityId: customer.id,
      });
      showToast(`Cliente ${next ? 'reativado' : 'inativado'}.`, 'success');
      refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
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
    // Achado de auditoria (mesma classe do removeProduct em
    // views/products.js): deleteCustomer() reconfere 'deleteCustomer' na
    // fonte e pode lançar de verdade num cenário real — permissão revogada
    // enquanto a tabela já estava aberta com o botão "Excluir" visível.
    // Sem try/catch, o clique falhava em silêncio.
    try {
      await deleteCustomer(customer.id);
      await logAction({
        userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
        action: 'Exclusão de cliente',
        details: `Cliente "${customer.nome}" excluído.`,
        entity: 'customer', entityId: customer.id,
      });
      showToast('Cliente excluído.', 'success');
      refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
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
          <div class="field"><label>Telefone</label><input id="f-telefone" value="${isEdit ? escapeHtml(formatPhoneBR(customer.telefone)) : ''}" placeholder="(xx) x xxxx-xxxx" maxlength="17"></div>
          <div class="field"><label>CPF/CNPJ</label><input id="f-documento" value="${isEdit ? escapeHtml(formatCpfOrCnpj(customer.documento)) : ''}" placeholder="xxx.xxx.xxx-xx" maxlength="18"></div>
        </div>
        <div class="field"><label>Endereço</label><input id="f-endereco" value="${isEdit ? escapeHtml(customer.endereco) : ''}"></div>
        <div class="form-row">
          <div class="field">
            <label>Limite de crédito para fiado (R$)</label>
            <input id="f-limit" type="number" min="0" step="0.01" value="${isEdit ? customer.creditLimit : 0}">
            <span class="hint">0 = sem limite definido (não bloqueia, só avisa se você configurar depois).</span>
          </div>
          <div class="field">
            <label>Vencimento do saldo (lembrete)</label>
            <input id="f-duedate" type="date" value="${isEdit ? dateInputValue(customer.debtDueDate) : ''}">
            <span class="hint">Opcional — não é parcelamento, é só um lembrete de até quando cobrar o saldo em aberto.</span>
          </div>
        </div>
        <div class="field"><label>Observações</label><input id="f-obs" value="${isEdit ? escapeHtml(customer.observacoes) : ''}"></div>
      `,
      onMount: (modalEl) => {
        const telefoneInput = modalEl.querySelector('#f-telefone');
        wireMaskedInput(telefoneInput, formatPhoneBR);
        const documentoInput = modalEl.querySelector('#f-documento');
        wireMaskedInput(documentoInput, formatCpfOrCnpj);
      },
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const nome = modalEl.querySelector('#f-nome').value.trim();
        if (!nome) { errBox.innerHTML = '<div class="form-error">Nome é obrigatório.</div>'; return false; }
        const documentoValue = modalEl.querySelector('#f-documento').value;
        if (documentoValue.trim() && !isValidCpfOrCnpj(documentoValue)) {
          errBox.innerHTML = '<div class="form-error">CPF/CNPJ inválido. Confira os números digitados.</div>';
          return false;
        }
        const dueDateStr = modalEl.querySelector('#f-duedate').value;
        const data = {
          nome,
          telefone: modalEl.querySelector('#f-telefone').value,
          documento: documentoValue,
          endereco: modalEl.querySelector('#f-endereco').value,
          creditLimit: modalEl.querySelector('#f-limit').value,
          debtDueDate: dueDateStr ? new Date(`${dueDateStr}T00:00:00`).getTime() : null,
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
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  async function openDetailModal(customer) {
    const [ledger, balance, loyaltyLedger, points, company] = await Promise.all([
      listCustomerLedger(customer.id), getCustomerBalance(customer.id),
      listCustomerLoyaltyLedger(customer.id), getCustomerPoints(customer.id), getCompany(),
    ]);
    const loyaltyOn = (company?.policies?.loyaltyPointsPerReal ?? 0) > 0;
    const overdue = isDebtOverdue(customer, balance);

    openModal({
      title: escapeHtml(customer.nome),
      submitLabel: balance > 0.01 ? 'Registrar pagamento' : 'Fechar',
      cancelLabel: 'Fechar',
      singleButton: balance <= 0.01,
      wide: true,
      bodyHtml: `
        <p class="text-muted" style="font-size:13px;">
          ${escapeHtml(formatPhoneBR(customer.telefone) || 'sem telefone')} ${customer.documento ? `· ${escapeHtml(customer.documento)}` : ''}
          ${customer.creditLimit > 0 ? `· limite de crédito ${formatMoney(customer.creditLimit)}` : ''}
          ${customer.debtDueDate ? `· vencimento ${formatDate(customer.debtDueDate)}${overdue ? ' <strong style="color:var(--danger);">(vencido)</strong>' : ''}` : ''}
        </p>
        <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <div class="stat-card" style="max-width:220px;">
            <div class="label">Saldo devedor</div>
            <div class="value ${balance > 0.01 ? 'danger' : ''}">${formatMoney(balance)}</div>
          </div>
          ${loyaltyOn || points > 0 ? `
            <div class="stat-card" style="max-width:220px;">
              <div class="label">Pontos de fidelidade</div>
              <div class="value">${points}</div>
              ${points > 0 ? '<button type="button" class="btn btn-ghost btn-sm" id="redeem-points-btn" style="margin-top:6px;">Resgatar pontos</button>' : ''}
            </div>
          ` : ''}
        </div>
        <p class="section-title">Extrato de fiado</p>
        ${ledger.length === 0 ? '<div class="table-empty">Nenhum lançamento ainda.</div>' : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Data</th><th>Tipo</th><th>Valor</th><th>Detalhe</th><th>Usuário</th></tr></thead>
              <tbody>
                ${ledger.map((e) => `
                  <tr>
                    <td>${formatDateTime(e.timestamp)}</td>
                    <td>${e.type === 'fiado' ? '<span class="badge badge-red">Fiado</span>' : e.type === 'estorno' ? '<span class="badge badge-gold">Estorno</span>' : '<span class="badge badge-green">Pagamento</span>'}</td>
                    <td>${e.type === 'fiado' ? '+' : '−'}${formatMoney(e.amount)}</td>
                    <td class="text-muted">${e.type === 'pagamento' ? escapeHtml(e.paymentMethod || '') + (e.note ? ` — ${escapeHtml(e.note)}` : '') : e.type === 'estorno' ? 'Devolução de mercadoria' : 'Venda'}</td>
                    <td>${escapeHtml(e.userName)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
        ${loyaltyLedger.length > 0 ? `
          <p class="section-title" style="margin-top:16px;">Extrato de pontos</p>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Data</th><th>Tipo</th><th>Pontos</th><th>Usuário</th></tr></thead>
              <tbody>
                ${loyaltyLedger.map((e) => `
                  <tr>
                    <td>${formatDateTime(e.timestamp)}</td>
                    <td>${LOYALTY_BADGE[e.type] || e.type}</td>
                    <td>${e.type === 'ganho' ? '+' : '−'}${e.points}</td>
                    <td>${escapeHtml(e.userName)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}
      `,
      onMount: (modalEl, close) => {
        modalEl.querySelector('#redeem-points-btn')?.addEventListener('click', () => {
          close();
          openRedeemModal(customer, points, company?.policies?.loyaltyRedemptionRate ?? 100);
        });
      },
      onSubmit: async (modalEl, close) => {
        if (balance <= 0.01) return true;
        close();
        openPaymentModal(customer, balance);
        return false;
      },
    });
  }

  // Achado do usuário: pra saber o que um cliente comprou (não só o que ele
  // deve — isso já é o "Extrato" acima), tinha que ir até "Histórico de
  // vendas" e filtrar/procurar manualmente. Reaproveita o mesmo modal de
  // "Ver itens" do histórico (ver components/saleDetail.js, extraído de
  // views/salesHistory.js pra isso), só que já filtrado por este cliente.
  //
  // Paginação numerada (1 2 3…, ver components/pagination.js) igual ao
  // resto do app, não "Carregar mais" — diferente do Histórico de vendas
  // (que pode ter dezenas de milhares de vendas somando TODOS os clientes
  // da loja), aqui o universo já está filtrado a UM cliente só: mesmo um
  // cliente fiel de anos fica numa escala perfeitamente razoável pra buscar
  // inteira e paginar em memória — ainda via listSalesPage/cursor (nunca
  // `dbGetAll('sales')`), só que buscando em lotes grandes até acabar, em
  // vez de uma página pequena por clique.
  async function openCustomerSalesModal(customer) {
    const FETCH_BATCH = 200;
    let allSales = [];
    const company = await getCompany();
    let modalBodyEl;
    let pgState = createPageState();

    function netTotal(sale) {
      return sale.total - sale.refundedTotal + (sale.creditInterestTotal || 0);
    }

    function renderBody() {
      const total = allSales.length;
      if (total === 0) {
        modalBodyEl.innerHTML = '<div class="table-empty">Nenhuma compra registrada ainda.</div>';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(total / pgState.pageSize));
      if (pgState.page > totalPages) pgState.page = totalPages;
      const start = (pgState.page - 1) * pgState.pageSize;
      const visible = allSales.slice(start, start + pgState.pageSize);
      modalBodyEl.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Data/Hora</th><th>Itens</th><th>Pagamento</th><th>Total</th><th style="text-align:center;">Status</th><th></th></tr></thead>
            <tbody>
              ${visible.map((s) => `
                <tr>
                  <td>${formatDateTime(s.timestamp)}</td>
                  <td>${s.items.length}</td>
                  <td>${s.payments.map((p) => paymentMethodLabel(p)).join(', ') || '—'}</td>
                  <td>
                    ${s.refundedTotal > 0 ? `<div class="text-muted" style="font-size:11.5px;text-decoration:line-through;">${formatMoney(s.total)}</div>` : ''}
                    ${formatMoney(netTotal(s))}
                  </td>
                  <td style="text-align:center;">${SALE_STATUS_BADGE[saleStatus(s)]}</td>
                  <td><button type="button" class="btn btn-ghost btn-sm" data-view="${s.id}">Ver itens</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${paginationHtml({ page: pgState.page, pageSize: pgState.pageSize, total })}
      `;
      modalBodyEl.querySelectorAll('[data-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sale = allSales.find((s) => s.id === btn.dataset.view);
          showSaleItemsModal({ sale, company, customerNameText: customer.nome, status: saleStatus(sale) });
        });
      });
      wirePagination(modalBodyEl, pgState, (next) => { pgState = next; renderBody(); });
    }

    async function loadAllSales() {
      let cursor = { afterKey: undefined, afterId: undefined };
      let hasMore = true;
      while (hasMore) {
        const page = await listSalesPage({ customerId: customer.id, limit: FETCH_BATCH, afterKey: cursor.afterKey, afterId: cursor.afterId });
        allSales = allSales.concat(page.items);
        hasMore = page.hasMore;
        cursor = { afterKey: page.nextKey, afterId: page.nextId };
      }
      renderBody();
    }

    openModal({
      title: `Compras de ${escapeHtml(customer.nome)}`,
      submitLabel: 'Fechar',
      singleButton: true,
      wide: true,
      bodyHtml: '<div class="loading-state"><span class="spinner"></span>Carregando…</div>',
      onMount: async (modalEl) => {
        modalBodyEl = modalEl.querySelector('.modal-body');
        await loadAllSales();
      },
      onSubmit: () => true,
    });
  }

  function openRedeemModal(customer, points, rateInput) {
    // Achado de auditoria (defesa extra, além do clamp na fonte em
    // data/companyRepo.js#buildCompanyRecord): `pontos / rate` vira
    // Infinity se rate for 0 — e um crédito Infinity fica preso pra sempre
    // na sessão (ver session.js#addPendingCredit, que SOMA em vez de
    // substituir). Mesmo com a política já clampada mínimo 1 na origem,
    // um valor gravado ANTES dessa correção (ou restaurado de um backup
    // antigo) ainda pode estar lendo 0 aqui — nunca divide por algo que
    // não seja um número positivo de verdade.
    const rate = Number(rateInput) > 0 ? Number(rateInput) : 100;
    // Achado de auditoria (P2): gerada uma vez só, na abertura do modal —
    // ver data/loyaltyRepo.js#recordRedemption.
    const dedupeKey = crypto.randomUUID();
    openModal({
      title: `Resgatar pontos — ${escapeHtml(customer.nome)}`,
      submitLabel: 'Confirmar resgate',
      bodyHtml: `
        <div id="modal-error"></div>
        <p class="text-muted" style="font-size:13px;">
          Saldo: <strong>${points} pontos</strong> · ${rate} pontos = R$ 1,00
        </p>
        <div class="field">
          <label>Pontos a resgatar *</label>
          <input id="f-points" type="number" min="1" max="${points}" step="1" value="${points}">
        </div>
        <p class="text-muted" style="font-size:12.5px;">O valor vira um crédito de troca, usável como forma de pagamento na próxima venda.</p>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const pointsToRedeem = Number(modalEl.querySelector('#f-points').value) || 0;
        try {
          await recordRedemption({
            customerId: customer.id, points: pointsToRedeem,
            note: 'Resgate convertido em crédito de troca',
            userId: ctx.user.id, userName: ctx.user.nome, dedupeKey,
          });
          const amount = pointsToRedeem / rate;
          await addPendingCredit({ amount, sourceSaleId: null, sourceRefundId: null, reason: `Resgate de ${pointsToRedeem} pontos de fidelidade` });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Resgate de pontos de fidelidade',
            details: `${pointsToRedeem} pontos de "${customer.nome}" resgatados por ${formatMoney(amount)} de crédito.`,
            entity: 'customer', entityId: customer.id,
          });
          showToast(`${pointsToRedeem} pontos resgatados: ${formatMoney(amount)} de crédito disponível na próxima venda.`, 'success');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  function openPaymentModal(customer, balance) {
    // Achado de auditoria (P2): gerada uma vez só, na abertura do modal —
    // ver data/customersRepo.js#recordPayment.
    const dedupeKey = crypto.randomUUID();
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
            userId: ctx.user.id, userName: ctx.user.nome, dedupeKey,
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
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
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
          <thead><tr><th>Nome</th><th>Telefone</th><th>Saldo devedor</th><th>Vencimento</th><th style="text-align:center;">Status</th><th></th></tr></thead>
          <tbody>
            ${customers.map((c) => {
              const balance = balances[c.id] || 0;
              const overdue = isDebtOverdue(c, balance);
              return `
              <tr>
                <td>${escapeHtml(c.nome)}</td>
                <td>${escapeHtml(formatPhoneBR(c.telefone) || '—')}</td>
                <td>${balance > 0.01 ? `<span class="badge badge-red">${formatMoney(balance)}</span>` : formatMoney(0)}</td>
                <td>${c.debtDueDate ? (overdue ? `<span class="badge badge-red">Vencido em ${formatDate(c.debtDueDate)}</span>` : formatDate(c.debtDueDate)) : '—'}</td>
                <td style="text-align:center;">${c.active ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-gray">Inativo</span>'}</td>
                <td style="white-space:nowrap;">
                  <button class="btn btn-ghost btn-sm" data-detail="${c.id}">Extrato</button>
                  <button class="btn btn-ghost btn-sm" data-purchases="${c.id}">Ver compras</button>
                  <button class="btn btn-ghost btn-sm" data-edit="${c.id}">Editar</button>
                  <button class="btn btn-ghost btn-sm" data-toggle="${c.id}">${c.active ? 'Inativar' : 'Reativar'}</button>
                  ${canDeleteCustomer ? `<button class="btn btn-ghost btn-sm" data-delete="${c.id}" style="color:var(--danger);">Excluir</button>` : ''}
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
