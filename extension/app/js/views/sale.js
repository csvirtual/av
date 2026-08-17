// PDV — Nova Venda. Pensada pro leitor de código de barras USB: o campo de
// busca fica sempre focado, o leitor "digita" o código e aperta Enter
// sozinho (ver utils/barcode.js). Também dá pra buscar por nome, pra
// produtos sem leitor à mão ou código ainda não cadastrado.
import { getByBarcode, searchProducts } from '../data/productsRepo.js';
import { createSale } from '../data/salesRepo.js';
import { logAction } from '../data/auditRepo.js';
import { bindBarcodeInput } from '../utils/barcode.js';
import { formatMoney, escapeHtml } from '../utils/format.js';
import { showToast } from '../components/toast.js';

export function renderSale(container, ctx) {
  let cart = []; // [{ productId, name, barcode, unit, price, qtyAvailable, qty }]

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
      </div>
      <div class="card">
        <p class="section-title mt-0">Carrinho</p>
        <div id="cart-box"></div>
        <div class="cart-total">
          <span>Total</span>
          <span class="value" id="cart-total-value">${formatMoney(0)}</span>
        </div>
        <div class="field" style="margin-top:14px;">
          <label>Forma de pagamento</label>
          <select id="payment-method">
            <option value="Dinheiro">Dinheiro</option>
            <option value="Cartão de débito">Cartão de débito</option>
            <option value="Cartão de crédito">Cartão de crédito</option>
            <option value="Pix">Pix</option>
          </select>
        </div>
        <button class="btn" id="finalize-btn" style="width:100%;padding:12px;margin-top:10px;" disabled>Finalizar venda</button>
      </div>
    </div>
  `;

  const scanInput = document.getElementById('scan-input');
  const resultsBox = document.getElementById('search-results');
  const cartBox = document.getElementById('cart-box');
  const totalEl = document.getElementById('cart-total-value');
  const finalizeBtn = document.getElementById('finalize-btn');

  function renderCart() {
    if (cart.length === 0) {
      cartBox.innerHTML = '<div class="empty-cart">Carrinho vazio. Escaneie um produto para começar.</div>';
    } else {
      cartBox.innerHTML = cart.map((item, idx) => `
        <div class="cart-item">
          <div style="flex:1;min-width:0;">
            <div class="name">${escapeHtml(item.name)}</div>
            <div class="meta">${formatMoney(item.price)} / ${escapeHtml(item.unit)} · código ${escapeHtml(item.barcode)}</div>
          </div>
          <input type="number" class="qty-input" min="1" max="${item.qtyAvailable}" value="${item.qty}" data-idx="${idx}">
          <div style="width:80px;text-align:right;font-weight:600;">${formatMoney(item.price * item.qty)}</div>
          <button class="btn btn-ghost btn-sm" data-remove="${idx}" title="Remover">✕</button>
        </div>
      `).join('');

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
          renderCart();
        });
      });
      cartBox.querySelectorAll('[data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          cart.splice(Number(btn.dataset.remove), 1);
          renderCart();
        });
      });
    }

    const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    totalEl.textContent = formatMoney(total);
    finalizeBtn.disabled = cart.length === 0;
  }

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
        unit: product.unit, price: product.price, qtyAvailable: product.quantity, qty: 1,
      });
    }
    renderCart();
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
    // Não achou por código exato — tenta busca por nome/código parcial.
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
    resultsBox.innerHTML = `
      <div class="table-wrap" style="margin-top:10px;">
        <table>
          <tbody>
            ${activeMatches.slice(0, 8).map((p) => `
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
      btn.addEventListener('click', () => {
        addProductToCart(activeMatches.find((p) => p.id === btn.dataset.pick));
      });
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
      resultsBox.innerHTML = `
        <div class="table-wrap" style="margin-top:10px;">
          <table>
            <tbody>
              ${matches.map((p) => `
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
    }, 220);
  });

  finalizeBtn.addEventListener('click', async () => {
    if (cart.length === 0) return;
    finalizeBtn.disabled = true;
    try {
      const sale = await createSale({
        userId: ctx.user.id,
        userName: ctx.user.nome,
        items: cart.map((i) => ({ productId: i.productId, qty: i.qty })),
        paymentMethod: document.getElementById('payment-method').value,
      });
      await logAction({
        userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
        action: 'Venda registrada',
        details: `Venda de ${sale.items.length} item(ns) totalizando ${formatMoney(sale.total)}.`,
        entity: 'sale', entityId: sale.id,
      });
      showToast(`Venda finalizada: ${formatMoney(sale.total)}.`, 'success');
      cart = [];
      renderCart();
      resultsBox.innerHTML = '';
      scanInput.value = '';
      scanInput.focus();
    } catch (err) {
      showToast(err.message, 'error');
      finalizeBtn.disabled = false;
    }
  });

  renderCart();
}
