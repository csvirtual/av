// PDV — Nova Venda. Pensada pro leitor de código de barras USB: o campo de
// busca fica sempre focado, o leitor "digita" o código e aperta Enter
// sozinho (ver utils/barcode.js). Também dá pra buscar por nome, pra
// produtos sem leitor à mão ou código ainda não cadastrado.
//
// Além do carrinho básico, esta tela cobre: desconto por item e geral (com
// teto para vendedores — acima disso precisa da senha de um admin),
// pagamento misto (mais de uma forma na mesma venda) e uso de crédito de
// troca gerado por um estorno anterior (ver session.js).
import { getByBarcode, searchProducts } from '../data/productsRepo.js';
import { createSale } from '../data/salesRepo.js';
import { logAction } from '../data/auditRepo.js';
import { getCompany } from '../data/companyRepo.js';
import { verifyLogin } from '../data/usersRepo.js';
import { getPendingCredit, setPendingCredit, clearPendingCredit } from '../session.js';
import { bindBarcodeInput } from '../utils/barcode.js';
import { formatMoney, escapeHtml } from '../utils/format.js';
import { applyDiscount, computeCartTotals } from '../utils/pricing.js';
import { showToast } from '../components/toast.js';
import { openModal } from '../components/modal.js';

const PAYMENT_METHODS = ['Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Pix'];
const CREDIT_METHOD = 'Crédito de troca';

