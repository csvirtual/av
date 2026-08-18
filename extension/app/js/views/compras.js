// Fornecedores e pedidos de compra — exclusivo do administrador, é gestão
// de estoque/financeiro da loja (mesma régua de quem pode cadastrar
// produto), diferente de clientes que é operação do dia a dia de venda.
import {
  listSuppliers, createSupplier, updateSupplier, setSupplierActive, deleteSupplier,
} from '../data/suppliersRepo.js';
import {
  listPurchaseOrders, createPurchaseOrder, receivePurchaseOrder,
  cancelPurchaseOrder, suggestPurchasesBySupplier,
} from '../data/purchasesRepo.js';
import { searchProducts } from '../data/productsRepo.js';
import { logAction } from '../data/auditRepo.js';
import { formatMoney, formatDateTime, escapeHtml } from '../utils/format.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';

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
            <thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${suppliers.map((s) => `
                <tr>
                  <td>${escapeHtml(s.nome)}</td>
                  <td>${escapeHtml(s.telefone || '—')}</td>
                  <td>${escapeHtml(s.email || '—')}</td>
                  <td>${s.active ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-gray">Inativo</span>'}</td>
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
        await deleteSupplier(supplier.id);
        await logAction({
          userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
          action: 'Exclusão de fornecedor', details: `Fornecedor "${supplier.nome}" excluído.`,
          entity: 'supplier', entityId: supplier.id,
        });
        showToast('Fornecedor excluído.', 'success');
        renderFornecedoresTab();
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
          <div class="field"><label>Telefone</label><input id="f-telefone" value="${isEdit ? escapeHtml(supplier.telefone) : ''}"></div>
          <div class="field"><label>E-mail</label><input id="f-email" value="${isEdit ? escapeHtml(supplier.email) : ''}"></div>
        </div>
        <div class="field"><label>CNPJ/CPF</label><input id="f-documento" value="${isEdit ? escapeHtml(supplier.documento) : ''}"></div>
        <div class="field"><label>Endereço</label><input id="f-endereco" value="${isEdit ? escapeHtml(supplier.endereco) : ''}"></div>
        <div class="field"><label>Observações</label><input id="f-obs" value="${isEdit ? escapeHtml(supplier.observacoes) : ''}"></div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const nome = modalEl.querySelector('#f-nome').value.trim();
        if (!nome) { errBox.innerHTML = '<div class="form-error">Nome é obrigatório.</div>'; return false; }
        const data = {
          nome,
          telefone: modalEl.querySelector('#f-telefone').value,
          email: modalEl.querySelector('#f-email').value,
          documento: modalEl.querySelector('#f-documento').value,
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

  async function renderPedidosTab() {
    const [orders, suppliers] = await Promise.all([listPurchaseOrders(), listSuppliers()]);
    content.innerHTML = `
      <div class="utility-bar">
        <span class="text-muted" style="font-size:13px;">${orders.length} pedido(s)</span>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" id="suggest-btn">Sugestão automática</button>
          <button class="btn btn-sm" id="new-order-btn">+ Novo pedido</button>
        </div>
      </div>
      ${orders.length === 0 ? '<div class="table-wrap"><div class="table-empty">Nenhum pedido de compra ainda.</div></div>' : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Fornecedor</th><th>Itens</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${orders.map((o) => `
                <tr>
                  <td>${formatDateTime(o.createdAt)}</td>
                  <td>${escapeHtml(o.supplierName)}</td>
                  <td>${o.items.length}</td>
                  <td>${ORDER_STATUS_BADGE[o.status]}</td>
                  <td><button class="btn btn-ghost btn-sm" data-detail="${o.id}">Ver detalhe</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

    document.getElementById('new-order-btn').addEventListener('click', () => openOrderModal(suppliers));
    document.getElementById('suggest-btn').addEventListener('click', () => openSuggestionModal(suppliers));
    content.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => openOrderDetailModal(orders.find((o) => o.id === btn.dataset.detail)));
    });
  }

  function productPickerRow(idx, presetProductId = '', presetName = '', presetQty = 1, presetCost = '') {
    return `
      <tr data-item-row="${idx}">
        <td style="min-width:220px;">
          <input type="text" data-item-search="${idx}" placeholder="Buscar produto…" value="${escapeHtml(presetName)}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;">
          <input type="hidden" data-item-product-id="${idx}" value="${presetProductId}">
          <div data-item-results="${idx}"></div>
        </td>
        <td><input type="number" min="1" step="1" value="${presetQty}" data-item-qty="${idx}" style="width:80px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;"></td>
        <td><input type="number" min="0" step="0.01" value="${presetCost}" data-item-cost="${idx}" placeholder="0,00" style="width:90px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;"></td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-remove-row="${idx}">✕</button></td>
      </tr>
    `;
  }

  function wireProductPicker(modalEl, idx) {
    const searchInput = modalEl.querySelector(`[data-item-search="${idx}"]`);
    const resultsDiv = modalEl.querySelector(`[data-item-results="${idx}"]`);
    const hiddenId = modalEl.querySelector(`[data-item-product-id="${idx}"]`);
    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      const term = searchInput.value.trim();
      hiddenId.value = ''; // exige reselecionar se o texto mudou
      if (term.length < 2) { resultsDiv.innerHTML = ''; return; }
      debounce = setTimeout(async () => {
        const matches = await searchProducts(term);
        resultsDiv.innerHTML = matches.slice(0, 6).map((p) => `
          <div class="btn btn-ghost btn-sm" data-pick-product="${p.id}" data-pick-name="${escapeHtml(p.name)}" style="display:block;text-align:left;cursor:pointer;">${escapeHtml(p.name)}</div>
        `).join('');
        resultsDiv.querySelectorAll('[data-pick-product]').forEach((el) => {
          el.addEventListener('click', () => {
            hiddenId.value = el.dataset.pickProduct;
            searchInput.value = el.dataset.pickName;
            resultsDiv.innerHTML = '';
          });
        });
      }, 200);
    });
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
                      <tr><td>${escapeHtml(i.name)}</td><td>${i.currentQty} ${escapeHtml(i.unit)}</td><td>${i.minStock} ${escapeHtml(i.unit)}</td><td>${i.suggestedQty} ${escapeHtml(i.unit)}</td></tr>
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
                  <td>${i.qtyOrdered} ${escapeHtml(i.unit)}</td>
                  <td>${i.qtyReceived} ${escapeHtml(i.unit)}</td>
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
              ${formatDateTime(e.timestamp)} por ${escapeHtml(e.userName)} — ${e.items.map((i) => `${i.qty}× ${escapeHtml(i.name)}`).join(', ')}
            </div>
          `).join('')}
        ` : ''}
        ${canCancel ? '<button type="button" class="btn btn-ghost btn-sm" id="cancel-order-btn" style="color:var(--danger);margin-top:8px;">Cancelar pedido</button>' : ''}
      `,
      onMount: (modalEl, close) => {
        modalEl.querySelector('#cancel-order-btn')?.addEventListener('click', async () => {
          const ok = await confirmDialog({ title: 'Cancelar pedido', message: 'Cancelar este pedido de compra?', confirmLabel: 'Cancelar pedido', danger: true });
          if (!ok) return;
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
                  <td>${i.qtyOrdered - i.qtyReceived} ${escapeHtml(i.unit)}</td>
                  <td><input type="number" min="0" max="${i.qtyOrdered - i.qtyReceived}" step="1" value="${i.qtyOrdered - i.qtyReceived}" data-recv-qty="${i.productId}" style="width:80px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;"></td>
                  <td><input type="number" min="0" step="0.01" value="${i.unitCost || ''}" data-recv-cost="${i.productId}" style="width:90px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;"></td>
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
            orderId: order.id, items, note, userId: ctx.user.id, userName: ctx.user.nome,
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
