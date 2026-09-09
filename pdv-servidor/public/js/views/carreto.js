// Carreto — organiza o que precisa ser entregue pro cliente numa entrega
// (produtos do estoque + itens avulsos) e controla se já saiu ou não.
// Disponível pros dois perfis, igual Clientes e Caixa: é operação do dia a
// dia da loja, não gestão sensível. Não mexe em estoque nem em caixa — é
// só uma lista organizada de "o que leva, pra quem, e se já foi".
import { listDeliveries, createDelivery, markDelivered, cancelDelivery } from '../data/deliveriesRepo.js';
import { renderCustomerPicker } from '../components/customerPicker.js';
import { wireProductPicker } from '../components/productPicker.js';
import { logAction } from '../data/auditRepo.js';
import { formatDateTime, escapeHtml, displayUnit, formatQty } from '../utils/format.js';
import { icon } from '../components/icon.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { paginationHtml, wirePagination, createPageState } from '../components/pagination.js';
import { enhanceSelect } from '../components/customSelect.js';

const STATUS_BADGE = {
  pendente: '<span class="badge badge-gray">Pendente</span>',
  entregue: '<span class="badge badge-green">Entregue</span>',
  cancelado: '<span class="badge badge-red">Cancelado</span>',
};

export async function renderCarreto(container, ctx) {
  let statusFilter = 'pendente';

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Carreto</h1>
        <div class="desc">Organize o que precisa ser entregue, pra quem, e acompanhe se já saiu.</div>
      </div>
      <div class="page-actions">
        <button class="btn" id="new-delivery-btn">+ Novo carreto</button>
      </div>
    </div>
    <div class="toolbar">
      <select id="status-filter">
        <option value="pendente">Pendentes</option>
        <option value="entregue">Entregues</option>
        <option value="cancelado">Cancelados</option>
        <option value="">Todos</option>
      </select>
    </div>
    <div id="deliveries-table"></div>
  `;

  const tableBox = document.getElementById('deliveries-table');
  let pgState = createPageState();

  async function refresh({ resetPage = true } = {}) {
    const all = await listDeliveries();
    const filtered = statusFilter ? all.filter((d) => d.status === statusFilter) : all;
    if (resetPage) pgState.page = 1;
    renderTable(filtered);
  }

  function renderTable(list) {
    if (list.length === 0) {
      tableBox.innerHTML = '<div class="table-wrap"><div class="table-empty">Nenhum carreto encontrado para o filtro selecionado.</div></div>';
      return;
    }
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / pgState.pageSize));
    if (pgState.page > totalPages) pgState.page = totalPages;
    const start = (pgState.page - 1) * pgState.pageSize;
    const visible = list.slice(start, start + pgState.pageSize);
    tableBox.innerHTML = `
      <div class="utility-bar"><span class="text-muted" style="font-size:13px;">${total} carreto(s)</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data/Hora</th><th>Cliente</th><th>Endereço</th><th>Itens</th><th>Responsável</th><th style="text-align:center;">Status</th><th></th></tr></thead>
          <tbody>
            ${visible.map((d) => `
              <tr>
                <td>${formatDateTime(d.createdAt)}</td>
                <td>${escapeHtml(d.customerName)}</td>
                <td class="text-muted">${escapeHtml(d.address || '—')}</td>
                <td>${d.items.length}</td>
                <td class="text-muted">${escapeHtml(d.responsible || '—')}</td>
                <td style="text-align:center;">${STATUS_BADGE[d.status]}</td>
                <td><button class="btn btn-ghost btn-sm" data-detail="${d.id}">Ver itens</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${paginationHtml({ page: pgState.page, pageSize: pgState.pageSize, total })}
    `;
    tableBox.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => showDeliveryDetail(visible.find((d) => d.id === btn.dataset.detail)));
    });
    wirePagination(tableBox, pgState, (next) => { pgState = next; renderTable(list); });
  }

  function showDeliveryDetail(delivery) {
    const canAct = delivery.status === 'pendente';
    openModal({
      title: `Carreto — ${escapeHtml(delivery.customerName)}`,
      submitLabel: canAct ? 'Marcar como entregue' : 'Fechar',
      cancelLabel: canAct ? 'Fechar' : undefined,
      singleButton: !canAct,
      wide: true,
      bodyHtml: `
        <p class="text-muted" style="font-size:13px;">
          ${formatDateTime(delivery.createdAt)} · ${STATUS_BADGE[delivery.status]} · pedido por ${escapeHtml(delivery.createdBy.userName)}
          ${delivery.saleId ? ' · gerado junto com uma venda' : ''}
        </p>
        <p style="font-size:13px;"><strong>Endereço:</strong> ${escapeHtml(delivery.address || 'não informado')}</p>
        ${delivery.responsible ? `<p style="font-size:13px;"><strong>Responsável pela entrega:</strong> ${escapeHtml(delivery.responsible)}</p>` : ''}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Qtd.</th><th>Origem</th></tr></thead>
            <tbody>
              ${delivery.items.map((i) => `
                <tr>
                  <td>${escapeHtml(i.name)}</td>
                  <td>${formatQty(i.qty)} ${escapeHtml(i.unit)}</td>
                  <td>${i.source === 'avulso' ? '<span class="badge badge-gray">Avulso</span>' : '<span class="badge badge-green">Estoque</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${delivery.notes ? `<p style="font-size:13px;margin-top:10px;"><strong>Observações:</strong> ${escapeHtml(delivery.notes)}</p>` : ''}
        ${delivery.status === 'entregue' ? `<p class="text-muted" style="font-size:12.5px;margin-top:10px;">Entregue em ${formatDateTime(delivery.deliveredAt)} por ${escapeHtml(delivery.deliveredBy.userName)}.</p>` : ''}
        ${canAct ? '<button type="button" class="btn btn-ghost btn-sm" id="cancel-delivery-btn" style="color:var(--danger);margin-top:8px;">Cancelar carreto</button>' : ''}
      `,
      onMount: (modalEl, close) => {
        const cancelBtn = modalEl.querySelector('#cancel-delivery-btn');
        // Achado de auditoria (endurecimento — não é o botão de submit do
        // modal, que já tem essa trava embutida em components/modal.js):
        // sem desabilitar na hora do clique, ficava uma janela real (entre
        // o confirmDialog resolver e cancelDelivery terminar) em que um
        // segundo clique disparava outra chamada concorrente. O dbUpdate
        // em deliveriesRepo.js já impede corrupção de verdade (a segunda
        // chamada acharia o status já 'cancelado' e falharia limpo), mas
        // sem isto o usuário via um toast de erro confuso à toa.
        cancelBtn?.addEventListener('click', async () => {
          const ok = await confirmDialog({ title: 'Cancelar carreto', message: 'Cancelar esta entrega?', confirmLabel: 'Cancelar carreto', danger: true });
          if (!ok) return;
          cancelBtn.disabled = true;
          try {
            await cancelDelivery(delivery.id);
            await logAction({
              userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
              action: 'Carreto cancelado',
              details: `Carreto para "${delivery.customerName}" cancelado.`,
              entity: 'delivery', entityId: delivery.id,
            });
            showToast('Carreto cancelado.', 'success');
            close();
            refresh();
          } catch (err) {
            showToast(err.message, 'error');
            cancelBtn.disabled = false;
          }
        });
      },
      onSubmit: async () => {
        if (!canAct) return true;
        try {
          await markDelivered(delivery.id, { userId: ctx.user.id, userName: ctx.user.nome });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Carreto entregue',
            details: `Carreto para "${delivery.customerName}" marcado como entregue.`,
            entity: 'delivery', entityId: delivery.id,
          });
          showToast('Carreto marcado como entregue.', 'success');
          refresh();
          return true;
        } catch (err) {
          showToast(err.message, 'error');
          return false;
        }
      },
    });
  }

  // ---------- Novo carreto ----------
  function itemRow(idx, source) {
    if (source === 'avulso') {
      return `
        <tr data-item-row="${idx}" data-item-source="avulso">
          <td style="min-width:220px;">
            <input type="text" data-item-name-input="${idx}" placeholder="Descreva o item (ex: carga de areia)" class="table-inline-input" style="width:100%;">
            <span class="text-muted" style="font-size:11px;">Item avulso (fora do estoque)</span>
          </td>
          <td><input type="number" min="1" step="1" value="1" data-item-qty="${idx}" class="table-inline-input" style="width:70px;"></td>
          <td><input type="text" data-item-unit-input="${idx}" value="un" class="table-inline-input" style="width:60px;"></td>
          <td><button type="button" class="btn btn-ghost btn-sm" data-remove-row="${idx}">${icon('close', { size: 13 })}</button></td>
        </tr>
      `;
    }
    return `
      <tr data-item-row="${idx}" data-item-source="estoque">
        <td style="min-width:220px;">
          <input type="text" data-item-search="${idx}" placeholder="Buscar produto do estoque…" class="table-inline-input" style="width:100%;">
          <input type="hidden" data-item-product-id="${idx}" value="">
          <input type="hidden" data-item-name="${idx}" value="">
          <input type="hidden" data-item-unit="${idx}" value="un">
          <div data-item-results="${idx}"></div>
        </td>
        <td><input type="number" min="1" step="1" value="1" data-item-qty="${idx}" class="table-inline-input" style="width:70px;"></td>
        <td class="text-muted" data-item-unit-display="${idx}" style="font-size:13px;">un</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-remove-row="${idx}">${icon('close', { size: 13 })}</button></td>
      </tr>
    `;
  }

  function wireStockPicker(modalEl, idx) {
    const hiddenName = modalEl.querySelector(`[data-item-name="${idx}"]`);
    const hiddenUnit = modalEl.querySelector(`[data-item-unit="${idx}"]`);
    const unitDisplay = modalEl.querySelector(`[data-item-unit-display="${idx}"]`);
    wireProductPicker(modalEl, idx, {
      onPick: (product) => {
        hiddenName.value = product.name;
        hiddenUnit.value = displayUnit(product);
        unitDisplay.textContent = displayUnit(product);
      },
    });
  }

  function wireRemoveRow(modalEl, idx) {
    modalEl.querySelector(`[data-remove-row="${idx}"]`).addEventListener('click', () => {
      modalEl.querySelector(`[data-item-row="${idx}"]`)?.remove();
    });
  }

  function openNewDeliveryModal() {
    let rowCount = 0;
    let selectedCustomer = null;
    // Achado de auditoria (P2): gerada uma vez só, na abertura do modal —
    // ver data/deliveriesRepo.js#createDelivery.
    const dedupeKey = crypto.randomUUID();

    openModal({
      title: 'Novo carreto',
      submitLabel: 'Cadastrar carreto',
      wide: true,
      bodyHtml: `
        <div id="modal-error"></div>
        <div class="field">
          <label>Cliente *</label>
          <div id="customer-box"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Endereço de entrega</label><input id="f-address" placeholder="Preenche sozinho ao escolher o cliente, mas pode editar"></div>
          <div class="field"><label>Responsável pela entrega</label><input id="f-responsible" placeholder="Ex: nome do motorista"></div>
        </div>
        <p class="section-title" style="margin-top:16px;">Itens</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Quantidade</th><th>Unidade</th><th></th></tr></thead>
            <tbody id="items-tbody"></tbody>
          </table>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button type="button" class="btn btn-ghost btn-sm" id="add-stock-row-btn">+ Item do estoque</button>
          <button type="button" class="btn btn-ghost btn-sm" id="add-avulso-row-btn">+ Item avulso</button>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Observações</label>
          <input id="f-notes" placeholder="Opcional">
        </div>
      `,
      onMount: (modalEl) => {
        const customerBox = modalEl.querySelector('#customer-box');
        const addressInput = modalEl.querySelector('#f-address');

        function renderCustomerBox() {
          renderCustomerPicker(customerBox, {
            getSelected: () => selectedCustomer,
            setSelected: (c) => { selectedCustomer = c; },
            onPicked: (c) => { if (!addressInput.value.trim()) addressInput.value = c.endereco || ''; },
          });
        }
        renderCustomerBox();

        const tbody = modalEl.querySelector('#items-tbody');
        function addRow(source) {
          const idx = rowCount++;
          tbody.insertAdjacentHTML('beforeend', itemRow(idx, source));
          if (source === 'estoque') wireStockPicker(modalEl, idx);
          wireRemoveRow(modalEl, idx);
        }
        modalEl.querySelector('#add-stock-row-btn').addEventListener('click', () => addRow('estoque'));
        modalEl.querySelector('#add-avulso-row-btn').addEventListener('click', () => addRow('avulso'));
        addRow('estoque'); // já começa com uma linha, poupa um clique
      },
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        errBox.innerHTML = '';

        if (!selectedCustomer) {
          errBox.innerHTML = '<div class="form-error">Selecione um cliente para o carreto.</div>';
          return false;
        }

        const items = [];
        modalEl.querySelectorAll('[data-item-row]').forEach((row) => {
          const idx = row.dataset.itemRow;
          if (row.dataset.itemSource === 'avulso') {
            const name = modalEl.querySelector(`[data-item-name-input="${idx}"]`).value.trim();
            const qty = Number(modalEl.querySelector(`[data-item-qty="${idx}"]`).value) || 0;
            const unit = modalEl.querySelector(`[data-item-unit-input="${idx}"]`).value.trim() || 'un';
            if (name && qty > 0) items.push({ source: 'avulso', name, qty, unit });
          } else {
            const productId = modalEl.querySelector(`[data-item-product-id="${idx}"]`).value;
            const name = modalEl.querySelector(`[data-item-name="${idx}"]`).value;
            const unit = modalEl.querySelector(`[data-item-unit="${idx}"]`).value;
            const qty = Number(modalEl.querySelector(`[data-item-qty="${idx}"]`).value) || 0;
            if (productId && qty > 0) items.push({ source: 'estoque', productId, name, qty, unit });
          }
        });
        if (items.length === 0) {
          errBox.innerHTML = '<div class="form-error">Adicione ao menos um item (selecione o produto na busca, ou descreva um item avulso).</div>';
          return false;
        }

        try {
          const delivery = await createDelivery({
            customerId: selectedCustomer.id,
            items,
            address: modalEl.querySelector('#f-address').value,
            responsible: modalEl.querySelector('#f-responsible').value,
            notes: modalEl.querySelector('#f-notes').value,
            userId: ctx.user.id, userName: ctx.user.nome,
            dedupeKey,
          });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Carreto cadastrado',
            details: `Carreto para "${delivery.customerName}" com ${delivery.items.length} item(ns).`,
            entity: 'delivery', entityId: delivery.id,
          });
          showToast('Carreto cadastrado.', 'success');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  document.getElementById('new-delivery-btn').addEventListener('click', openNewDeliveryModal);
  document.getElementById('status-filter').addEventListener('change', (e) => { statusFilter = e.target.value; refresh(); });
  enhanceSelect(document.getElementById('status-filter'));

  refresh();
}
