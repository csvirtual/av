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
import { newId } from '../db.js';
import { createDelivery } from '../data/deliveriesRepo.js';
import { logAction } from '../data/auditRepo.js';
import { getCompany } from '../data/companyRepo.js';
import { confirmUserPassword } from '../components/passwordConfirm.js';
import { getOpenSession } from '../data/cashRepo.js';
import { getCustomerBalance } from '../data/customersRepo.js';
import { renderCustomerPicker } from '../components/customerPicker.js';
import { getPendingCredit, setPendingCredit, clearPendingCredit } from '../session.js';
import { bindBarcodeInput, installGlobalScannerListener } from '../utils/barcode.js';
import { formatMoney, escapeHtml, displayUnit, formatQty, BASE_PAYMENT_METHODS } from '../utils/format.js';
import { applyDiscount, computeCartTotals, computeCreditInterest, effectivePrice, isNearExpiry, isExpired, MAX_INSTALLMENTS } from '../utils/pricing.js';
import { userCan } from '../utils/permissions.js';
import { showToast } from '../components/toast.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { printSaleReceipt } from '../components/receipt.js';
import { promptUnknownBarcode } from './products.js';
import { icon } from '../components/icon.js';

const PAYMENT_METHODS = [...BASE_PAYMENT_METHODS, 'Fiado'];
const CREDIT_METHOD = 'Crédito de troca';
const FIADO_METHOD = 'Fiado';
const CREDIT_CARD_METHOD = 'Cartão de crédito';

// Guarda a função de desligar o "reforço" global de leitura entre uma
// renderização da tela e outra — sem isso, cada visita à Nova Venda
// empilharia mais um listener em document (o router não tem um hook de
// "desmontar tela"), e um scan acabaria disparando handleScan() várias
// vezes ao mesmo tempo.
let stopGlobalScanner = null;

// Estado da venda em andamento, fora da função de renderização de
// propósito: o roteador (app.js) apaga e redesenha a tela do zero a cada
// troca de menu, então qualquer coisa declarada só dentro de renderSale()
// nasceria de novo (vazia) toda vez que o vendedor saísse de "Nova venda"
// e voltasse — inclusive só pra checar algo em Estoque no meio de uma
// venda. Ficando aqui fora, essas variáveis sobrevivem à troca de tela: o
// carrinho continua exatamente onde estava ao voltar. São resetadas só em
// dois momentos: ao finalizar a venda (fim de commitSale) e ao trocar de
// usuário logado (resetSaleDraft(), chamada pelo app.js no logout/troca de
// sessão — sem isso, o próximo usuário a logar veria o carrinho de quem
// saiu).
// [{ productId, name, barcode, unit, unitPrice, stockTotal, qty, discountType,
//    discountValue, formName?, formFator? }]
// `stockTotal` é o estoque TOTAL do produto no momento em que a linha entrou
// no carrinho (não o que resta) — de produto normal, só existe UMA linha
// por productId (mesma lógica de sempre, ver addProductToCart), então
// `stockTotal` sozinho já basta pra saber quanto ainda cabe. Produto
// 'personalizado' pode ter VÁRIAS linhas com o mesmo productId (uma por
// forma de venda escolhida, ver addCustomFormToCart) — todas competem pelo
// MESMO estoque único do produto, então o "quanto ainda cabe" de cada linha
// depende também do que as outras linhas do mesmo produto já reservaram
// (ver lineStockAvailable, calculado sempre na hora, nunca guardado).
let cart = [];
let overallDiscountType = null;
let overallDiscountValue = 0;
let payments = []; // [{ method, amount }]
let selectedCustomer = null;
// Chave de deduplicação da tentativa de finalizar O CARRINHO ATUAL (achado
// de auditoria, P0 — ver comentário em createSale/db.js#claimIdempotencyKey).
// Gerada uma vez só, na primeira vez que commitSale() roda pra este
// carrinho, e REUSADA em qualquer tentativa seguinte da MESMA intenção de
// venda — se o botão "Finalizar" disparar duas vezes por qualquer motivo
// (bug, clique fantasma, automação), a segunda chamada a createSale() usa a
// MESMA chave e é recusada pela própria lógica de negócio, não só pelo
// `disabled` da tela. Precisa voltar a `null` em TODO lugar que troca
// `cart` por um array novo (carrinho realmente diferente) — senão o
// próximo carrinho, sem querer, herdaria a chave já usada do anterior e
// seria recusado por engano como "venda duplicada" que nunca existiu.
let saleDedupeKey = null;

// Carrinhos "congelados" — ver botão "Congelar". Achado do usuário:
// internet cair ou o cartão travar bem na hora de fechar uma venda deixa o
// vendedor sem opção além de segurar a fila inteira esperando aquele
// pagamento resolver. Cada entrada aqui é uma FOTO independente do estado
// que hoje vive nas 4 variáveis acima (cart/descontos/pagamentos/cliente),
// permitindo zerar essas variáveis pra atender o próximo cliente sem
// perder nada do carrinho anterior — ver holdCurrentSale()/resumeHeldSale()
// dentro de renderSale(). Mesmo ciclo de vida do carrinho normal: some ao
// trocar de usuário (resetSaleDraft), nunca é persistido em disco.
// [{ id, holdNumber, heldAt, cart, overallDiscountType, overallDiscountValue,
//    payments, selectedCustomer }]
let heldSales = [];
let heldSaleCounter = 0;

export function resetSaleDraft() {
  cart = [];
  saleDedupeKey = null;
  overallDiscountType = null;
  overallDiscountValue = 0;
  payments = [];
  selectedCustomer = null;
  heldSales = [];
  heldSaleCounter = 0;
}

