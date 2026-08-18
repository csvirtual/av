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
import { createDelivery } from '../data/deliveriesRepo.js';
import { logAction } from '../data/auditRepo.js';
import { getCompany } from '../data/companyRepo.js';
import { verifyLogin } from '../data/usersRepo.js';
import { getOpenSession } from '../data/cashRepo.js';
import { searchCustomers, createCustomer, getCustomerBalance } from '../data/customersRepo.js';
import { getPendingCredit, setPendingCredit, clearPendingCredit } from '../session.js';
import { bindBarcodeInput, installGlobalScannerListener } from '../utils/barcode.js';
import { formatMoney, escapeHtml } from '../utils/format.js';
import { applyDiscount, computeCartTotals } from '../utils/pricing.js';
import { showToast } from '../components/toast.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { printSaleReceipt } from '../components/receipt.js';

const PAYMENT_METHODS = ['Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Pix', 'Fiado'];
const CREDIT_METHOD = 'Crédito de troca';
const FIADO_METHOD = 'Fiado';
const CREDIT_CARD_METHOD = 'Cartão de crédito';
const MAX_INSTALLMENTS = 12; // padrão comum de "parcelamento sem juros" no varejo brasileiro

// Guarda a função de desligar o "reforço" global de leitura entre uma
// renderização da tela e outra — sem isso, cada visita à Nova Venda
// empilharia mais um listener em document (o router não tem um hook de
// "desmontar tela"), e um scan acabaria disparando handleScan() várias
// vezes ao mesmo tempo.
let stopGlobalScanner = null;

