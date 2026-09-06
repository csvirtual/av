// Fornecedores e pedidos de compra — exige a permissão 'compras' (admin
// sempre tem; um vendedor só se marcado no cadastro dele, ver
// utils/permissions.js). É gestão de estoque/financeiro da loja, diferente
// de clientes que é operação do dia a dia de venda.
import {
  listSuppliers, createSupplier, updateSupplier, setSupplierActive, deleteSupplier,
} from '../data/suppliersRepo.js';
import {
  listPurchaseOrders, createPurchaseOrder, receivePurchaseOrder,
  cancelPurchaseOrder, suggestPurchasesBySupplier,
} from '../data/purchasesRepo.js';
import { wireProductPicker } from '../components/productPicker.js';
import { logAction } from '../data/auditRepo.js';
import { formatMoney, formatDateTime, escapeHtml, formatQty } from '../utils/format.js';
import { formatPhoneBR } from '../utils/phone.js';
import { isValidEmail } from '../utils/email.js';
import { formatCpfOrCnpj, isValidCpfOrCnpj } from '../utils/document.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { paginationHtml, wirePagination, createPageState } from '../components/pagination.js';
import { icon } from '../components/icon.js';
import { wireMaskedInput } from '../components/maskedInput.js';

const ORDER_STATUS_BADGE = {
  aberto: '<span class="badge badge-gray">Aberto</span>',
  recebido_parcial: '<span class="badge badge-gold">Recebido parcialmente</span>',
  recebido: '<span class="badge badge-green">Recebido</span>',
  cancelado: '<span class="badge badge-red">Cancelado</span>',
};