// Achado do usuário: excluir um produto no Estoque enquanto ele está
// parado no carrinho de uma venda ainda não finalizada (o carrinho
// sobrevive à troca de tela, ver comentário acima) trava essa venda com um
// erro só na hora de fechar, sem nenhum aviso antes. Como só UMA aba roda
// o app por vez (ver tabPresence.js), o carrinho desta função e a tela de
// Estoque sempre vivem no mesmo processo — dá pra consultar o estado real
// do carrinho a partir de qualquer outra tela, sem precisar persistir nada
// nem torcer pra estar sincronizado. Usado por views/products.js#removeProduct
// pra avisar ANTES de excluir, em vez de só travar a venda depois.
//
// Devolve o DETALHE de onde o produto está parado (não só um booleano) —
// o carrinho ATIVO e cada carrinho CONGELADO (heldSales) que o contém,
// identificado pelo mesmo rótulo mostrado na tela (nome do cliente, ou
// "Carrinho congelado #N" sem cliente selecionado) — pra quem chama poder
// montar um aviso específico em vez de um genérico "está numa venda em
// andamento", que não deixava claro SE era o carrinho ativo ou um
// congelado (e, sendo congelado, de qual cliente).
export function draftCartLocationsForProduct(productId) {
  const inActiveCart = cart.some((item) => item.productId === productId);
  const heldLabels = heldSales
    .filter((held) => held.cart.some((item) => item.productId === productId))
    .map((held) => held.selectedCustomer?.nome || `Carrinho congelado #${held.holdNumber}`);
  return { inActiveCart, heldLabels };
}

// Soma quanto de `productId` já está reservado em carrinhos CONGELADOS
// (heldSales) — usado pra não deixar o carrinho ativo vender de novo um
// estoque que já foi "prometido" a um cliente esperando na fila com o
// carrinho dele congelado (ver holdCurrentSale). O carrinho ativo cuida
// sozinho das próprias linhas-irmãs (mesmo produto, formas diferentes —
// ver lineStockAvailable); esta função olha só pra FORA dele.
function reservedInHeldSales(productId) {
  return heldSales.reduce((sum, held) => (
    sum + held.cart.reduce((s, item) => (
      item.productId === productId ? s + item.qty * (item.formFator || 1) : s
    ), 0)
  ), 0);
}