export async function renderSale(container, ctx) {
  stopGlobalScanner?.();
  stopGlobalScanner = null;

  let cart = []; // [{ productId, name, barcode, unit, unitPrice, qtyAvailable, qty, discountType, discountValue }]
  let overallDiscountType = null;
  let overallDiscountValue = 0;
  let payments = []; // [{ method, amount }]
  let pendingCredit = await getPendingCredit();
  let selectedCustomer = null;

  const company = await getCompany();
  const vendorMaxDiscountPercent = company?.policies?.vendorMaxDiscountPercent ?? 10;
  const requireOpenCashSession = company?.policies?.requireOpenCashSession ?? false;
  const cashSession = await getOpenSession();

  if (requireOpenCashSession && !cashSession) {
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Nova venda</h1>
          <div class="desc">É preciso abrir o caixa antes de vender.</div>
        </div>
      </div>
      <div class="card" style="max-width:480px;text-align:center;padding:40px 32px;">
        <p style="font-size:15px;margin-bottom:18px;">
          A loja exige caixa aberto para registrar vendas (configurado em Dados da loja → Políticas de venda).
        </p>
        <button class="btn" id="go-caixa">Abrir caixa</button>
      </div>
    `;
    container.querySelector('#go-caixa').addEventListener('click', () => ctx.navigate('caixa'));
    return;
  }

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

        <p class="section-title" style="margin-top:16px;">
          Cliente <span class="text-muted" style="font-weight:400;">(opcional — obrigatório pra vender fiado)</span>
        </p>
        <div id="customer-box"></div>
      </div>
      <div class="card">
        <p class="section-title mt-0">Carrinho</p>
        <div id="cart-box"></div>

        <div id="totals-box"></div>

        <p class="section-title" style="margin-top:16px;">Pagamento</p>
        <div id="payments-box"></div>
        <button class="btn btn-secondary btn-sm" id="add-payment-btn" type="button" style="margin-top:6px;">+ Forma de pagamento</button>

        <button class="btn" id="finalize-btn" style="width:100%;padding:12px;margin-top:16px;" disabled>Finalizar venda</button>
        <button class="btn btn-secondary" id="finalize-carreto-btn" style="width:100%;padding:12px;margin-top:8px;" disabled title="Registra a venda e já cadastra um carreto com os itens que você marcar">Finalizar venda + carreto</button>
      </div>
    </div>
  `;

  const scanInput = document.getElementById('scan-input');
  const resultsBox = document.getElementById('search-results');
  const creditBanner = document.getElementById('credit-banner');
  const customerBox = document.getElementById('customer-box');
  const cartBox = document.getElementById('cart-box');
  const totalsBox = document.getElementById('totals-box');
  const paymentsBox = document.getElementById('payments-box');
  const finalizeBtn = document.getElementById('finalize-btn');
  const finalizeCarretoBtn = document.getElementById('finalize-carreto-btn');

  function currentTotals() {
    return computeCartTotals(cart, overallDiscountType, overallDiscountValue);
  }

  async function renderCustomerBox() {
    if (!selectedCustomer) {
      customerBox.innerHTML = `
        <input type="text" id="customer-search" class="customer-search-input" placeholder="Buscar cliente por nome ou telefone…">
        <div id="customer-results"></div>
      `;
      const searchInput = document.getElementById('customer-search');
      const resultsDiv = document.getElementById('customer-results');
      let debounce;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        const term = searchInput.value.trim();
        if (term.length < 2) { resultsDiv.innerHTML = ''; return; }
        debounce = setTimeout(async () => {
          const matches = await searchCustomers(term);
          resultsDiv.innerHTML = `
            <div class="table-wrap" style="margin-top:8px;">
              <table><tbody>
                ${matches.slice(0, 6).map((c) => `
                  <tr>
                    <td>${escapeHtml(c.nome)}</td>
                    <td class="text-muted">${escapeHtml(c.telefone || '—')}</td>
                    <td><button class="btn btn-sm" data-pick-customer="${c.id}">Selecionar</button></td>
                  </tr>
                `).join('')}
                <tr>
                  <td colspan="3">
                    <button class="btn btn-ghost btn-sm" id="quick-new-customer">+ Cadastrar "${escapeHtml(term)}" como novo cliente</button>
                  </td>
                </tr>
              </tbody></table>
            </div>
          `;
          resultsDiv.querySelectorAll('[data-pick-customer]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              selectedCustomer = matches.find((c) => c.id === btn.dataset.pickCustomer);
              await renderCustomerBox();
            });
          });
          document.getElementById('quick-new-customer').addEventListener('click', async () => {
            selectedCustomer = await createCustomer({ nome: term });
            await renderCustomerBox();
          });
        }, 220);
      });
    } else {
      const balance = await getCustomerBalance(selectedCustomer.id);
      customerBox.innerHTML = `
        <div class="cart-item" style="padding:8px 0;">
          <div style="flex:1;">
            <div class="name">${escapeHtml(selectedCustomer.nome)}</div>
            <div class="meta">${escapeHtml(selectedCustomer.telefone || 'sem telefone')}${balance > 0.01 ? ` · deve ${formatMoney(balance)}` : ''}</div>
          </div>
          <button class="btn btn-ghost btn-sm" id="clear-customer-btn" type="button">Trocar</button>
        </div>
      `;
      document.getElementById('clear-customer-btn').addEventListener('click', async () => {
        selectedCustomer = null;
        await renderCustomerBox();
      });
    }
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
        // Estoque que sobra do produto depois desta venda — não o total
        // absoluto, que já não muda mais depois de escaneado. É essa conta
        // (o que ainda vai restar) que importa pro vendedor decidir se dá
        // pra vender mais um pouco pro próximo cliente.
        const remaining = item.qtyAvailable - item.qty;
        const stockClass = remaining <= 0 ? 'danger' : remaining <= 2 ? 'warn' : '';
        return `
        <div class="cart-line">
          <div class="cart-line-info">
            <div class="name">${escapeHtml(item.name)}</div>
            <div class="cart-line-details">
              <span>${formatMoney(item.unitPrice)} / ${escapeHtml(item.unit)}</span>
              <span class="sep">·</span>
              <span>Cód. <span class="code-value">${escapeHtml(item.barcode)}</span></span>
            </div>
            <div class="cart-line-stock ${stockClass}">
              <span class="dot"></span>Estoque restante: ${remaining} ${escapeHtml(item.unit)}
            </div>
          </div>
          <div class="cart-line-controls">
            <div class="cart-line-controls-left">
              <div class="cart-line-qty">
                <label for="cart-qty-${idx}">Qtd.</label>
                <input id="cart-qty-${idx}" type="number" class="qty-input" min="1" max="${item.qtyAvailable}" value="${item.qty}" data-idx="${idx}">
              </div>
              <button class="btn btn-ghost btn-sm" data-discount="${idx}" title="Desconto no item">${hasDiscount ? '% editar' : '% desconto'}</button>
            </div>
            <div class="cart-line-controls-right">
              <div class="cart-line-price">
                ${hasDiscount ? `<div class="gross">${formatMoney(gross)}</div>` : ''}
                <div class="net">${formatMoney(net)}</div>
              </div>
              <button class="btn btn-ghost btn-sm" data-remove="${idx}" title="Remover">✕</button>
            </div>
          </div>
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
        const isCreditCard = p.method === CREDIT_CARD_METHOD;
        return `
        <div class="payment-row">
          <select data-pay-method="${idx}" class="payment-method-select" ${p.method === CREDIT_METHOD ? 'disabled' : ''}>
            ${options.map((m) => `<option value="${escapeHtml(m)}" ${p.method === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
          </select>
          ${isCreditCard ? `
            <select data-pay-installments="${idx}" class="payment-installments-select" title="Número de parcelas">
              ${Array.from({ length: MAX_INSTALLMENTS }, (_, i) => i + 1).map((n) => `<option value="${n}" ${(p.installments || 1) === n ? 'selected' : ''}>${n}x</option>`).join('')}
            </select>
          ` : ''}
          <input type="number" class="payment-amount-input" min="0" step="0.01" value="${p.amount.toFixed(2)}" data-pay-idx="${idx}">
          <button class="btn btn-ghost btn-sm" data-pay-remove="${idx}">✕</button>
        </div>
      `;
      }).join('');

    paymentsBox.querySelectorAll('[data-pay-method]').forEach((select) => {
      select.addEventListener('change', () => {
        const idx = Number(select.dataset.payMethod);
        payments[idx].method = select.value;
        if (select.value === CREDIT_CARD_METHOD && !payments[idx].installments) payments[idx].installments = 1;
        renderPayments();
      });
    });
    paymentsBox.querySelectorAll('[data-pay-installments]').forEach((select) => {
      select.addEventListener('change', () => {
        payments[Number(select.dataset.payInstallments)].installments = Number(select.value);
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

    const disableFinalize = cart.length === 0 || Math.abs(remaining) > PAYMENT_TOLERANCE_UI;
    finalizeBtn.disabled = disableFinalize;
    finalizeCarretoBtn.disabled = disableFinalize;
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
  // Reforço: se o foco escapar do campo de busca por qualquer motivo (o
  // vendedor clicou em outro lugar da tela, por exemplo), um scan ainda é
  // capturado em qualquer ponto da página — sem isso, o leitor "digitava"
  // o código em silêncio pra um campo que não estava mais ouvindo.
  stopGlobalScanner = installGlobalScannerListener(handleScan);

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
          // Confere aqui só pra dar um retorno rápido na hora (evita
          // mandar pro createSale e só descobrir que errou depois de
          // fechar o modal) — quem decide de verdade se autoriza é o
          // createSale, que confere usuário/senha de novo por conta
          // própria antes de gravar a venda.
          const admin = await verifyLogin(username, password);
          if (!admin || admin.role !== 'admin') {
            errBox.innerHTML = '<div class="form-error">Usuário/senha inválidos ou não é um administrador.</div>';
            return false;
          }
          resolve({ username, password });
          return true;
        },
        onCancel: () => resolve(null),
      });
    });
  }

  // Checagens que valem pros dois botões de finalizar (com ou sem carreto):
  // aprovação de desconto acima do limite do vendedor, e confirmação de
  // limite de crédito se houver fiado. Devolve null se o vendedor cancelou
  // em algum ponto (nesse caso quem chamou só encerra sem fazer nada).
  async function runPreFinalizeChecks() {
    const totals = currentTotals();
    let discountApproval = null;

    if (ctx.user.role !== 'admin' && totals.totalDiscountPercent > vendorMaxDiscountPercent + 0.001) {
      discountApproval = await openAdminApprovalModal();
      if (!discountApproval) return null; // cancelado
    }

    const fiadoAmount = payments.filter((p) => p.method === FIADO_METHOD).reduce((sum, p) => sum + p.amount, 0);
    if (fiadoAmount > 0) {
      if (!selectedCustomer) {
        showToast('Selecione um cliente para vender fiado.', 'error');
        return null;
      }
      if (selectedCustomer.creditLimit > 0) {
        const currentBalance = await getCustomerBalance(selectedCustomer.id);
        const newBalance = currentBalance + fiadoAmount;
        if (newBalance > selectedCustomer.creditLimit) {
          const ok = await confirmDialog({
            title: 'Limite de crédito ultrapassado',
            message: `Com essa venda, "${escapeHtml(selectedCustomer.nome)}" vai ficar devendo ${formatMoney(newBalance)}, acima do limite de ${formatMoney(selectedCustomer.creditLimit)} cadastrado. Continuar mesmo assim?`,
            confirmLabel: 'Vender fiado assim mesmo',
            danger: true,
          });
          if (!ok) return null;
        }
      }
    }
    return { discountApproval, fiadoAmount };
  }

  // Modal de escolha dos itens que vão no carreto, aberto só pelo botão
  // "Finalizar venda + carreto". Mostra os itens do carrinho no momento em
  // que o botão foi clicado (o carrinho fica travado atrás do modal — não
  // há como mudar enquanto ele está aberto), todos marcados por padrão: a
  // suposição é que o normal é levar tudo que foi comprado, e o vendedor só
  // desmarca as exceções (ex: um item que o cliente já levou na mão).
  // Devolve null se o vendedor cancelar (nesse caso a venda não é
  // registrada — nem venda nem carreto, do jeito que se nunca tivesse
  // clicado em nada).
  function openCarretoPickerModal() {
    const snapshot = cart.map((item, idx) => ({
      idx, productId: item.productId, name: item.name, unit: item.unit, qty: item.qty,
    }));
    return new Promise((resolve) => {
      openModal({
        title: 'Itens para o carreto',
        submitLabel: 'Cadastrar venda + carreto',
        wide: true,
        bodyHtml: `
          <p style="font-size:13.5px;color:var(--text-muted);">
            Marque os itens desta venda que vão nesta entrega para <strong>${escapeHtml(selectedCustomer.nome)}</strong>.
            Os que ficarem desmarcados foram vendidos, mas não entram no carreto.
          </p>
          <div id="modal-error"></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th></th><th>Item</th><th>Qtd.</th></tr></thead>
              <tbody>
                ${snapshot.map((i) => `
                  <tr>
                    <td><input type="checkbox" data-carreto-check="${i.idx}" checked></td>
                    <td>${escapeHtml(i.name)}</td>
                    <td>${i.qty} ${escapeHtml(i.unit)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div class="form-row" style="margin-top:14px;">
            <div class="field"><label>Endereço de entrega</label><input id="f-carreto-address" value="${escapeHtml(selectedCustomer.endereco || '')}"></div>
            <div class="field"><label>Responsável pela entrega</label><input id="f-carreto-responsible" placeholder="Ex: nome do motorista"></div>
          </div>
          <div class="field"><label>Observações</label><input id="f-carreto-notes" placeholder="Opcional"></div>
        `,
        onSubmit: (modalEl) => {
          const errBox = modalEl.querySelector('#modal-error');
          const checked = snapshot.filter((i) => modalEl.querySelector(`[data-carreto-check="${i.idx}"]`).checked);
          if (checked.length === 0) {
            errBox.innerHTML = '<div class="form-error">Marque ao menos um item para o carreto — ou use "Finalizar venda" sem carreto.</div>';
            return false;
          }
          resolve({
            items: checked.map((i) => ({ source: 'estoque', productId: i.productId, name: i.name, unit: i.unit, qty: i.qty })),
            address: modalEl.querySelector('#f-carreto-address').value,
            responsible: modalEl.querySelector('#f-carreto-responsible').value,
            notes: modalEl.querySelector('#f-carreto-notes').value,
          });
          return true;
        },
        onCancel: () => resolve(null),
      });
    });
  }

  // Registra a venda de verdade e, se deliveryPlan não for nulo, cadastra o
  // carreto logo em seguida com os itens escolhidos no modal — usado pelos
  // dois botões de finalizar (a diferença entre eles é só se deliveryPlan
  // existe ou não).
  //
  // IMPORTANTE: a criação da venda e a do carreto são tratadas em blocos
  // separados de propósito. A venda já debita estoque e já é um fato
  // consumado assim que createSale() retorna — se o cadastro do carreto
  // falhar DEPOIS disso (ex: algum erro inesperado), a tela não pode dar a
  // entender que "nada foi registrado", ou o vendedor pode tentar vender
  // de novo e cobrar o cliente duas vezes. Por isso só a criação da venda
  // em si aborta o fluxo inteiro; uma falha no carreto vira um aviso
  // separado, sem desfazer nem esconder que a venda foi concluída.
  async function commitSale(discountApproval, fiadoAmount, deliveryPlan) {
    finalizeBtn.disabled = true;
    finalizeCarretoBtn.disabled = true;

    let sale;
    try {
      sale = await createSale({
        userId: ctx.user.id,
        userName: ctx.user.nome,
        userRole: ctx.user.role,
        items: cart.map((i) => ({ productId: i.productId, qty: i.qty, discountType: i.discountType, discountValue: i.discountValue })),
        overallDiscountType, overallDiscountValue,
        payments,
        discountApproval,
        cashSessionId: cashSession?.id || null,
        customerId: selectedCustomer?.id || null,
      });
    } catch (err) {
      showToast(err.message, 'error');
      renderPayments(); // recalcula o disabled dos dois botões (carrinho/pagamento não mudaram)
      return;
    }

    await logAction({
      userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
      action: 'Venda registrada',
      details: `Venda de ${sale.items.length} item(ns) totalizando ${formatMoney(sale.total)}`
        + (sale.itemsDiscountTotal + sale.overallDiscountAmount > 0 ? ` (desconto de ${formatMoney(sale.itemsDiscountTotal + sale.overallDiscountAmount)})` : '')
        + (sale.discountApprovedBy ? ' — desconto autorizado por administrador' : '')
        + (fiadoAmount > 0 ? ` — ${formatMoney(fiadoAmount)} fiado para "${selectedCustomer.nome}"` : '') + '.',
      entity: 'sale', entityId: sale.id,
    });

    let delivery = null;
    let deliveryErrorMessage = null;
    if (deliveryPlan) {
      try {
        delivery = await createDelivery({
          customerId: selectedCustomer.id,
          items: deliveryPlan.items,
          address: deliveryPlan.address,
          responsible: deliveryPlan.responsible,
          notes: deliveryPlan.notes,
          saleId: sale.id,
          userId: ctx.user.id, userName: ctx.user.nome,
        });
        await logAction({
          userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
          action: 'Carreto cadastrado',
          details: `Carreto para "${delivery.customerName}" com ${delivery.items.length} item(ns), gerado junto com a venda.`,
          entity: 'delivery', entityId: delivery.id,
        });
      } catch (err) {
        // A venda já está gravada — não desfaz nada, só avisa que o
        // carreto em si não foi criado, pra cadastrar manualmente depois.
        deliveryErrorMessage = err.message;
      }
    }

    if (deliveryErrorMessage) {
      showToast(`Venda finalizada: ${formatMoney(sale.total)}. O carreto NÃO foi cadastrado (${deliveryErrorMessage}).`, 'error');
    } else {
      showToast(
        delivery ? `Venda finalizada: ${formatMoney(sale.total)}. Carreto cadastrado.` : `Venda finalizada: ${formatMoney(sale.total)}.`,
        'success',
      );
    }

    const customerNameForReceipt = selectedCustomer?.nome || null;
    cart = [];
    overallDiscountType = null;
    overallDiscountValue = 0;
    payments = [];
    selectedCustomer = null;
    renderAll();
    renderCustomerBox();
    resultsBox.innerHTML = '';
    scanInput.value = '';
    scanInput.focus();

    openModal({
      title: 'Venda finalizada',
      submitLabel: '🖨️ Imprimir recibo',
      cancelLabel: 'Fechar',
      bodyHtml: `
        <p style="font-size:15px;">Venda de <strong>${formatMoney(sale.total)}</strong> registrada com sucesso.</p>
        ${delivery ? `<p style="font-size:13.5px;color:var(--success);">🛻 Carreto cadastrado com ${delivery.items.length} item(ns) — veja em "Carreto".</p>` : ''}
        ${deliveryErrorMessage ? `<p style="font-size:13.5px;color:var(--danger);">⚠️ O carreto NÃO foi cadastrado (${escapeHtml(deliveryErrorMessage)}). A venda em si está registrada normalmente — cadastre o carreto manualmente na tela "Carreto", se precisar.</p>` : ''}
        <p class="text-muted" style="font-size:12.5px;">Abre o diálogo de impressão do navegador — escolha a impressora (inclusive térmica de cupom) ou "Salvar como PDF".</p>
      `,
      onSubmit: () => {
        printSaleReceipt(sale, company, customerNameForReceipt);
        return false; // mantém o modal aberto — dá pra imprimir de novo se precisar
      },
    });
  }

  // Os dois botões ficam desabilitados IMEDIATAMENTE ao clicar — antes de
  // qualquer await (checagem de desconto/fiado, que pode envolver um
  // modal) — pra um clique duplo não conseguir abrir dois modais
  // empilhados nem disparar duas vendas seguidas a partir do mesmo
  // carrinho. Todo caminho que aborta sem chegar em commitSale() precisa
  // chamar renderPayments() pra devolver o estado correto dos botões
  // (não um simples "true", que ignoraria o carrinho/pagamento reais).
  finalizeBtn.addEventListener('click', async () => {
    if (cart.length === 0) return;
    finalizeBtn.disabled = true;
    finalizeCarretoBtn.disabled = true;
    const pre = await runPreFinalizeChecks();
    if (!pre) { renderPayments(); return; }
    await commitSale(pre.discountApproval, pre.fiadoAmount, null);
  });

  finalizeCarretoBtn.addEventListener('click', async () => {
    if (cart.length === 0) return;
    if (!selectedCustomer) {
      showToast('Selecione um cliente para gerar o carreto.', 'error');
      return;
    }
    finalizeBtn.disabled = true;
    finalizeCarretoBtn.disabled = true;
    const pre = await runPreFinalizeChecks();
    if (!pre) { renderPayments(); return; }
    const deliveryPlan = await openCarretoPickerModal();
    if (!deliveryPlan) { renderPayments(); return; } // cancelado — nem venda nem carreto são registrados
    await commitSale(pre.discountApproval, pre.fiadoAmount, deliveryPlan);
  });

  renderCreditBanner();
  renderCustomerBox();
  renderAll();
}
