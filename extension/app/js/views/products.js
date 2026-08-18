// Estoque geral: todos os perfis podem consultar (nome, categoria, preço,
// quantidade). Cadastrar/editar produto e fazer ajuste manual de estoque é
// exclusivo do Administrador — vendedores só consultam e vendem (a baixa de
// estoque por venda acontece na tela de Nova Venda, não aqui).
import {
  listProducts, searchProducts, createProduct, updateProduct,
  setProductActive, deleteProduct,
} from '../data/productsRepo.js';
import { recordMovement, listMovementsByProduct } from '../data/stockRepo.js';
import { listSuppliers } from '../data/suppliersRepo.js';
import { logAction } from '../data/auditRepo.js';
import { generateInternalBarcode } from '../utils/barcode.js';
import { formatMoney, formatDateTime, escapeHtml } from '../utils/format.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';

const MOVEMENT_LABELS = {
  entrada: 'Entrada', saida: 'Saída', venda: 'Venda', ajuste: 'Ajuste', estorno: 'Estorno',
};

const UNITS = ['un', 'kg', 'g', 'L', 'ml', 'cx', 'saco', 'm', 'pct'];

export async function renderProducts(container, ctx) {
  const isAdmin = ctx.user.role === 'admin';
  let currentFilter = { term: '', category: '' };

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Estoque</h1>
        <div class="desc">Material de construção e mercearia — visão geral do que a loja tem disponível.</div>
      </div>
      <div class="page-actions">
        ${isAdmin ? '<button class="btn btn-secondary" id="inventory-btn">Fazer inventário</button>' : ''}
        ${isAdmin ? '<button class="btn" id="new-product-btn">+ Novo produto</button>' : ''}
      </div>
    </div>
    <div class="toolbar">
      <input type="search" id="search-input" placeholder="Buscar por nome ou código de barras…" autofocus>
      <select id="category-filter">
        <option value="">Todas as categorias</option>
        <option value="material">Material de construção</option>
        <option value="mercearia">Mercearia</option>
      </select>
    </div>
    <div id="products-table"></div>
  `;

  const tableBox = document.getElementById('products-table');

  async function refresh() {
    let products = currentFilter.term ? await searchProducts(currentFilter.term) : await listProducts();
    if (currentFilter.category) products = products.filter((p) => p.category === currentFilter.category);
    tableBox.innerHTML = renderTable(products, isAdmin);
    wireRowActions(products);
  }

  document.getElementById('search-input').addEventListener('input', (e) => {
    currentFilter.term = e.target.value;
    refresh();
  });
  document.getElementById('category-filter').addEventListener('change', (e) => {
    currentFilter.category = e.target.value;
    refresh();
  });

  if (isAdmin) {
    document.getElementById('new-product-btn').addEventListener('click', () => openProductModal(null));
    document.getElementById('inventory-btn').addEventListener('click', () => openInventoryModal());
  }

  function wireRowActions(products) {
    tableBox.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => openProductModal(products.find((p) => p.id === btn.dataset.edit)));
    });
    tableBox.querySelectorAll('[data-adjust]').forEach((btn) => {
      btn.addEventListener('click', () => openAdjustModal(products.find((p) => p.id === btn.dataset.adjust)));
    });
    tableBox.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => toggleActive(products.find((p) => p.id === btn.dataset.toggle)));
    });
    tableBox.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => removeProduct(products.find((p) => p.id === btn.dataset.delete)));
    });
    tableBox.querySelectorAll('[data-history]').forEach((btn) => {
      btn.addEventListener('click', () => openHistoryModal(products.find((p) => p.id === btn.dataset.history)));
    });
  }

  async function openHistoryModal(product) {
    const movements = await listMovementsByProduct(product.id);
    openModal({
      title: `Histórico de estoque — ${escapeHtml(product.name)}`,
      submitLabel: 'Fechar',
      singleButton: true,
      bodyHtml: movements.length === 0
        ? '<div class="table-empty">Nenhuma movimentação registrada para este produto ainda.</div>'
        : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Data/Hora</th><th>Tipo</th><th>Qtd</th><th>Usuário</th><th>Obs.</th></tr></thead>
              <tbody>
                ${movements.map((m) => `
                  <tr>
                    <td style="white-space:nowrap;">${formatDateTime(m.timestamp)}</td>
                    <td>${MOVEMENT_LABELS[m.type] || m.type}</td>
                    <td>${m.qty > 0 ? '+' : ''}${m.qty} ${escapeHtml(product.unit)}</td>
                    <td>${escapeHtml(m.userName)}</td>
                    <td class="text-muted">${escapeHtml(m.note || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `,
      onSubmit: () => true,
    });
  }

  async function toggleActive(product) {
    const next = !product.active;
    const ok = await confirmDialog({
      title: next ? 'Reativar produto' : 'Inativar produto',
      message: `Deseja ${next ? 'reativar' : 'inativar'} "${escapeHtml(product.name)}"? ${next ? '' : 'Ele deixará de aparecer nas vendas, mas o histórico é preservado.'}`,
      confirmLabel: next ? 'Reativar' : 'Inativar',
      danger: !next,
    });
    if (!ok) return;
    await setProductActive(product.id, next);
    await logAction({
      userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
      action: next ? 'Reativação de produto' : 'Inativação de produto',
      details: `Produto "${product.name}" (código ${product.barcode}) ${next ? 'reativado' : 'inativado'}.`,
      entity: 'product', entityId: product.id,
    });
    showToast(`Produto ${next ? 'reativado' : 'inativado'}.`, 'success');
    refresh();
  }

  async function removeProduct(product) {
    const ok = await confirmDialog({
      title: 'Excluir produto',
      message: `Excluir definitivamente "${escapeHtml(product.name)}"? Isso não afeta vendas já registradas, mas remove o produto do catálogo. Prefira "Inativar" se ele já teve movimentação.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    await deleteProduct(product.id);
    await logAction({
      userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
      action: 'Exclusão de produto',
      details: `Produto "${product.name}" (código ${product.barcode}) excluído do catálogo.`,
      entity: 'product', entityId: product.id,
    });
    showToast('Produto excluído.', 'success');
    refresh();
  }

  async function openProductModal(product) {
    const isEdit = !!product;
    const suppliers = await listSuppliers();
    openModal({
      title: isEdit ? 'Editar produto' : 'Novo produto',
      submitLabel: isEdit ? 'Salvar alterações' : 'Cadastrar produto',
      bodyHtml: `
        <div id="modal-error"></div>
        <div class="field">
          <label>Nome do produto *</label>
          <input id="f-name" value="${isEdit ? escapeHtml(product.name) : ''}">
        </div>
        <div class="form-row">
          <div class="field">
            <label>Categoria *</label>
            <select id="f-category">
              <option value="material" ${!isEdit || product.category === 'material' ? 'selected' : ''}>Material de construção</option>
              <option value="mercearia" ${isEdit && product.category === 'mercearia' ? 'selected' : ''}>Mercearia</option>
            </select>
          </div>
          <div class="field">
            <label>Unidade</label>
            <select id="f-unit">${UNITS.map((u) => `<option value="${u}" ${isEdit && product.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field">
          <label>Código de barras *</label>
          <div style="display:flex;gap:8px;">
            <input id="f-barcode" style="flex:1;" value="${isEdit ? escapeHtml(product.barcode) : ''}" placeholder="Escaneie ou digite o código">
            <button type="button" class="btn btn-secondary btn-sm" id="gen-barcode-btn">Gerar código interno</button>
          </div>
          <span class="hint">Sem código de fábrica (ex: item a granel)? Gere um código interno.</span>
        </div>
        <div class="form-row">
          <div class="field">
            <label>Preço de venda (R$) *</label>
            <input id="f-price" type="number" step="0.01" min="0" value="${isEdit ? product.price : ''}">
          </div>
          <div class="field">
            <label>Preço de custo (R$)</label>
            <input id="f-cost" type="number" step="0.01" min="0" value="${isEdit ? product.costPrice : ''}">
          </div>
        </div>
        <div class="form-row">
          ${isEdit ? '' : `
          <div class="field">
            <label>Quantidade inicial em estoque *</label>
            <input id="f-quantity" type="number" step="1" min="0" value="0">
          </div>`}
          <div class="field">
            <label>Estoque mínimo (alerta)</label>
            <input id="f-min" type="number" step="1" min="0" value="${isEdit ? product.minStock : 0}">
          </div>
        </div>
        <div class="field">
          <label>Fornecedor padrão</label>
          <select id="f-supplier">
            <option value="">Nenhum</option>
            ${suppliers.map((s) => `<option value="${s.id}" ${isEdit && product.supplierId === s.id ? 'selected' : ''}>${escapeHtml(s.nome)}</option>`).join('')}
          </select>
          <span class="hint">Usado pra agrupar a sugestão automática de compra em Compras → Sugestão.</span>
        </div>
      `,
      onMount: (modalEl) => {
        modalEl.querySelector('#gen-barcode-btn').addEventListener('click', () => {
          modalEl.querySelector('#f-barcode').value = generateInternalBarcode();
        });
      },
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        errBox.innerHTML = '';
        const name = modalEl.querySelector('#f-name').value.trim();
        const barcode = modalEl.querySelector('#f-barcode').value.trim();
        const price = modalEl.querySelector('#f-price').value;
        if (!name || !barcode || price === '') {
          errBox.innerHTML = '<div class="form-error">Preencha nome, código de barras e preço.</div>';
          return false;
        }
        const data = {
          name,
          category: modalEl.querySelector('#f-category').value,
          unit: modalEl.querySelector('#f-unit').value,
          barcode,
          barcodeIsInternal: barcode.startsWith('INT'),
          price,
          costPrice: modalEl.querySelector('#f-cost').value,
          minStock: modalEl.querySelector('#f-min').value,
          supplierId: modalEl.querySelector('#f-supplier').value || null,
        };
        try {
          if (isEdit) {
            await updateProduct(product.id, data);
            await logAction({
              userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
              action: 'Edição de produto',
              details: `Produto "${name}" (código ${barcode}) editado.`,
              entity: 'product', entityId: product.id,
            });
            showToast('Produto atualizado.', 'success');
          } else {
            data.quantity = modalEl.querySelector('#f-quantity').value;
            const created = await createProduct(data);
            if (Number(data.quantity) > 0) {
              await recordMovement({
                productId: created.id, type: 'entrada', qty: Number(data.quantity),
                userId: ctx.user.id, userName: ctx.user.nome, note: 'Estoque inicial no cadastro do produto',
              });
            }
            await logAction({
              userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
              action: 'Cadastro de produto',
              details: `Produto "${name}" (código ${barcode}) cadastrado.`,
              entity: 'product', entityId: created.id,
            });
            showToast('Produto cadastrado.', 'success');
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

  function openAdjustModal(product) {
    openModal({
      title: `Ajustar estoque — ${escapeHtml(product.name)}`,
      submitLabel: 'Confirmar ajuste',
      bodyHtml: `
        <div id="modal-error"></div>
        <p class="text-muted" style="font-size:13px;">Estoque atual: <strong>${product.quantity} ${escapeHtml(product.unit)}</strong></p>
        <div class="field">
          <label>Tipo de movimento</label>
          <select id="f-type">
            <option value="entrada">Entrada (compra/reposição)</option>
            <option value="saida">Saída (perda, quebra, devolução ao fornecedor)</option>
          </select>
        </div>
        <div class="field">
          <label>Quantidade *</label>
          <input id="f-qty" type="number" min="1" step="1" value="1">
        </div>
        <div class="field">
          <label>Observação</label>
          <input id="f-note" placeholder="Ex: reposição do fornecedor X">
        </div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const type = modalEl.querySelector('#f-type').value;
        const qty = Number(modalEl.querySelector('#f-qty').value);
        const note = modalEl.querySelector('#f-note').value.trim();
        if (!qty || qty <= 0) {
          errBox.innerHTML = '<div class="form-error">Informe uma quantidade válida.</div>';
          return false;
        }
        const delta = type === 'entrada' ? qty : -qty;
        try {
          await recordMovement({
            productId: product.id, type, qty: delta,
            userId: ctx.user.id, userName: ctx.user.nome, note,
          });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Ajuste manual de estoque',
            details: `${type === 'entrada' ? 'Entrada' : 'Saída'} de ${qty} ${product.unit} em "${product.name}". ${note ? `Obs: ${note}` : ''}`,
            entity: 'product', entityId: product.id,
          });
          showToast('Estoque ajustado.', 'success');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  /** Inventário/balanço: contagem física de todo o catálogo de uma vez.
   * Pra cada produto onde a contagem digitada difere da quantidade atual do
   * sistema, gera um ajuste (tipo 'ajuste') com a diferença — mesmo
   * mecanismo do ajuste individual, só que em lote. Produto sem diferença
   * não gera movimento nenhum (evita poluir o histórico à toa). */
  async function openInventoryModal() {
    const products = (await listProducts()).filter((p) => p.active);
    openModal({
      title: 'Inventário / balanço de estoque',
      submitLabel: 'Aplicar ajustes',
      wide: true,
      bodyHtml: `
        <div id="modal-error"></div>
        <p class="text-muted" style="font-size:13px;">
          Conte fisicamente cada produto e digite o valor encontrado. Só os produtos com contagem
          diferente do sistema geram um ajuste — o resto fica como está.
        </p>
        <div class="table-wrap" style="max-height:420px;overflow-y:auto;">
          <table>
            <thead><tr><th>Produto</th><th>No sistema</th><th>Contagem física</th></tr></thead>
            <tbody>
              ${products.map((p) => `
                <tr>
                  <td>${escapeHtml(p.name)}</td>
                  <td>${p.quantity} ${escapeHtml(p.unit)}</td>
                  <td><input type="number" min="0" step="1" value="${p.quantity}" data-count="${p.id}" style="width:90px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;"></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Observação</label>
          <input id="f-note" placeholder="Ex: balanço mensal de agosto">
        </div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const note = modalEl.querySelector('#f-note').value.trim() || 'Inventário/balanço';
        const diffs = products
          .map((p) => ({ product: p, counted: Number(modalEl.querySelector(`[data-count="${p.id}"]`).value) }))
          .filter(({ product, counted }) => Number.isFinite(counted) && counted !== product.quantity);

        if (diffs.length === 0) {
          showToast('Nenhuma diferença encontrada — estoque já bate com o sistema.', 'success');
          return true;
        }

        try {
          for (const { product, counted } of diffs) {
            const delta = counted - product.quantity;
            await recordMovement({
              productId: product.id, type: 'ajuste', qty: delta,
              userId: ctx.user.id, userName: ctx.user.nome,
              note: `${note} (${delta > 0 ? '+' : ''}${delta})`,
            });
          }
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Inventário/balanço de estoque',
            details: `${diffs.length} produto(s) ajustado(s) por contagem física. ${note}.`,
            entity: 'inventory', entityId: '',
          });
          showToast(`Inventário aplicado: ${diffs.length} produto(s) ajustado(s).`, 'success');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  refresh();
}

function renderTable(products, isAdmin) {
  if (products.length === 0) return '<div class="table-wrap"><div class="table-empty">Nenhum produto encontrado.</div></div>';
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="min-width:200px;">Produto</th><th>Categoria</th><th>Código</th><th>Preço</th><th>Estoque</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${products.map((p) => `
            <tr class="${p.active && p.quantity <= p.minStock ? 'low-stock-row' : ''}">
              <td>${escapeHtml(p.name)}</td>
              <td>${p.category === 'material' ? 'Material' : 'Mercearia'}</td>
              <td>${escapeHtml(p.barcode)}${p.barcodeIsInternal ? ' <span class="badge badge-gray">interno</span>' : ''}</td>
              <td>${formatMoney(p.price)}</td>
              <td>${p.quantity} ${escapeHtml(p.unit)}</td>
              <td>${statusBadge(p)}</td>
              <td style="white-space:nowrap;">
                <button class="btn btn-ghost btn-sm" data-history="${p.id}">Histórico</button>
                ${isAdmin ? `
                <button class="btn btn-ghost btn-sm" data-edit="${p.id}">Editar</button>
                <button class="btn btn-ghost btn-sm" data-adjust="${p.id}">Ajustar</button>
                <button class="btn btn-ghost btn-sm" data-toggle="${p.id}">${p.active ? 'Inativar' : 'Reativar'}</button>
                <button class="btn btn-ghost btn-sm" data-delete="${p.id}" style="color:var(--danger);">Excluir</button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function statusBadge(p) {
  if (!p.active) return '<span class="badge badge-gray">Inativo</span>';
  if (p.quantity <= p.minStock) return '<span class="badge badge-red">Estoque baixo</span>';
  return '<span class="badge badge-green">Disponível</span>';
}