export async function renderSale(container, ctx) {
  stopGlobalScanner?.();
  stopGlobalScanner = null;

  let pendingCredit = await getPendingCredit();

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

        <p class="section-title" style="margin-top:16px;text-transform:uppercase;letter-spacing:0.3px;">
          Cliente <span class="text-muted" style="font-weight:400;">(opcional — obrigatório pra vender fiado)</span>
        </p>
        <div id="customer-box"></div>
        <div id="held-sales-box"></div>
      </div>
      <div class="card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:12px;">
          <!-- Achado do usuário: o texto "Carrinho — 3 itens" tinha
          comprimento VARIÁVEL (cresce com a quantidade de itens) disputando
          a mesma linha dos botões "Congelar"/"Limpar" — cabia numa tela
          mais larga, mas não nos 1280px exigidos pra print da Chrome Web
          Store, e podia voltar a não caber a qualquer momento com um
          carrinho grande o bastante. Separado agora: "Carrinho" sozinho é
          um texto CURTO e de largura fixa (nunca voa dependendo do
          carrinho), a contagem de itens desceu pra um badge discreto numa
          linha própria abaixo do título, e os botões ficam sempre no canto
          superior direito do carrinho, na mesma linha do título — como a
          largura que sobra pros botões não depende mais de "Carrinho" ter
          1 ou 100 itens, o encaixe nunca mais quebra. -->
          <div style="display:inline-flex;flex-direction:column;align-items:stretch;">
            <p class="section-title mt-0" style="margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Carrinho</p>
            <span id="cart-count" class="badge badge-gray" hidden></span>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0;">
            <div id="hold-cart-box"></div>
            <div id="clear-cart-box"></div>
          </div>
        </div>
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
  // O atributo autofocus no HTML acima não funciona sozinho aqui — só
  // dispara quando o elemento é inserido pelo parser nativo da página, não
  // quando o HTML entra via innerHTML (como é o caso de toda tela deste
  // app). Sem isto, era preciso clicar no campo antes de digitar ou
  // escanear pela primeira vez ao abrir a tela — o leitor físico continua
  // funcionando igual independente disso (ver installGlobalScannerListener,
  // que captura o scan mesmo sem foco em lugar nenhum), isto é só pra quem
  // vai digitar/buscar manualmente já poder começar direto.
  scanInput.focus();
  const resultsBox = document.getElementById('search-results');
  const creditBanner = document.getElementById('credit-banner');
  const customerBox = document.getElementById('customer-box');
  const cartBox = document.getElementById('cart-box');
  const cartCountEl = document.getElementById('cart-count');
  const clearCartBox = document.getElementById('clear-cart-box');
  const holdCartBox = document.getElementById('hold-cart-box');
  const heldSalesBox = document.getElementById('held-sales-box');
  const totalsBox = document.getElementById('totals-box');
  const paymentsBox = document.getElementById('payments-box');
  const finalizeBtn = document.getElementById('finalize-btn');
  const finalizeCarretoBtn = document.getElementById('finalize-carreto-btn');

  function currentTotals() {
    return computeCartTotals(cart, overallDiscountType, overallDiscountValue);
  }

  async function renderCustomerBox() {
    await renderCustomerPicker(customerBox, {
      getSelected: () => selectedCustomer,
      setSelected: (c) => { selectedCustomer = c; },
      showBalance: true,
    });
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

  // Quanto AINDA cabe na linha `idx` do carrinho, em unidades vendidas
  // (não em unidades de estoque) — descontando o que as OUTRAS linhas do
  // MESMO produto (só acontece com 'personalizado', que pode ter várias
  // formas do mesmo produto no carrinho ao mesmo tempo, ver
  // addCustomFormToCart) já reservaram do estoque único e compartilhado.
  // Produto normal nunca tem uma linha irmã (mesma lógica de sempre: uma
  // única linha por productId), então `siblingStock` sempre dá 0 e o
  // resultado é idêntico ao `item.qtyAvailable` estático de antes.
  function lineStockAvailable(idx) {
    const item = cart[idx];
    const siblingStock = cart.reduce((sum, other, j) => (
      j !== idx && other.productId === item.productId ? sum + other.qty * (other.formFator || 1) : sum
    ), 0);
    // Além das linhas-irmãs no carrinho ATIVO, desconta também o que já
    // está reservado em carrinhos CONGELADOS do mesmo produto — sem isso,
    // dava pra vender de novo um estoque que já tinha sido prometido a um
    // cliente esperando na fila com o carrinho dele congelado.
    const heldStock = reservedInHeldSales(item.productId);
    // Achado do usuário: o `Math.floor` aqui cortava a fração de produtos
    // vendidos por medida contínua (metro, kg, litro) — "resta 0,5 metro"
    // virava "resta 0" mesmo tendo estoque de sobra vendável.
    return Math.max(0, (item.stockTotal - siblingStock - heldStock) / (item.formFator || 1));
  }

  function renderCart() {
    // Achado do usuário: não dava pra saber quantos itens já estavam no
    // carrinho sem rolar a lista inteira — conta as LINHAS (produtos/formas
    // distintas), não a soma das quantidades, mesmo critério de "3 itens no
    // carrinho" que qualquer PDV/e-commerce usa (a quantidade de cada linha
    // já aparece no próprio campo QTD.).
    cartCountEl.textContent = cart.length > 0 ? `${cart.length} ${cart.length === 1 ? 'item' : 'itens'}` : '';
    cartCountEl.hidden = cart.length === 0;

    // Botão "Limpar carrinho" só aparece com pelo menos 1 item — sem
    // sentido oferecer limpar um carrinho que já está vazio.
    clearCartBox.innerHTML = cart.length > 0
      ? `<button class="btn btn-ghost btn-sm" id="clear-cart-btn" type="button">${icon('trash', { size: 15 })} Limpar</button>`
      : '';

    // Botão "Congelar" — mesma regra do "Limpar": só faz sentido congelar
    // um carrinho que já tem algo dentro.
    holdCartBox.innerHTML = cart.length > 0
      ? `<button class="btn btn-secondary btn-sm" id="hold-cart-btn" type="button">${icon('hourglass', { size: 15 })} Congelar</button>`
      : '';
    const holdCartBtn = document.getElementById('hold-cart-btn');
    if (holdCartBtn) holdCartBtn.addEventListener('click', holdCurrentSale);

    const clearCartBtn = document.getElementById('clear-cart-btn');
    if (clearCartBtn) {
      clearCartBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Limpar carrinho',
          message: 'Isso remove todos os itens, o desconto geral e as formas de pagamento já adicionadas nesta venda. O cliente selecionado continua o mesmo. Quer continuar?',
          confirmLabel: 'Limpar carrinho',
          danger: true,
        });
        if (!ok) return;
        cart = [];
        saleDedupeKey = null;
        overallDiscountType = null;
        overallDiscountValue = 0;
        payments = [];
        renderAll();
        resultsBox.innerHTML = '';
        scanInput.value = '';
        scanInput.focus();
      });
    }

    if (cart.length === 0) {
      cartBox.innerHTML = '<div class="empty-cart">Carrinho vazio. Escaneie um produto para começar.</div>';
    } else {
      // Acha do usuário: item recém-adicionado deve aparecer no TOPO da
      // lista, não no fim — é o que o vendedor acabou de bipar, então é o
      // que ele mais precisa ver/conferir sem rolar a tela. `idx` continua
      // sendo a posição REAL em `cart` (usada por data-idx, splice,
      // lineStockAvailable etc.) — só a ORDEM DE EXIBIÇÃO é invertida.
      cartBox.innerHTML = [...cart.keys()].reverse().map((idx) => {
        const item = cart[idx];
        const gross = item.unitPrice * item.qty;
        const net = applyDiscount(gross, item.discountType, item.discountValue);
        const hasDiscount = net < gross - 0.001;
        // Estoque que sobra do produto depois desta venda — não o total
        // absoluto, que já não muda mais depois de escaneado. É essa conta
        // (o que ainda vai restar) que importa pro vendedor decidir se dá
        // pra vender mais um pouco pro próximo cliente. `qtyAvailable` aqui
        // já é "quanto cabe nesta linha, contando o que outras linhas do
        // mesmo produto reservaram" — ver lineStockAvailable.
        const qtyAvailable = lineStockAvailable(idx);
        const remaining = qtyAvailable - item.qty;
        const stockClass = remaining <= 0 ? 'danger' : remaining <= 2 ? 'warn' : '';
        const expiryBadge = item.expired
          ? '<span class="badge badge-red">Fora da validade</span>'
          : (item.nearExpiry ? '<span class="badge badge-gold">Próximo da validade</span>' : '');
        return `
        <div class="cart-line">
          <div class="cart-line-info">
            <div class="name"${expiryBadge ? ' style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-right:-4px;"' : ''}>${escapeHtml(item.name)}${expiryBadge}</div>
            <div class="cart-line-details">
              <span>${formatMoney(item.unitPrice)} / ${escapeHtml(item.unit)}</span>
              <span class="sep">·</span>
              <span>Cód. <span class="code-value">${escapeHtml(item.barcode)}</span></span>
            </div>
            <div class="cart-line-stock ${stockClass}">
              <span class="dot"></span>Estoque restante: ${formatQty(remaining)} ${escapeHtml(item.unit)}
            </div>
          </div>
          <div class="cart-line-controls">
            <div class="cart-line-controls-left">
              <div class="cart-line-qty">
                <div class="cart-line-qty-row">
                  <label for="cart-qty-${idx}">Qtd.</label>
                  <input id="cart-qty-${idx}" type="number" class="qty-input" min="0.001" step="any" max="${qtyAvailable}" value="${item.qty}" data-idx="${idx}">
                  <button class="btn btn-ghost btn-sm" data-discount="${idx}" title="Desconto no item">${hasDiscount ? '% editar' : '% desconto'}</button>
                </div>
                <span class="cart-line-qty-hint">Aceita fração (ex: 0,018 ou 1,597)</span>
              </div>
            </div>
            <div class="cart-line-controls-right">
              <div class="cart-line-price">
                ${hasDiscount ? `<div class="gross">${formatMoney(gross)}</div>` : ''}
                <div class="net">${formatMoney(net)}</div>
              </div>
              <button class="btn btn-ghost btn-sm" data-remove="${idx}" title="Remover">${icon('close', { size: 13 })}</button>
            </div>
          </div>
        </div>
      `;
      }).join('');

      cartBox.querySelectorAll('.qty-input').forEach((input) => {
        input.addEventListener('change', () => {
          const idx = Number(input.dataset.idx);
          // Achado do usuário: `Math.floor` aqui cortava a fração de quem
          // vende por medida contínua (metro, kg, litro) — "0,5 metro"
          // virava "1 metro" na cara-de-pau, cobrando e descontando do
          // estoque o dobro do que devia, sem aviso nenhum. Mantém só o
          // fallback pra entrada inválida/vazia/zero — isso continua indo pra 1.
          let qty = Number(input.value);
          if (!Number.isFinite(qty) || qty <= 0) qty = 1;
          // O próprio item.qty atual da linha já está incluído no que
          // lineStockAvailable enxerga como "disponível pra esta linha"
          // (só exclui as OUTRAS linhas do mesmo produto) — por isso o
          // teto aqui é a disponibilidade calculada com o valor ANTIGO de
          // item.qty ainda no carrinho, não um "mais 1" incremental.
          const available = lineStockAvailable(idx);
          if (qty > available) {
            qty = available;
            showToast(`Estoque disponível de "${cart[idx].name}": ${formatQty(available)}.`, 'error');
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
          <select id="overall-disc-type" class="table-inline-input">
            <option value="">Nenhum</option>
            <option value="percent" ${overallDiscountType === 'percent' ? 'selected' : ''}>%</option>
            <option value="fixed" ${overallDiscountType === 'fixed' ? 'selected' : ''}>R$</option>
          </select>
          <input id="overall-disc-value" type="number" min="0" step="0.01" value="${overallDiscountValue || ''}" placeholder="0" class="table-inline-input" style="width:80px;">
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

  // Juro de parcelamento no cartão (ver utils/pricing.js) — sempre
  // calculado a partir da política configurada em Dados da loja, nunca
  // digitado nem editável aqui na venda. `p.amount` continua sendo a
  // parte do total da venda coberta por aquela forma de pagamento (é isso
  // que precisa somar com as outras linhas pra bater com o total do
  // carrinho); o juro é um valor A MAIS, cobrado do cliente em cima
  // disso — não entra na conta de "pagamento completo" do carrinho, mas
  // conta no total final que sai do cartão dele.
  function paymentInterest(p) {
    if (p.method !== CREDIT_CARD_METHOD) return { interestAmount: 0, totalWithInterest: p.amount, ratePercent: 0 };
    return computeCreditInterest(p.amount, p.installments || 1, company.policies);
  }

  function totalCreditInterest() {
    return payments.reduce((sum, p) => sum + paymentInterest(p).interestAmount, 0);
  }

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
        const interest = paymentInterest(p);
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
          <button class="btn btn-ghost btn-sm" data-pay-remove="${idx}">${icon('close', { size: 13 })}</button>
        </div>
        ${isCreditCard ? (
          interest.interestAmount > 0.001
            ? `<div class="text-muted" style="font-size:12px;margin:6px 0 6px;text-align:right;">+ ${formatMoney(interest.interestAmount)} de juro (${interest.ratePercent.toFixed(1)}%) — total no cartão: <strong>${formatMoney(interest.totalWithInterest)}</strong></div>`
            : `<div class="text-muted" style="font-size:12px;margin:6px 0 6px;text-align:right;">Sem juro nesse parcelamento</div>`
        ) : ''}
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
        // Precisa re-renderizar (diferente das outras trocas de campo) —
        // mudar a quantidade de parcelas muda o juro calculado embaixo,
        // que só aparece de novo com um render completo desta função.
        renderPayments();
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
        : `<span style="color:var(--success);">Pagamento completo ${icon('check', { size: 13 })}</span>`;
    paymentsBox.insertAdjacentHTML('beforeend', `<div style="font-size:13px;font-weight:600;margin-top:8px;text-align:right;">${label}</div>`);

    // Total de juro somado de todas as linhas de cartão — é dinheiro A
    // MAIS que o cliente paga, em cima do valor da venda (não faz parte
    // do "pagamento completo" acima, que só olha o valor do carrinho).
    // Destacado com .notice (achado de auditoria: antes era um texto
    // pequeno e cinza, discreto demais perto do "Pagamento completo ✓" em
    // verde — risco real de o vendedor não perceber e cobrar só o valor
    // sem juro na maquininha física, um aparelho separado que não sabe
    // desse valor sozinho).
    const interestSum = totalCreditInterest();
    if (interestSum > 0.001) {
      paymentsBox.insertAdjacentHTML('beforeend', `
        <div class="notice" style="margin:10px 0 0;text-align:center;">
          ${icon('card', { size: 15 })} Cobrar na maquininha, com juro: <strong>${formatMoney(total + interestSum)}</strong>
        </div>
      `);
    }

    const disableFinalize = cart.length === 0 || Math.abs(remaining) > PAYMENT_TOLERANCE_UI;
    finalizeBtn.disabled = disableFinalize;
    finalizeCarretoBtn.disabled = disableFinalize;
  }

  function renderAll() {
    renderCart();
    renderTotals();
    renderPayments();
  }

  // "Fecha o registro" de um carrinho num objeto independente, pra guardar
  // em heldSales — usado tanto por holdCurrentSale (congela o ativo) quanto
  // por resumeHeldSale (congela o ativo antes de trocar pra outro já
  // congelado). Não precisa clonar profundamente: cada uma das 4 variáveis
  // (cart/descontos/pagamentos/cliente) é imediatamente SUBSTITUÍDA por um
  // valor novo em quem chama esta função, então o objeto antigo capturado
  // aqui nunca mais é mutado por acidente.
  function snapshotActiveSale() {
    heldSaleCounter += 1;
    return {
      id: `${Date.now()}-${heldSaleCounter}`,
      holdNumber: heldSaleCounter,
      heldAt: Date.now(),
      cart, overallDiscountType, overallDiscountValue, payments, selectedCustomer,
    };
  }

  // Iniciais pro "avatar" de um carrinho congelado — duas primeiras
  // palavras do nome do cliente (ex: "Maria Souza" → "MS"). Carrinho sem
  // cliente selecionado (label genérica "Carrinho congelado #N") não tem
  // nome de verdade pra abreviar, então cai num "?" mesmo.
  function heldSaleInitials(label) {
    if (/^Carrinho congelado #\d+$/.test(label)) return '?';
    return label.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }

  // Tempo relativo ("há 2 min") em vez de horário fixo — mais fácil de
  // bater o olho e perceber quem está esperando há mais tempo, sem ter
  // que subtrair horário de cabeça. Chamada de novo a cada refresh
  // periódico (ver heldSalesRefreshTimer), então nunca fica desatualizado
  // enquanto a tela ficar aberta.
  function relativeHeldTime(heldAt) {
    const minutes = Math.floor((Date.now() - heldAt) / 60000);
    if (minutes < 1) return 'agora mesmo';
    if (minutes < 60) return `há ${minutes} min`;
    return `há ${Math.floor(minutes / 60)}h`;
  }

  // Cor da barra lateral de cada card, por tempo de espera — verde
  // (acabou de congelar), dourado (alguns minutos) e vermelho (esperando
  // muito tempo, provavelmente precisa de atenção). Puramente informativo:
  // não bloqueia nem afeta a venda, só ajuda o vendedor a priorizar quem
  // atender de volta primeiro quando há vários carrinhos congelados.
  function heldSaleUrgency(heldAt) {
    const minutes = (Date.now() - heldAt) / 60000;
    if (minutes < 2) return 'ok';
    if (minutes < 10) return 'warn';
    return 'late';
  }

  function renderHeldSales() {
    if (heldSales.length === 0) {
      heldSalesBox.innerHTML = '';
      return;
    }
    heldSalesBox.innerHTML = `
      <div class="held-sales-wrap">
        <p class="held-sales-head">${icon('hourglass', { size: 13 })} Carrinhos em espera — ${heldSales.length}</p>
        ${heldSales.map((held) => {
          const totals = computeCartTotals(held.cart, held.overallDiscountType, held.overallDiscountValue);
          const itemCount = held.cart.length;
          const label = held.selectedCustomer?.nome || `Carrinho congelado #${held.holdNumber}`;
          return `
          <div class="held-sale-card ${heldSaleUrgency(held.heldAt)}">
            <div class="held-sale-avatar">${escapeHtml(heldSaleInitials(label))}</div>
            <div class="held-sale-info">
              <div class="held-sale-name">${escapeHtml(label)}</div>
              <div class="held-sale-meta">
                <span>${itemCount} ${itemCount === 1 ? 'item' : 'itens'}</span><span class="dot"></span>
                <span>${formatMoney(totals.total)}</span><span class="dot"></span>
                <span>${relativeHeldTime(held.heldAt)}</span>
              </div>
            </div>
            <div class="held-sale-actions">
              <button class="held-sale-resume" data-resume-held="${held.id}" type="button" title="Retomar">${icon('check', { size: 13 })}</button>
              <button class="held-sale-discard" data-discard-held="${held.id}" type="button" title="Descartar">${icon('trash', { size: 13 })}</button>
            </div>
          </div>
        `;
        }).join('')}
      </div>
    `;
    heldSalesBox.querySelectorAll('[data-resume-held]').forEach((btn) => {
      btn.addEventListener('click', () => resumeHeldSale(btn.dataset.resumeHeld));
    });
    heldSalesBox.querySelectorAll('[data-discard-held]').forEach((btn) => {
      btn.addEventListener('click', () => discardHeldSale(btn.dataset.discardHeld));
    });
  }

  // Congela o carrinho ativo (guarda em heldSales) e libera as 4 variáveis
  // de estado pra atender o próximo cliente com a tela zerada — sem isso,
  // um pagamento travado (Pix sem internet, maquininha sem sinal) prendia
  // a fila inteira atrás daquele cliente, sem opção de atender ninguém
  // enquanto o problema não resolvia.
  function holdCurrentSale() {
    if (cart.length === 0) return;
    heldSales.push(snapshotActiveSale());
    cart = [];
    saleDedupeKey = null;
    overallDiscountType = null;
    overallDiscountValue = 0;
    payments = [];
    selectedCustomer = null;
    renderAll();
    renderCustomerBox();
    renderHeldSales();
    resultsBox.innerHTML = '';
    scanInput.value = '';
    scanInput.focus();
    showToast('Carrinho congelado. Atenda o próximo cliente — ele continua salvo em "Carrinhos congelados".', 'success');
  }

  // Traz um carrinho congelado de volta pra ser o carrinho ativo. Se já
  // houver algo em andamento no carrinho ativo (item, cliente selecionado,
  // pagamento parcial…), esse "algo em andamento" também é congelado antes
  // da troca — do contrário a troca simplesmente apagaria o atendimento que
  // já estava sendo feito na tela.
  async function resumeHeldSale(id) {
    const held = heldSales.find((h) => h.id === id);
    if (!held) return;
    const activeHasSomething = cart.length > 0 || payments.length > 0 || selectedCustomer || overallDiscountValue > 0;
    if (activeHasSomething) {
      const ok = await confirmDialog({
        title: 'Retomar carrinho congelado',
        message: 'O carrinho atual também será congelado, pra não perder o que já estava sendo montado. Quer continuar?',
        confirmLabel: 'Congelar o atual e retomar este',
      });
      if (!ok) return;
      heldSales.push(snapshotActiveSale());
    }
    heldSales = heldSales.filter((h) => h.id !== id);
    cart = held.cart;
    saleDedupeKey = null;
    overallDiscountType = held.overallDiscountType;
    overallDiscountValue = held.overallDiscountValue;
    payments = held.payments;
    selectedCustomer = held.selectedCustomer;
    renderAll();
    renderCustomerBox();
    renderHeldSales();
    resultsBox.innerHTML = '';
    scanInput.value = '';
    scanInput.focus();
    showToast('Carrinho retomado.', 'success');
  }

  async function discardHeldSale(id) {
    const held = heldSales.find((h) => h.id === id);
    if (!held) return;
    const label = held.selectedCustomer?.nome || `Carrinho congelado #${held.holdNumber}`;
    const ok = await confirmDialog({
      title: 'Descartar carrinho congelado',
      message: `Isso remove "${escapeHtml(label)}" definitivamente, sem registrar nenhuma venda. Quer continuar?`,
      confirmLabel: 'Descartar carrinho',
      danger: true,
    });
    if (!ok) return;
    heldSales = heldSales.filter((h) => h.id !== id);
    renderHeldSales();
    renderAll(); // estoque disponível de outras linhas pode ter mudado (ver reservedInHeldSales)
    showToast('Carrinho congelado descartado.', 'success');
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
    // Reserva de estoque de carrinhos CONGELADOS (ver reservedInHeldSales)
    // — precisa entrar na conta ANTES de decidir se cabe mais uma unidade
    // aqui, senão dois clientes na fila (um com o carrinho congelado)
    // podiam disputar o mesmo estoque sem nenhum aviso até a hora de
    // finalizar, quando só o primeiro createSale() a rodar teria sucesso.
    const heldReserved = reservedInHeldSales(product.id);
    const availableNow = Math.max(0, product.quantity - heldReserved);
    const existing = cart.find((i) => i.productId === product.id);
    if (existing) {
      if (existing.qty >= availableNow) {
        showToast(`Estoque disponível de "${product.name}": ${formatQty(availableNow)}${heldReserved > 0 ? ' (parte já está reservada num carrinho congelado)' : ''}.`, 'error');
        return;
      }
      existing.qty += 1;
    } else {
      if (availableNow <= 0) {
        showToast(`Estoque disponível de "${product.name}": ${formatQty(availableNow)} (reservado num carrinho congelado).`, 'error');
        return;
      }
      cart.push({
        productId: product.id, name: product.name, barcode: product.barcode,
        // Preço unitário já sai como o promocional quando o produto está
        // perto de vencer (ver utils/pricing.js#effectivePrice) — o mesmo
        // valor que createSale() volta a calcular sozinho ao finalizar
        // (nunca confia no que o carrinho carrega), então nunca diverge.
        unit: product.unit, unitPrice: effectivePrice(product), stockTotal: product.quantity, qty: 1,
        nearExpiry: isNearExpiry(product),
        expired: isExpired(product),
        discountType: null, discountValue: 0,
      });
    }
    renderAll();
    resultsBox.innerHTML = '';
    clearTimeout(searchDebounce);
    scanInput.value = '';
    scanInput.focus();
  }

  /** Igual addProductToCart, mas pra UMA FORMA de venda de um produto
   * 'personalizado' (ver data/productsRepo.js) — chamada pelos botões
   * "Adicionar" da lista de formas (renderFormRows/renderPickList abaixo),
   * nunca direto de um bipe de código de barras (um produto personalizado
   * sempre precisa que o vendedor escolha QUAL forma, mesmo com código
   * único — ver handleScan). Cada forma vira sua PRÓPRIA linha no carrinho
   * (identificada por productId + formName, não só productId — um mesmo
   * produto pode ter várias linhas, uma por forma escolhida), competindo
   * pelo mesmo estoque único do produto (ver lineStockAvailable). */
  function addCustomFormToCart(product, form) {
    const heldReserved = reservedInHeldSales(product.id);
    const consumed = cart.reduce((sum, item) => (
      item.productId === product.id ? sum + item.qty * (item.formFator || 1) : sum
    ), 0) + heldReserved;
    if (product.quantity - consumed < form.fator) {
      showToast(`Estoque insuficiente de "${product.name}" para mais uma unidade de "${form.forma}"${heldReserved > 0 ? ' (parte já está reservada num carrinho congelado)' : ''}.`, 'error');
      return;
    }
    const existing = cart.find((i) => i.productId === product.id && i.formName === form.forma);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({
        productId: product.id, name: product.name, barcode: product.barcode,
        unit: form.forma, unitPrice: form.valor, stockTotal: product.quantity, qty: 1,
        formName: form.forma, formFator: form.fator,
        nearExpiry: false, expired: false,
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
        // Achado de auditoria: essa checagem sempre avisava com um toast,
        // mas nunca limpava resultsBox — se o vendedor tivesse digitado
        // parte do nome antes de bipar o código completo (a busca "ao
        // digitar" já preenche essa área com uma lista de resultados), a
        // lista antiga ficava visível e clicável por baixo do toast, dando
        // a entender que ainda dava pra adicionar aquele item.
        resultsBox.innerHTML = '';
        showToast(`"${product.name}" está inativo e não pode ser vendido.`, 'error');
        return;
      }
      // Produto 'personalizado' nunca vai direto pro carrinho, mesmo com
      // código de barras único (bipado ou achado por nome, ver o outro
      // ramo abaixo) — sempre precisa que o vendedor escolha QUAL forma de
      // venda (lata, metro, carrada...), então mostra a lista de formas em
      // vez de adicionar sozinho.
      if (product.unit === 'personalizado') {
        renderPickList([product]);
        return;
      }
      addProductToCart(product);
      return;
    }
    const matches = await searchProducts(value);
    const activeMatches = matches.filter((p) => p.active);
    if (activeMatches.length === 0) {
      // Nenhum produto (nem por código, nem por nome) bate com o que foi
      // bipado/digitado — em vez de só avisar que não achou, oferece
      // cadastrar na hora (mesmo modal usado na tela Estoque, ver
      // views/products.js#promptUnknownBarcode). Se o cadastro for
      // concluído, o produto recém-criado já entra direto no carrinho —
      // sem isso o vendedor teria que bipar de novo depois de cadastrar.
      // Mesmo achado de auditoria do ramo acima: limpa resultsBox antes de
      // abrir o modal, pra não deixar uma lista de resultados antiga (de
      // uma digitação parcial anterior) visível por baixo dele.
      resultsBox.innerHTML = '';
      promptUnknownBarcode(ctx, value, { onRegistered: (created) => addProductToCart(created) });
      return;
    }
    if (activeMatches.length === 1 && activeMatches[0].unit !== 'personalizado') {
      addProductToCart(activeMatches[0]);
      return;
    }
    renderPickList(activeMatches);
  }

  function renderPickList(matches) {
    // Linhas flex independentes, não <table> — cada linha se dimensiona pelo
    // próprio conteúdo, então o badge de validade (perto do nome ou no lugar
    // do preço) fica com o mesmo espaçamento fixo (--pdv-gap) dos dois lados
    // sempre, sem herdar largura de coluna de outras linhas da lista (era
    // isso que descentralizava o badge quando outra linha, com nome maior,
    // forçava a "coluna" a ficar mais larga — tabela HTML compartilha
    // largura de coluna entre todas as linhas, flex não).
    //
    // Produto 'personalizado' não tem UM preço/botão — mostra o nome como
    // cabeçalho e uma sub-linha por forma de venda cadastrada (ver
    // data/productsRepo.js#resolveCustomUnitFields), cada uma com seu
    // próprio valor e seu próprio "Adicionar" (addCustomFormToCart), pro
    // vendedor escolher qual forma foi vendida de verdade.
    resultsBox.innerHTML = `
      <div class="pdv-results" style="margin-top:10px;">
        ${matches.slice(0, 8).map((p) => {
          if (p.unit === 'personalizado') {
            return `
          <div class="pdv-result-row" style="flex-direction:column;align-items:stretch;gap:6px;">
            <div class="pdv-result-name"><span>${escapeHtml(p.name)}</span></div>
            ${(p.customForms || []).map((f, fi) => `
              <div class="pdv-result-row" style="padding-left:14px;">
                <div class="pdv-result-name"><span>${escapeHtml(f.forma)}</span></div>
                <div class="pdv-result-price">${formatMoney(f.valor)}</div>
                <div class="pdv-result-qty">${formatQty(p.quantity)} ${escapeHtml(displayUnit(p))}</div>
                <button class="btn btn-sm" data-pick-form="${p.id}:${fi}">Adicionar</button>
              </div>
            `).join('')}
          </div>
        `;
          }
          const nearExpiryBadge = (isNearExpiry(p) && !isExpired(p)) ? '<span class="badge badge-gold">Próximo da validade</span>' : '';
          const expiredBadge = isExpired(p) ? '<span class="badge badge-red">Fora da validade</span>' : '';
          return `
          <div class="pdv-result-row">
            <div class="pdv-result-name">
              <span>${escapeHtml(p.name)}</span>${nearExpiryBadge}
            </div>
            <div class="pdv-result-price">${expiredBadge || formatMoney(effectivePrice(p))}</div>
            <div class="pdv-result-qty">${formatQty(p.quantity)} ${escapeHtml(p.unit)}</div>
            <button class="btn btn-sm" data-pick="${p.id}">Adicionar</button>
          </div>
        `;
        }).join('')}
      </div>
    `;
    resultsBox.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => addProductToCart(matches.find((p) => p.id === btn.dataset.pick)));
    });
    resultsBox.querySelectorAll('[data-pick-form]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [productId, formIdx] = btn.dataset.pickForm.split(':');
        const product = matches.find((p) => p.id === productId);
        const form = product?.customForms?.[Number(formIdx)];
        if (product && form) addCustomFormToCart(product, form);
      });
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
          // própria antes de gravar a venda. confirmUserPassword já trata
          // erro inesperado de verifyLogin (ex: erro no IndexedDB) sem
          // deixar o modal sem fechar e sem mostrar nada pro vendedor —
          // achado de auditoria, mesmo padrão já corrigido em views/users.js.
          const admin = await confirmUserPassword({
            username, password, errBox, checkEmpty: false, requireAdmin: true,
            invalidMessage: 'Usuário/senha inválidos ou não é um administrador.',
          });
          if (!admin) return false;
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

    if (!userCan(ctx.user, 'unlimitedDiscount') && totals.totalDiscountPercent > vendorMaxDiscountPercent + 0.001) {
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
          <p style="font-size:13px;color:var(--text-muted);">
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
                    <td>${formatQty(i.qty)} ${escapeHtml(i.unit)}</td>
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
    // Gerada uma vez só por carrinho (ver declaração de saleDedupeKey lá em
    // cima) — se commitSale() acabar rodando mais de uma vez pra ESTE MESMO
    // carrinho (o `disabled` acima é a primeira barreira, não a única),
    // reusa a mesma chave, e createSale() recusa a segunda tentativa.
    if (!saleDedupeKey) saleDedupeKey = newId();

    let sale;
    try {
      // Achado de auditoria (P2): `cashSession` (linha ~75) é capturada UMA
      // VEZ quando a tela abre, não quando a venda é finalizada de verdade
      // — se alguém fechar o caixa (outra aba, outro terminal) enquanto o
      // vendedor ainda está montando o carrinho, a venda ficava marcada com
      // o id de uma sessão JÁ FECHADA, cuja conferência já tinha sido
      // calculada e congelada: essa venda nunca entraria em NENHUM
      // fechamento, presente ou futuro — "sumindo" da conferência de caixa
      // sem sumir da venda em si. Rebusca o caixa aberto agora, no
      // instante exato da finalização, em vez de confiar na referência
      // antiga do momento em que a tela foi aberta.
      const openSessionNow = await getOpenSession();
      // Se a loja exige caixa aberto pra vender e ele foi fechado agora,
      // no meio da montagem do carrinho, a venda não pode simplesmente
      // seguir sem sessão nenhuma (violaria a própria política que barrou
      // a entrada nesta tela) — melhor barrar aqui, com uma mensagem clara,
      // do que registrar uma venda "órfã" de caixa.
      if (requireOpenCashSession && !openSessionNow) {
        throw new Error('O caixa foi fechado enquanto esta venda estava sendo montada. Abra o caixa novamente para finalizar.');
      }
      sale = await createSale({
        userId: ctx.user.id,
        userName: ctx.user.nome,
        items: cart.map((i) => ({ productId: i.productId, name: i.name, qty: i.qty, discountType: i.discountType, discountValue: i.discountValue, formName: i.formName })),
        overallDiscountType, overallDiscountValue,
        payments,
        discountApproval,
        cashSessionId: openSessionNow?.id || null,
        customerId: selectedCustomer?.id || null,
        dedupeKey: saleDedupeKey,
      });
    } catch (err) {
      // Achado de auditoria: um crédito de troca aplicado (botão "Usar
      // nesta venda" — ver renderCreditBanner) já é deduzido do saldo
      // pendente da SESSÃO na hora do clique, antes de a venda ser
      // confirmada de verdade. Se a venda falhar por qualquer motivo
      // depois disso (ex: uma validação que só o servidor pega), sem essa
      // devolução o crédito ficava só "preso" na linha de pagamento desta
      // tentativa — se o vendedor desistisse da venda em vez de tentar de
      // novo, o cliente perdia parte do crédito sem NENHUMA venda
      // concluída com ele. Devolve automaticamente e tira a linha do
      // carrinho de pagamentos — mesmo efeito do botão "Remover" (ver
      // acima), só que automático — assim o estado nunca fica em dois
      // lugares ao mesmo tempo: ou está disponível em pendingCredit, ou
      // está de verdade numa venda concluída, nunca os dois, nunca nenhum.
      const creditPaymentIdx = payments.findIndex((p) => p.method === CREDIT_METHOD);
      if (creditPaymentIdx !== -1) {
        const refund = payments[creditPaymentIdx].amount;
        payments.splice(creditPaymentIdx, 1);
        const current = await getPendingCredit();
        pendingCredit = { ...(current || { reason: 'Gerado por estorno' }), amount: (current?.amount || 0) + refund };
        await setPendingCredit(pendingCredit);
        renderCreditBanner();
        showToast(`${err.message} O crédito de troca aplicado foi devolvido — use "Usar nesta venda" de novo se quiser tentar outra vez.`, 'error');
      } else {
        showToast(err.message, 'error');
      }
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
          // `sale.id` já é único por venda bem-sucedida (createSale só
          // consegue rodar uma vez pra este carrinho, protegido por
          // saleDedupeKey acima) — reusa como dedupeKey do carreto sem
          // precisar gerar mais uma chave.
          dedupeKey: sale.id,
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
    saleDedupeKey = null;
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
      submitLabel: `${icon('printer', { size: 15 })} Imprimir recibo`,
      cancelLabel: 'Fechar',
      bodyHtml: `
        <p style="font-size:15px;">Venda de <strong>${formatMoney(sale.total)}</strong> registrada com sucesso.</p>
        ${delivery ? `<p style="font-size:13.5px;color:var(--success);">${icon('truck', { size: 15 })} Carreto cadastrado com ${delivery.items.length} item(ns) — veja em "Carreto".</p>` : ''}
        ${deliveryErrorMessage ? `<p style="font-size:13.5px;color:var(--danger);">${icon('warning', { size: 15 })} O carreto NÃO foi cadastrado (${escapeHtml(deliveryErrorMessage)}). A venda em si está registrada normalmente — cadastre o carreto manualmente na tela "Carreto", se precisar.</p>` : ''}
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
  renderHeldSales();

  // O tempo relativo ("há N min") e a cor de urgência de cada card de
  // carrinho congelado (ver relativeHeldTime/heldSaleUrgency) só mudam com
  // o relógio, não com nenhuma ação do vendedor — sem um refresh próprio,
  // um carrinho ficaria pra sempre "há 2 min" na tela enquanto o vendedor
  // não tocasse em mais nada. Reaplica renderHeldSales a cada 30s, só
  // enquanto a tela estiver aberta (limpo no cleanup, igual o scanner).
  const heldSalesRefreshTimer = setInterval(renderHeldSales, 30000);

  // Devolve a função de limpeza do reforço global de leitura de código de
  // barras (listener em `document`, não preso a nenhum elemento desta
  // tela) — o router (app.js) chama isso automaticamente ao SAIR desta
  // tela. Antes, essa limpeza só acontecia ao REVISITAR Nova Venda (linha
  // 40 acima), então o listener ficava ativo em segundo plano em
  // qualquer outra tela até o usuário voltar aqui — inofensivo na
  // prática (o listener já ignora campo focado e modal aberto), mas
  // podia gerar um toast de erro confuso numa tela sem nada a ver se
  // alguém escaneasse um código por acaso enquanto estava em outro lugar.
  return () => {
    stopGlobalScanner?.();
    stopGlobalScanner = null;
    clearInterval(heldSalesRefreshTimer);
  };
}