export async function renderSale(container, ctx) {
  let cart = []; // [{ productId, name, barcode, unit, price, qtyAvailable, qty, discountType, discountValue }]
  let overallDiscountType = null;
  let overallDiscountValue = 0;
  let payments = []; // [{ method, amount }]
  let pendingCredit = await getPendingCredit();

  const company = await getCompany();
  const vendorMaxDiscountPercent = company?.policies?.vendorMaxDiscountPercent ?? 10;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Nova venda</h1>
        <div class="desc">Escaneie o produto ou busque pelo nome.</div>
      </div>
    </div>
    <div class="pdv-layout">
      <div class="card">
        <div class="scan-box">
          <input type="text" id="scan-input" placeholder="Escaneie o código de barras ou digite o nome do produto…" autofocus>
        </div>
        <div id="search-results"></div>
        <div id="credit-banner"></div>
      </div>
      <div class="card">
        <p class="section-title mt-0">Carrinho</p>
        <div id="cart-box"></div>

        <div id="totals-box"></div>

        <p class="section-title" style="margin-top:16px;">Pagamento</p>
        <div id="payments-box"></div>
        <button class="btn btn-secondary btn-sm" id="add-payment-btn" type="button" style="margin-top:6px;">+ Forma de pagamento</button>

        <button class="btn" id="finalize-btn" style="width:100%;padding:12px;margin-top:16px;" disabled>Finalizar venda</button>
      </div>
    </div>
  `;

  const scanInput = document.getElementById('scan-input');
  const resultsBox = document.getElementById('search-results');
  const creditBanner = document.getElementById('credit-banner');
  const cartBox = document.getElementById('cart-box');
  const totalsBox = document.getElementById('totals-box');
  const paymentsBox = document.getElementById('payments-box');
  const finalizeBtn = document.getElementById('finalize-btn');

  function currentTotals() {
    return computeCartTotals(cart, overallDiscountType, overallDiscountValue);
  }

  function paymentsSum() {
    return payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  }

  function renderCreditBanner() {
    if (!pendingCredit || pendingCredit.amount <= 0) {
      creditBanner.innerHTML = '';
      return;
    }
    creditBanner.innerHTML = `
      <div class="card" style="margin-top:12px;background:var(--primary-light);border-color:var(--primary);">
        <strong>Crédito de troca disponível: ${formatMoney(pendingCredit.amount)}</strong>
        <p class="text-muted" style="font-size:12.5px;margin:4px 0 10px;">${escapeHtml(pendingCredit.reason || 'Gerado por estorno')}</p>
        <button class="btn btn-sm" id="use-credit-btn" type="button">Usar nesta venda</button>
        <button class="btn btn-ghost btn-sm" id="discard-credit-btn" type="button">Descartar</button>
      </div>
    `;
    document.getElementById('use-credit-btn').addEventListener('click', async () => {
      const { total } = currentTotals();
      const remaining = Math.max(0, total - paymentsSum());
      if (remaining <= 0) {
        showToast('Adicione itens ao carrinho antes de aplicar o crédito.', 'error');
        return;
      }
      const applied = Math.min(pendingCredit.amount, remaining);
      payments.push({ method: CREDIT_METHOD, amount: applied });
      const leftover = pendingCredit.amount - applied;
      if (leftover > 0.01) {
        pendingCredit = { ...pendingCredit, amount: leftover };
        await setPendingCredit(pendingCredit);
      } else {
        pendingCredit = null;
        await clearPendingCredit();
      }
      renderCreditBanner();
      renderPayments();
    });
    document.getElementById('discard-credit-btn').addEventListener('click', async () => {
      pendingCredit = null;
      await clearPendingCredit();
      renderCreditBanner();
    });
  }

  function renderCart() {
    if (cart.length === 0) {
      cartBox.innerHTML = '<div class="empty-cart">Carrinho vazio. Escaneie um produto para começar.</div>';
    } else {
      cartBox.innerHTML = cart.map((item, idx) => {
        const gross = item.unitPrice * item.qty;
        const net = applyDiscount(gross, item.discountType, item.discountValue);
        const hasDiscount = net < gross - 0.001;
        return `
        <div class="cart-item">
          <div style="flex:1;min-width:0;">
            <div class="name">${escapeHtml(item.name)}</div>
            <div class="meta">${formatMoney(item.unitPrice)} / ${escapeHtml(item.unit)} · código ${escapeHtml(item.barcode)}</div>
          </div>
          <input type="number" class="qty-input" min="1" max="${item.qtyAvailable}" value="${item.qty}" data-idx="${idx}">
          <button class="btn btn-ghost btn-sm" data-discount="${idx}" title="Desconto no item">${hasDiscount ? '% editar' : '% desconto'}</button>
          <div style="width:96px;text-align:right;">
            ${hasDiscount ? `<div class="text-muted" style="font-size:11.5px;text-decoration:line-through;">${formatMoney(gross)}</div>` : ''}
            <div style="font-weight:600;">${formatMoney(net)}</div>
          </div>
          <button class="btn btn-ghost btn-sm" data-remove="${idx}" title="Remover">✕</button>
        </div>
      `;
      }).join('');

      cartBox.querySelectorAll('.qty-input').forEach((input) => {
        input.addEventListener('change', () => {
          const idx = Number(input.dataset.idx);
          let qty = Math.floor(Number(input.value));
          if (!qty || qty < 1) qty = 1;
          if (qty > cart[idx].qtyAvailable) {
            qty = cart[idx].qtyAvailable;
            showToast(`Estoque disponível de "${cart[idx].name}": ${cart[idx].qtyAvailable}.`, 'error');
          }
          cart[idx].qty = qty;
          renderAll();
        });
      });
      cartBox.querySelectorAll('[data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          cart.splice(Number(btn.dataset.remove), 1);
          renderAll();
        });
      });
      cartBox.querySelectorAll('[data-discount]').forEach((btn) => {
        btn.addEventListener('click', () => openItemDiscountModal(Number(btn.dataset.discount)));
      });
    }
  }

  function openItemDiscountModal(idx) {
    const item = cart[idx];
    openModal({
      title: `Desconto — ${escapeHtml(item.name)}`,
      submitLabel: 'Aplicar',
      bodyHtml: `
        <div class="field">
          <label>Tipo</label>
          <select id="f-disc-type">
            <option value="">Sem desconto</option>
            <option value="percent" ${item.discountType === 'percent' ? 'selected' : ''}>Percentual (%)</option>
            <option value="fixed" ${item.discountType === 'fixed' ? 'selected' : ''}>Valor fixo (R$)</option>
          </select>
        </div>
        <div class="field">
          <label>Valor</label>
          <input id="f-disc-value" type="number" min="0" step="0.01" value="${item.discountValue || 0}">
        </div>
      `,
      onSubmit: (modalEl) => {
        const type = modalEl.querySelector('#f-disc-type').value || null;
        const value = Number(modalEl.querySelector('#f-disc-value').value) || 0;
        item.discountType = type;
        item.discountValue = type ? value : 0;
        renderAll();
        return true;
      },
    });
  }

  function renderTotals() {
    const { subtotal, itemsDiscountTotal, overallDiscountAmount, total } = currentTotals();
    totalsBox.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);margin-top:10px;">
        <span>Subtotal</span><span>${formatMoney(subtotal)}</span>
      </div>
      ${itemsDiscountTotal > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--danger);"><span>Desconto nos itens</span><span>−${formatMoney(itemsDiscountTotal)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;">
        <span style="font-size:13px;color:var(--text-muted);">Desconto geral</span>
        <div style="display:flex;gap:6px;">
          <select id="overall-disc-type" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;">
            <option value="">Nenhum</option>
            <option value="percent" ${overallDiscountType === 'percent' ? 'selected' : ''}>%</option>
            <option value="fixed" ${overallDiscountType === 'fixed' ? 'selected' : ''}>R$</option>
          </select>
          <input id="overall-disc-value" type="number" min="0" step="0.01" value="${overallDiscountValue || ''}" placeholder="0" style="width:80px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;">
        </div>
      </div>
      <div class="cart-total"><span>Total</span><span class="value">${formatMoney(total)}</span></div>
    `;
    document.getElementById('overall-disc-type').addEventListener('change', (e) => {
      overallDiscountType = e.target.value || null;
      if (!overallDiscountType) overallDiscountValue = 0;
      renderAll();
    });
    document.getElementById('overall-disc-value').addEventListener('change', (e) => {
      overallDiscountValue = Number(e.target.value) || 0;
      renderAll();
    });
  }

  const PAYMENT_TOLERANCE_UI = 0.01;

  function renderPayments() {
    const { total } = currentTotals();
    const sum = paymentsSum();
    const remaining = total - sum;

    paymentsBox.innerHTML = payments.length === 0
      ? '<div class="text-muted" style="font-size:13px;">Nenhuma forma de pagamento adicionada.</div>'
      : payments.map((p, idx) => {
        // O crédito de troca só aparece como opção na própria linha que já
        // é crédito (não faz sentido oferecer "virar" outro pagamento em
        // crédito) — pra trocar de forma, remove a linha e usa o banner.
        const options = p.method === CREDIT_METHOD ? [CREDIT_METHOD, ...PAYMENT_METHODS] : PAYMENT_METHODS;
        return `
        <div class="cart-item">
          <select data-pay-method="${idx}" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;" ${p.method === CREDIT_METHOD ? 'disabled' : ''}>
            ${options.map((m) => `<option value="${escapeHtml(m)}" ${p.method === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
          </select>
          <input type="number" class="qty-input" style="width:100px;" min="0" step="0.01" value="${p.amount.toFixed(2)}" data-pay-idx="${idx}">
          <button class="btn btn-ghost btn-sm" data-pay-remove="${idx}">✕</button>
        </div>
      `;
      }).join('');

    paymentsBox.querySelectorAll('[data-pay-method]').forEach((select) => {
      select.addEventListener('change', () => {
        payments[Number(select.dataset.payMethod)].method = select.value;
      });
    });
    paymentsBox.querySelectorAll('[data-pay-idx]').forEach((input) => {
      input.addEventListener('change', () => {
        const idx = Number(input.dataset.payIdx);
        payments[idx].amount = Math.max(0, Number(input.value) || 0);
        renderAll();
      });
    });
    paymentsBox.querySelectorAll('[data-pay-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.payRemove);
        if (payments[idx].method === CREDIT_METHOD) {
          // Devolve o crédito removido de volta pro saldo pendente, em vez
          // de simplesmente descartar o valor.
          const refund = payments[idx].amount;
          const current = await getPendingCredit();
          pendingCredit = { ...(current || { reason: 'Gerado por estorno' }), amount: (current?.amount || 0) + refund };
          await setPendingCredit(pendingCredit);
          renderCreditBanner();
        }
        payments.splice(idx, 1);
        renderAll();
      });
    });

    const label = remaining > 0.01
      ? `<span style="color:var(--danger);">Falta ${formatMoney(remaining)}</span>`
      : remaining < -0.01
        ? `<span style="color:var(--danger);">Excedeu em ${formatMoney(-remaining)}</span>`
        : `<span style="color:var(--success);">Pagamento completo ✓</span>`;
    paymentsBox.insertAdjacentHTML('beforeend', `<div style="font-size:13px;font-weight:600;margin-top:8px;text-align:right;">${label}</div>`);

    finalizeBtn.disabled = cart.length === 0 || Math.abs(remaining) > PAYMENT_TOLERANCE_UI;
  }

  function renderAll() {
    renderCart();
    renderTotals();
    renderPayments();
  }

  document.getElementById('add-payment-btn').addEventListener('click', () => {
    const { total } = currentTotals();
    const remaining = Math.max(0, total - paymentsSum());
    payments.push({ method: PAYMENT_METHODS[0], amount: Number(remaining.toFixed(2)) });
    renderPayments();
  });

  function addProductToCart(product) {
    if (product.quantity <= 0) {
      showToast(`"${product.name}" está sem estoque disponível.`, 'error');
      return;
    }
    const existing = cart.find((i) => i.productId === product.id);
    if (existing) {
      if (existing.qty >= product.quantity) {
        showToast(`Estoque disponível de "${product.name}": ${product.quantity}.`, 'error');
        return;
      }
      existing.qty += 1;
    } else {
      cart.push({
        productId: product.id, name: product.name, barcode: product.barcode,
        unit: product.unit, unitPrice: product.price, qtyAvailable: product.quantity, qty: 1,
        discountType: null, discountValue: 0,
      });
    }
    renderAll();
    resultsBox.innerHTML = '';
    clearTimeout(searchDebounce);
    scanInput.value = '';
    scanInput.focus();
  }

  async function handleScan(value) {
    clearTimeout(searchDebounce);
    const product = await getByBarcode(value);
    if (product) {
      if (!product.active) {
        showToast(`"${product.name}" está inativo e não pode ser vendido.`, 'error');
        return;
      }
      addProductToCart(product);
      return;
    }
    const matches = await searchProducts(value);
    const activeMatches = matches.filter((p) => p.active);
    if (activeMatches.length === 0) {
      showToast('Produto não encontrado no estoque.', 'error');
      return;
    }
    if (activeMatches.length === 1) {
      addProductToCart(activeMatches[0]);
      return;
    }
    renderPickList(activeMatches);
  }

  function renderPickList(matches) {
    resultsBox.innerHTML = `
      <div class="table-wrap" style="margin-top:10px;">
        <table>
          <tbody>
            ${matches.slice(0, 8).map((p) => `
              <tr>
                <td>${escapeHtml(p.name)}</td>
                <td>${formatMoney(p.price)}</td>
                <td>${p.quantity} ${escapeHtml(p.unit)}</td>
                <td><button class="btn btn-sm" data-pick="${p.id}">Adicionar</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    resultsBox.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => addProductToCart(matches.find((p) => p.id === btn.dataset.pick)));
    });
  }

  bindBarcodeInput(scanInput, handleScan);

  let searchDebounce;
  scanInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const term = scanInput.value.trim();
    if (term.length < 2) { resultsBox.innerHTML = ''; return; }
    searchDebounce = setTimeout(async () => {
      const matches = (await searchProducts(term)).filter((p) => p.active).slice(0, 8);
      if (matches.length === 0) { resultsBox.innerHTML = ''; return; }
      renderPickList(matches);
    }, 220);
  });

  function openAdminApprovalModal() {
    return new Promise((resolve) => {
      openModal({
        title: 'Autorização necessária',
        submitLabel: 'Autorizar',
        bodyHtml: `
          <p style="font-size:13px;color:var(--text-muted);">
            Esse desconto passa do limite de ${vendorMaxDiscountPercent}% que vendedores podem aplicar sozinhos.
            Peça pra um administrador digitar a senha dele pra autorizar.
          </p>
          <div id="modal-error"></div>
          <div class="field"><label>Usuário do administrador</label><input id="f-admin-user"></div>
          <div class="field"><label>Senha</label><input id="f-admin-pass" type="password"></div>
        `,
        onSubmit: async (modalEl) => {
          const errBox = modalEl.querySelector('#modal-error');
          const username = modalEl.querySelector('#f-admin-user').value.trim();
          const password = modalEl.querySelector('#f-admin-pass').value;
          const admin = await verifyLogin(username, password);
          if (!admin || admin.role !== 'admin') {
            errBox.innerHTML = '<div class="form-error">Usuário/senha inválidos ou não é um administrador.</div>';
            return false;
          }
          resolve(admin);
          return true;
        },
        onCancel: () => resolve(null),
      });
    });
  }

  finalizeBtn.addEventListener('click', async () => {
    if (cart.length === 0) return;
    const totals = currentTotals();
    let discountApprovedBy = null;

    if (ctx.user.role !== 'admin' && totals.totalDiscountPercent > vendorMaxDiscountPercent + 0.001) {
      const admin = await openAdminApprovalModal();
      if (!admin) return; // cancelado
      discountApprovedBy = admin.id;
    }

    finalizeBtn.disabled = true;
    try {
      const sale = await createSale({
        userId: ctx.user.id,
        userName: ctx.user.nome,
        items: cart.map((i) => ({ productId: i.productId, qty: i.qty, discountType: i.discountType, discountValue: i.discountValue })),
        overallDiscountType, overallDiscountValue,
        payments,
        discountApprovedBy,
      });
      await logAction({
        userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
        action: 'Venda registrada',
        details: `Venda de ${sale.items.length} item(ns) totalizando ${formatMoney(sale.total)}`
          + (sale.itemsDiscountTotal + sale.overallDiscountAmount > 0 ? ` (desconto de ${formatMoney(sale.itemsDiscountTotal + sale.overallDiscountAmount)})` : '')
          + (discountApprovedBy ? ' — desconto autorizado por administrador' : '') + '.',
        entity: 'sale', entityId: sale.id,
      });
      showToast(`Venda finalizada: ${formatMoney(sale.total)}.`, 'success');
      cart = [];
      overallDiscountType = null;
      overallDiscountValue = 0;
      payments = [];
      renderAll();
      resultsBox.innerHTML = '';
      scanInput.value = '';
      scanInput.focus();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      finalizeBtn.disabled = cart.length === 0;
    }
  });

  renderCreditBanner();
  renderAll();
}