export async function renderCompras(container, ctx) {
  let activeTab = 'pedidos';

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Compras</h1>
        <div class="desc">Fornecedores e pedidos de compra.</div>
      </div>
    </div>
    <div class="toolbar">
      <button class="btn btn-secondary" id="tab-pedidos">Pedidos de compra</button>
      <button class="btn btn-secondary" id="tab-fornecedores">Fornecedores</button>
    </div>
    <div id="tab-content"></div>
  `;

  const content = document.getElementById('tab-content');
  let pedidosPgState = createPageState();
  const tabPedidosBtn = document.getElementById('tab-pedidos');
  const tabFornecedoresBtn = document.getElementById('tab-fornecedores');

  function setTab(tab) {
    activeTab = tab;
    tabPedidosBtn.classList.toggle('btn', tab === 'pedidos');
    tabPedidosBtn.classList.toggle('btn-secondary', tab !== 'pedidos');
    tabFornecedoresBtn.classList.toggle('btn', tab === 'fornecedores');
    tabFornecedoresBtn.classList.toggle('btn-secondary', tab !== 'fornecedores');
    if (tab === 'pedidos') renderPedidosTab();
    else renderFornecedoresTab();
  }

  tabPedidosBtn.addEventListener('click', () => setTab('pedidos'));
  tabFornecedoresBtn.addEventListener('click', () => setTab('fornecedores'));

  // ==================== Fornecedores ====================

  async function renderFornecedoresTab() {
    const suppliers = await listSuppliers();
    content.innerHTML = `
      <div class="utility-bar">
        <span class="text-muted" style="font-size:13px;">${suppliers.length} fornecedor(es)</span>
        <button class="btn btn-sm" id="new-supplier-btn">+ Novo fornecedor</button>
      </div>
      ${suppliers.length === 0 ? '<div class="table-wrap"><div class="table-empty">Nenhum fornecedor cadastrado.</div></div>' : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th style="text-align:center;">Status</th><th></th></tr></thead>
            <tbody>
              ${suppliers.map((s) => `
                <tr>
                  <td>${escapeHtml(s.nome)}</td>
                  <td>${escapeHtml(formatPhoneBR(s.telefone) || '—')}</td>
                  <td>${escapeHtml(s.email || '—')}</td>
                  <td style="text-align:center;">${s.active ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-gray">Inativo</span>'}</td>
                  <td style="white-space:nowrap;">
                    <button class="btn btn-ghost btn-sm" data-edit="${s.id}">Editar</button>
                    <button class="btn btn-ghost btn-sm" data-toggle="${s.id}">${s.active ? 'Inativar' : 'Reativar'}</button>
                    <button class="btn btn-ghost btn-sm" data-delete="${s.id}" style="color:var(--danger);">Excluir</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

    document.getElementById('new-supplier-btn').addEventListener('click', () => openSupplierModal(null));
    content.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => openSupplierModal(suppliers.find((s) => s.id === btn.dataset.edit)));
    });
    content.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const supplier = suppliers.find((s) => s.id === btn.dataset.toggle);
        const next = !supplier.active;
        const ok = await confirmDialog({
          title: next ? 'Reativar fornecedor' : 'Inativar fornecedor',
          message: `Deseja ${next ? 'reativar' : 'inativar'} "${escapeHtml(supplier.nome)}"?`,
          confirmLabel: next ? 'Reativar' : 'Inativar', danger: !next,
        });
        if (!ok) return;
        try {
          await setSupplierActive(supplier.id, next);
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: next ? 'Reativação de fornecedor' : 'Inativação de fornecedor',
            details: `Fornecedor "${supplier.nome}" ${next ? 'reativado' : 'inativado'}.`,
            entity: 'supplier', entityId: supplier.id,
          });
          showToast(`Fornecedor ${next ? 'reativado' : 'inativado'}.`, 'success');
          renderFornecedoresTab();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
    content.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const supplier = suppliers.find((s) => s.id === btn.dataset.delete);
        const ok = await confirmDialog({
          title: 'Excluir fornecedor',
          message: `Excluir "${escapeHtml(supplier.nome)}"? Pedidos de compra já feitos com ele não são afetados.`,
          confirmLabel: 'Excluir', danger: true,
        });
        if (!ok) return;
        try {
          await deleteSupplier(supplier.id);
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Exclusão de fornecedor', details: `Fornecedor "${supplier.nome}" excluído.`,
            entity: 'supplier', entityId: supplier.id,
          });
          showToast('Fornecedor excluído.', 'success');
          renderFornecedoresTab();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  function openSupplierModal(supplier) {
    const isEdit = !!supplier;
    openModal({
      title: isEdit ? 'Editar fornecedor' : 'Novo fornecedor',
      submitLabel: isEdit ? 'Salvar alterações' : 'Cadastrar fornecedor',
      bodyHtml: `
        <div id="modal-error"></div>
        <div class="field"><label>Nome *</label><input id="f-nome" value="${isEdit ? escapeHtml(supplier.nome) : ''}"></div>
        <div class="form-row">
          <div class="field"><label>Telefone</label><input id="f-telefone" value="${isEdit ? escapeHtml(formatPhoneBR(supplier.telefone)) : ''}" placeholder="(xx) x xxxx-xxxx" maxlength="17"></div>
          <div class="field"><label>E-mail</label><input id="f-email" type="email" value="${isEdit ? escapeHtml(supplier.email) : ''}" placeholder="exemplo@dominio.com"></div>
        </div>
        <div class="field"><label>CNPJ/CPF</label><input id="f-documento" value="${isEdit ? escapeHtml(formatCpfOrCnpj(supplier.documento)) : ''}" placeholder="xxx.xxx.xxx-xx" maxlength="18"></div>
        <div class="field"><label>Endereço</label><input id="f-endereco" value="${isEdit ? escapeHtml(supplier.endereco) : ''}"></div>
        <div class="field"><label>Observações</label><input id="f-obs" value="${isEdit ? escapeHtml(supplier.observacoes) : ''}"></div>
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
        const emailValue = modalEl.querySelector('#f-email').value;
        if (emailValue.trim() && !isValidEmail(emailValue)) {
          errBox.innerHTML = '<div class="form-error">E-mail inválido. Use o formato exemplo@dominio.com.</div>';
          return false;
        }
        const documentoValue = modalEl.querySelector('#f-documento').value;
        if (documentoValue.trim() && !isValidCpfOrCnpj(documentoValue)) {
          errBox.innerHTML = '<div class="form-error">CPF/CNPJ inválido. Confira os números digitados.</div>';
          return false;
        }
        const data = {
          nome,
          telefone: modalEl.querySelector('#f-telefone').value,
          email: emailValue,
          documento: documentoValue,
          endereco: modalEl.querySelector('#f-endereco').value,
          observacoes: modalEl.querySelector('#f-obs').value,
        };
        try {
          if (isEdit) {
            await updateSupplier(supplier.id, data);
            await logAction({
              userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
              action: 'Edição de fornecedor', details: `Fornecedor "${nome}" editado.`,
              entity: 'supplier', entityId: supplier.id,
            });
            showToast('Fornecedor atualizado.', 'success');
          } else {
            const created = await createSupplier(data);
            await logAction({
              userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
              action: 'Cadastro de fornecedor', details: `Fornecedor "${nome}" cadastrado.`,
              entity: 'supplier', entityId: created.id,
            });
            showToast('Fornecedor cadastrado.', 'success');
          }
          renderFornecedoresTab();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  // ==================== Pedidos de compra ====================

  async function renderPedidosTab({ resetPage = true } = {}) {
    const [orders, suppliers] = await Promise.all([listPurchaseOrders(), listSuppliers()]);
    if (resetPage) pedidosPgState.page = 1;
    const total = orders.length;
    const totalPages = Math.max(1, Math.ceil(total / pedidosPgState.pageSize));
    if (pedidosPgState.page > totalPages) pedidosPgState.page = totalPages;
    const start = (pedidosPgState.page - 1) * pedidosPgState.pageSize;
    const visible = orders.slice(start, start + pedidosPgState.pageSize);
    content.innerHTML = `
      <div class="utility-bar">
        <span class="text-muted" style="font-size:13px;">${total} pedido(s)</span>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" id="suggest-btn">Sugestão automática</button>
          <button class="btn btn-sm" id="new-order-btn">+ Novo pedido</button>
        </div>
      </div>
      ${orders.length === 0 ? '<div class="table-wrap"><div class="table-empty">Nenhum pedido de compra ainda.</div></div>' : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Fornecedor</th><th>Itens</th><th style="text-align:center;">Status</th><th></th></tr></thead>
            <tbody>
              ${visible.map((o) => `
                <tr>
                  <td>${formatDateTime(o.createdAt)}</td>
                  <td>${escapeHtml(o.supplierName)}</td>
                  <td>${o.items.length}</td>
                  <td style="text-align:center;">${ORDER_STATUS_BADGE[o.status]}</td>
                  <td><button class="btn btn-ghost btn-sm" data-detail="${o.id}">Ver detalhe</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${paginationHtml({ page: pedidosPgState.page, pageSize: pedidosPgState.pageSize, total })}
      `}
    `;

    document.getElementById('new-order-btn').addEventListener('click', () => openOrderModal(suppliers));
    document.getElementById('suggest-btn').addEventListener('click', () => openSuggestionModal(suppliers));
    content.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => openOrderDetailModal(visible.find((o) => o.id === btn.dataset.detail)));
    });
    wirePagination(content, pedidosPgState, (next) => { pedidosPgState = next; renderPedidosTab({ resetPage: false }); });
  }

  function productPickerRow(idx, presetProductId = '', presetName = '', presetQty = 1, presetCost = '') {
    return `
      <tr data-item-row="${idx}">
        <td style="min-width:220px;">
          <input type="text" data-item-search="${idx}" placeholder="Buscar produto…" value="${escapeHtml(presetName)}" class="table-inline-input" style="width:100%;">
          <input type="hidden" data-item-product-id="${idx}" value="${presetProductId}">
          <div data-item-results="${idx}"></div>
        </td>
        <td><input type="number" min="0.5" step="0.5" value="${presetQty}" data-item-qty="${idx}" class="table-inline-input" style="width:80px;"></td>
        <td><input type="number" min="0" step="0.01" value="${presetCost}" data-item-cost="${idx}" placeholder="0,00" class="table-inline-input" style="width:90px;"></td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-remove-row="${idx}">${icon('close', { size: 13 })}</button></td>
      </tr>
    `;
  }

  function openOrderModal(suppliers, presetSupplierId = '', presetItems = null) {
    if (suppliers.length === 0) {
      showToast('Cadastre um fornecedor antes de criar um pedido.', 'error');
      return;
    }
    let rowCount = 0;
    const initialRows = presetItems && presetItems.length > 0 ? presetItems : [{}];

    openModal({
      title: 'Novo pedido de compra',
      submitLabel: 'Criar pedido',
      wide: true,
      bodyHtml: `
        <div id="modal-error"></div>
        <div class="field">
          <label>Fornecedor *</label>
          <select id="f-supplier">
            ${suppliers.map((s) => `<option value="${s.id}" ${s.id === presetSupplierId ? 'selected' : ''}>${escapeHtml(s.nome)}</option>`).join('')}
          </select>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Produto</th><th>Quantidade</th><th>Custo unit. (R$)</th><th></th></tr></thead>
            <tbody id="items-tbody">
              ${initialRows.map((item) => productPickerRow(rowCount++, item.productId || '', item.name || '', item.suggestedQty || 1, item.unitCost || '')).join('')}
            </tbody>
          </table>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="add-row-btn" style="margin-top:8px;">+ Adicionar item</button>
        <div class="field" style="margin-top:12px;">
          <label>Observações</label>
          <input id="f-notes" placeholder="Opcional">
        </div>
      `,
      onMount: (modalEl) => {
        initialRows.forEach((_, i) => wireProductPicker(modalEl, i));
        modalEl.querySelectorAll('[data-remove-row]').forEach((btn) => {
          btn.addEventListener('click', () => modalEl.querySelector(`[data-item-row="${btn.dataset.removeRow}"]`)?.remove());
        });
        modalEl.querySelector('#add-row-btn').addEventListener('click', () => {
          const idx = rowCount++;
          modalEl.querySelector('#items-tbody').insertAdjacentHTML('beforeend', productPickerRow(idx));
          wireProductPicker(modalEl, idx);
          modalEl.querySelector(`[data-remove-row="${idx}"]`).addEventListener('click', () => {
            modalEl.querySelector(`[data-item-row="${idx}"]`)?.remove();
          });
        });
      },
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const supplierId = modalEl.querySelector('#f-supplier').value;
        const notes = modalEl.querySelector('#f-notes').value;
        const items = [];
        modalEl.querySelectorAll('[data-item-row]').forEach((row) => {
          const idx = row.dataset.itemRow;
          const productId = modalEl.querySelector(`[data-item-product-id="${idx}"]`).value;
          const name = modalEl.querySelector(`[data-item-search="${idx}"]`).value;
          const qty = Number(modalEl.querySelector(`[data-item-qty="${idx}"]`).value) || 0;
          const unitCost = modalEl.querySelector(`[data-item-cost="${idx}"]`).value;
          if (productId && qty > 0) items.push({ productId, name, qty, unitCost });
        });
        if (items.length === 0) {
          errBox.innerHTML = '<div class="form-error">Adicione ao menos um item (selecione o produto na busca).</div>';
          return false;
        }
        try {
          const order = await createPurchaseOrder({ supplierId, items, notes, userId: ctx.user.id, userName: ctx.user.nome });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Pedido de compra criado',
            details: `Pedido para "${order.supplierName}" com ${order.items.length} item(ns).`,
            entity: 'purchaseOrder', entityId: order.id,
          });
          showToast('Pedido de compra criado.', 'success');
          renderPedidosTab();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  async function openSuggestionModal(suppliers) {
    const bySupplier = await suggestPurchasesBySupplier();
    const supplierIds = Object.keys(bySupplier);
    if (supplierIds.length === 0) {
      showToast('Nenhum produto com estoque baixo tem fornecedor padrão cadastrado.', 'success');
      return;
    }
    openModal({
      title: 'Sugestão automática de compra',
      submitLabel: 'Fechar',
      singleButton: true,
      wide: true,
      bodyHtml: `
        <p class="text-muted" style="font-size:13px;">Produtos com estoque baixo, agrupados pelo fornecedor padrão de cada um.</p>
        ${supplierIds.map((sid) => {
          const supplier = suppliers.find((s) => s.id === sid);
          const items = bySupplier[sid];
          return `
            <div class="card" style="margin-bottom:12px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <strong>${escapeHtml(supplier?.nome || 'Fornecedor')}</strong>
                <button class="btn btn-sm" data-create-suggestion="${sid}">Criar pedido</button>
              </div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Produto</th><th>Estoque atual</th><th>Mínimo</th><th>Sugestão</th></tr></thead>
                  <tbody>
                    ${items.map((i) => `
                      <tr><td>${escapeHtml(i.name)}</td><td>${formatQty(i.currentQty)} ${escapeHtml(i.unit)}</td><td>${formatQty(i.minStock)} ${escapeHtml(i.unit)}</td><td>${formatQty(i.suggestedQty)} ${escapeHtml(i.unit)}</td></tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `;
        }).join('')}
      `,
      onMount: (modalEl, close) => {
        modalEl.querySelectorAll('[data-create-suggestion]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const sid = btn.dataset.createSuggestion;
            close();
            openOrderModal(suppliers, sid, bySupplier[sid]);
          });
        });
      },
      onSubmit: () => true,
    });
  }

  async function openOrderDetailModal(order) {
    const canReceive = order.status !== 'recebido' && order.status !== 'cancelado';
    const canCancel = order.status === 'aberto';
    openModal({
      title: `Pedido — ${escapeHtml(order.supplierName)}`,
      submitLabel: canReceive ? 'Receber mercadoria' : 'Fechar',
      cancelLabel: canReceive ? 'Fechar' : undefined,
      singleButton: !canReceive,
      wide: true,
      bodyHtml: `
        <p class="text-muted" style="font-size:13px;">
          ${formatDateTime(order.createdAt)} · ${ORDER_STATUS_BADGE[order.status]} · criado por ${escapeHtml(order.createdBy.userName)}
        </p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Produto</th><th>Pedido</th><th>Recebido</th><th>Custo unit.</th></tr></thead>
            <tbody>
              ${order.items.map((i) => `
                <tr>
                  <td>${escapeHtml(i.name)}</td>
                  <td>${formatQty(i.qtyOrdered)} ${escapeHtml(i.unit)}</td>
                  <td>${formatQty(i.qtyReceived)} ${escapeHtml(i.unit)}</td>
                  <td>${formatMoney(i.unitCost)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${order.notes ? `<p style="font-size:13px;margin-top:10px;"><strong>Observações:</strong> ${escapeHtml(order.notes)}</p>` : ''}
        ${order.receivedEntries.length > 0 ? `
          <p class="section-title" style="margin-top:14px;">Recebimentos</p>
          ${order.receivedEntries.map((e) => `
            <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:6px;padding:8px;background:var(--surface-alt);border-radius:6px;">
              ${formatDateTime(e.timestamp)} por ${escapeHtml(e.userName)} — ${e.items.map((i) => `${formatQty(i.qty)}× ${escapeHtml(i.name)}`).join(', ')}
            </div>
          `).join('')}
        ` : ''}
        ${canCancel ? '<button type="button" class="btn btn-ghost btn-sm" id="cancel-order-btn" style="color:var(--danger);margin-top:8px;">Cancelar pedido</button>' : ''}
      `,
      onMount: (modalEl, close) => {
        const cancelBtn = modalEl.querySelector('#cancel-order-btn');
        // Achado de auditoria (endurecimento — mesmo raciocínio de
        // views/carreto.js: este botão não é o submit do modal, então não
        // ganha de graça a trava contra clique duplo que components/modal.js
        // já dá ao botão principal). cancelPurchaseOrder() já é protegido
        // contra corrupção de verdade (dbUpdate em purchasesRepo.js), isto
        // aqui só evita um segundo clique disparar uma chamada concorrente
        // à toa enquanto a primeira ainda está em andamento.
        cancelBtn?.addEventListener('click', async () => {
          const ok = await confirmDialog({ title: 'Cancelar pedido', message: 'Cancelar este pedido de compra?', confirmLabel: 'Cancelar pedido', danger: true });
          if (!ok) return;
          cancelBtn.disabled = true;
          try {
            await cancelPurchaseOrder(order.id);
            await logAction({
              userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
              action: 'Pedido de compra cancelado', details: `Pedido de "${order.supplierName}" cancelado.`,
              entity: 'purchaseOrder', entityId: order.id,
            });
            showToast('Pedido cancelado.', 'success');
            close();
            renderPedidosTab();
          } catch (err) {
            showToast(err.message, 'error');
            cancelBtn.disabled = false;
          }
        });
      },
      onSubmit: (modalEl, close) => {
        if (!canReceive) return true;
        close();
        openReceiveModal(order);
        return false;
      },
    });
  }

  function openReceiveModal(order) {
    const pending = order.items.filter((i) => i.qtyReceived < i.qtyOrdered);
    // Achado de auditoria (P2): gerada uma vez só, na abertura do modal —
    // ver data/purchasesRepo.js#receivePurchaseOrder.
    const dedupeKey = crypto.randomUUID();
    openModal({
      title: `Receber mercadoria — ${escapeHtml(order.supplierName)}`,
      submitLabel: 'Confirmar recebimento',
      wide: true,
      bodyHtml: `
        <div id="modal-error"></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Produto</th><th>Pendente</th><th>Receber agora</th><th>Custo unit.</th></tr></thead>
            <tbody>
              ${pending.map((i) => `
                <tr>
                  <td>${escapeHtml(i.name)}</td>
                  <td>${formatQty(i.qtyOrdered - i.qtyReceived)} ${escapeHtml(i.unit)}</td>
                  <td><input type="number" min="0" max="${i.qtyOrdered - i.qtyReceived}" step="0.5" value="${i.qtyOrdered - i.qtyReceived}" data-recv-qty="${i.productId}" class="table-inline-input" style="width:80px;"></td>
                  <td><input type="number" min="0" step="0.01" value="${i.unitCost || ''}" data-recv-cost="${i.productId}" class="table-inline-input" style="width:90px;"></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Observação</label>
          <input id="f-note" placeholder="Ex: nota fiscal nº 12345">
        </div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const note = modalEl.querySelector('#f-note').value;
        const items = pending
          .map((i) => ({
            productId: i.productId,
            qty: Number(modalEl.querySelector(`[data-recv-qty="${i.productId}"]`).value) || 0,
            unitCost: modalEl.querySelector(`[data-recv-cost="${i.productId}"]`).value,
          }))
          .filter((i) => i.qty > 0);
        if (items.length === 0) {
          errBox.innerHTML = '<div class="form-error">Informe ao menos uma quantidade recebida.</div>';
          return false;
        }
        try {
          const { order: updated } = await receivePurchaseOrder({
            orderId: order.id, items, note, userId: ctx.user.id, userName: ctx.user.nome, dedupeKey,
          });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Recebimento de mercadoria',
            details: `Recebimento de ${items.length} item(ns) do pedido de "${order.supplierName}" (status: ${updated.status}).`,
            entity: 'purchaseOrder', entityId: order.id,
          });
          showToast('Mercadoria recebida e estoque atualizado.', 'success');
          renderPedidosTab();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  setTab(activeTab);
}
