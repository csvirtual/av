// Histórico de vendas — visível para todos os perfis (é o que dá controle
// rígido sobre "o que foi vendido, por quem, quando" pedido no escopo).
// Vendedores veem as vendas de todos os colegas aqui (é só o LOG interno de
// ações que exige a permissão 'logs' — ver views/logs.js).
//
// Estorno (total ou por item) está disponível pros dois perfis — admin e
// vendedor. Continua exigindo motivo obrigatório e sempre vai pro log de
// auditoria com quem fez, então mesmo sem aprovação prévia de um admin, dá
// pra rastrear todo estorno depois.
import { listSalesPage, summarizeSales, refundSaleItems, saleStatus } from '../data/salesRepo.js';
import { listUsers } from '../data/usersRepo.js';
import { listCustomers } from '../data/customersRepo.js';
import { getCompany } from '../data/companyRepo.js';
import { getOpenSession } from '../data/cashRepo.js';
import { logAction } from '../data/auditRepo.js';
import { addPendingCredit } from '../session.js';
import { formatMoney, formatDateTime, escapeHtml, formatQty } from '../utils/format.js';
import { openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { printSaleReceipt } from '../components/receipt.js';
import { icon } from '../components/icon.js';
import { enhanceSelect } from '../components/customSelect.js';

const STATUS_BADGE = {
  completa: '<span class="badge badge-green">Completa</span>',
  parcial: '<span class="badge badge-gold">Parcialmente estornada</span>',
  estornada: '<span class="badge badge-red">Estornada</span>',
};

/** Rótulo de uma forma de pagamento pra exibição — só mostra o número de
 * parcelas quando fizer diferença (cartão de crédito parcelado em mais de
 * 1x); à vista ou qualquer outra forma fica só o nome mesmo. */
function paymentMethodLabel(p) {
  const suffix = p.method === 'Cartão de crédito' && p.installments > 1 ? ` (${p.installments}x)` : '';
  return `${escapeHtml(p.method)}${suffix}`;
}

export async function renderSalesHistory(container, ctx) {
  container.innerHTML = '<div class="card loading-state"><span class="spinner"></span>Carregando…</div>';

  const [users, customers, company] = await Promise.all([listUsers(), listCustomers(), getCompany()]);
  const customerName = (id) => customers.find((c) => c.id === id)?.nome || null;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Histórico de vendas</h1>
        <div class="desc">Todas as vendas registradas na loja, com data, hora e vendedor responsável.</div>
      </div>
    </div>
    <div class="toolbar">
      <select id="seller-filter">
        <option value="">Todos os vendedores</option>
        ${users.map((u) => `<option value="${u.id}">${escapeHtml(u.nome)}</option>`).join('')}
      </select>
      <div id="customer-filter-box" style="min-width:210px;"></div>
      <label class="text-muted" style="font-size:13px;">De <input type="date" id="date-from"></label>
      <label class="text-muted" style="font-size:13px;">Até <input type="date" id="date-to"></label>
    </div>
    <div id="sales-table"></div>
  `;

  const tableBox = document.getElementById('sales-table');

  // Paginação real (ver data/salesRepo.js#listSalesPage/summarizeSales) —
  // achado de auditoria: a versão anterior carregava TODAS as vendas da
  // loja de uma vez (listSales()) e desenhava uma <tr> por venda de uma
  // vez só, mesmo antes de aplicar qualquer filtro. Com dezenas de
  // milhares de vendas acumuladas (anos de loja em operação), isso travava
  // a tela por vários segundos — confirmado ao vivo com 20 mil vendas
  // simuladas. Agora só a página visível fica em memória/DOM; "Carregar
  // mais" busca a próxima fatia, e o resumo (contagem + total líquido) usa
  // uma soma separada que nunca guarda as vendas em si (summarizeSales).
  const PAGE_SIZE = 50;
  let loadedSales = [];
  let cursor = { afterKey: undefined, afterId: undefined };
  let hasMore = false;
  let summary = { count: 0, netTotal: 0 };

  // Achado do usuário: pra saber o que UM cliente específico comprou, tinha
  // que vasculhar a lista inteira à mão — busca em memória sobre a lista de
  // clientes já carregada (não precisa de ida ao banco a cada tecla), igual
  // ao mesmo padrão de busca de cliente usado em sale.js/carreto.js. Só a
  // SELEÇÃO final entra no filtro de verdade (customerId, ver
  // currentFilters), que aí sim vai pro banco via listSalesPage/
  // summarizeSales (nunca carrega a tabela `sales` inteira).
  let selectedCustomerId = null;
  function renderCustomerFilterBox() {
    const box = document.getElementById('customer-filter-box');
    if (!selectedCustomerId) {
      box.innerHTML = `
        <input type="text" id="customer-filter-search" class="customer-search-input" placeholder="Buscar cliente…">
        <div id="customer-filter-results"></div>
      `;
      const searchInput = box.querySelector('#customer-filter-search');
      const resultsDiv = box.querySelector('#customer-filter-results');
      searchInput.addEventListener('input', () => {
        const term = searchInput.value.trim().toLowerCase();
        if (term.length < 2) { resultsDiv.innerHTML = ''; return; }
        const matches = customers.filter((c) => c.nome.toLowerCase().includes(term)).slice(0, 6);
        resultsDiv.innerHTML = matches.length === 0
          ? '<div class="text-muted" style="font-size:12.5px;padding:4px 0;">Nenhum cliente encontrado.</div>'
          : `<div class="table-wrap" style="margin-top:6px;"><table><tbody>
              ${matches.map((c) => `<tr><td><button type="button" class="btn btn-ghost btn-sm" data-pick-customer="${c.id}" style="display:block;width:100%;text-align:left;">${escapeHtml(c.nome)}</button></td></tr>`).join('')}
            </tbody></table></div>`;
        resultsDiv.querySelectorAll('[data-pick-customer]').forEach((btn) => {
          btn.addEventListener('click', () => {
            selectedCustomerId = btn.dataset.pickCustomer;
            renderCustomerFilterBox();
            reload();
          });
        });
      });
    } else {
      box.innerHTML = `
        <span class="badge badge-gray" style="vertical-align:middle;">${escapeHtml(customerName(selectedCustomerId) || 'cliente removido')}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="clear-customer-filter-btn" title="Remover filtro de cliente">${icon('close', { size: 13 })}</button>
      `;
      box.querySelector('#clear-customer-filter-btn').addEventListener('click', () => {
        selectedCustomerId = null;
        renderCustomerFilterBox();
        reload();
      });
    }
  }

  function currentFilters() {
    const sellerId = document.getElementById('seller-filter').value || undefined;
    const customerId = selectedCustomerId || undefined;
    const from = document.getElementById('date-from').value;
    const to = document.getElementById('date-to').value;
    const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
    // .999, não .000: uma venda às 23:59:59.500 do dia "até" tem timestamp
    // em milissegundos maior que ...59.000 e ficava fora do filtro por até
    // quase 1 segundo (achado de auditoria).
    const toTs = to ? new Date(`${to}T23:59:59.999`).getTime() : undefined;
    return { sellerId, customerId, fromTs, toTs };
  }

  async function reload() {
    const filters = currentFilters();
    const [page, sum] = await Promise.all([
      listSalesPage({ ...filters, limit: PAGE_SIZE }),
      summarizeSales(filters),
    ]);
    loadedSales = page.items;
    hasMore = page.hasMore;
    cursor = { afterKey: page.nextKey, afterId: page.nextId };
    summary = sum;
    renderTable();
  }

  async function loadMore() {
    const filters = currentFilters();
    const page = await listSalesPage({ ...filters, limit: PAGE_SIZE, afterKey: cursor.afterKey, afterId: cursor.afterId });
    loadedSales = loadedSales.concat(page.items);
    hasMore = page.hasMore;
    cursor = { afterKey: page.nextKey, afterId: page.nextId };
    renderTable();
  }

  // Inclui o juro de parcelamento no cartão (repassado pro cliente) —
  // dinheiro real recebido, conta como faturamento igual em Painel e
  // Relatórios (ver data/reportsRepo.js#netSaleTotalWithInterest).
  function netTotal(sale) {
    return sale.total - sale.refundedTotal + (sale.creditInterestTotal || 0);
  }

  function renderTable() {
    if (loadedSales.length === 0) {
      tableBox.innerHTML = '<div class="table-wrap"><div class="table-empty">Nenhuma venda encontrada para o filtro selecionado.</div></div>';
      return;
    }
    tableBox.innerHTML = `
      <div class="utility-bar">
        <span class="text-muted" style="font-size:13px;">${summary.count} venda(s)${loadedSales.length < summary.count ? ` — mostrando ${loadedSales.length}` : ''}</span>
        <span style="font-weight:700;">Total líquido: ${formatMoney(summary.netTotal)}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data/Hora</th><th>Vendedor</th><th>Cliente</th><th>Itens</th><th>Pagamento</th><th>Total</th><th style="text-align:center;">Status</th><th></th></tr></thead>
          <tbody>
            ${loadedSales.map((s) => `
              <tr>
                <td>${formatDateTime(s.timestamp)}</td>
                <td>${escapeHtml(s.userName)}</td>
                <td>${s.customerId ? escapeHtml(customerName(s.customerId) || 'cliente removido') : '<span class="text-muted">—</span>'}</td>
                <td>${s.items.length}</td>
                <td>${s.payments.map((p) => paymentMethodLabel(p)).join(', ') || '—'}</td>
                <td>
                  ${s.refundedTotal > 0 ? `<div class="text-muted" style="font-size:11.5px;text-decoration:line-through;">${formatMoney(s.total)}</div>` : ''}
                  ${formatMoney(netTotal(s))}
                </td>
                <td style="text-align:center;">${STATUS_BADGE[saleStatus(s)]}</td>
                <td><button class="btn btn-ghost btn-sm" data-detail="${s.id}">Ver itens</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${hasMore ? '<div style="text-align:center;margin-top:14px;"><button class="btn btn-secondary" id="load-more-btn">Carregar mais</button></div>' : ''}
    `;
    tableBox.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => showSaleDetail(loadedSales.find((s) => s.id === btn.dataset.detail)));
    });
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', async () => {
        loadMoreBtn.disabled = true;
        loadMoreBtn.textContent = 'Carregando…';
        await loadMore();
      });
    }
  }

  function showSaleDetail(sale) {
    const canRefund = saleStatus(sale) !== 'estornada';
    openModal({
      title: `Venda de ${formatDateTime(sale.timestamp)}`,
      submitLabel: canRefund ? 'Estornar itens' : 'Fechar',
      cancelLabel: canRefund ? 'Fechar' : undefined,
      singleButton: !canRefund,
      wide: true,
      bodyHtml: `
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <button type="button" class="btn btn-secondary btn-sm" id="print-receipt-btn">${icon('printer', { size: 15 })} Imprimir recibo</button>
        </div>
        <p class="text-muted" style="font-size:13px;">
          Vendedor: <strong>${escapeHtml(sale.userName)}</strong>
          ${sale.customerId ? ` · Cliente: <strong>${escapeHtml(customerName(sale.customerId) || 'cliente removido')}</strong>` : ''}
          · ${STATUS_BADGE[saleStatus(sale)]}
        </p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Produto</th><th>Qtd</th><th>Unitário</th><th>Desconto</th><th>Total</th></tr></thead>
            <tbody>
              ${sale.items.map((i) => `
                <tr>
                  <td>${escapeHtml(i.name)}${i.qtyRefunded > 0 ? ` <span class="badge badge-red">${formatQty(i.qtyRefunded)} estornado(s)</span>` : ''}</td>
                  <td>${formatQty(i.qty)} ${escapeHtml(i.unit)}</td>
                  <td>${formatMoney(i.unitPrice)}</td>
                  <td>${i.discountType ? (i.discountType === 'percent' ? `${i.discountValue}%` : formatMoney(i.discountValue)) : '—'}</td>
                  <td>${formatMoney(i.lineTotal)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:10px;font-size:13px;">
          <div style="display:flex;justify-content:space-between;color:var(--text-muted);"><span>Subtotal</span><span>${formatMoney(sale.subtotal)}</span></div>
          ${sale.itemsDiscountTotal > 0 ? `<div style="display:flex;justify-content:space-between;color:var(--danger);"><span>Desconto nos itens</span><span>−${formatMoney(sale.itemsDiscountTotal)}</span></div>` : ''}
          ${sale.overallDiscountAmount > 0 ? `<div style="display:flex;justify-content:space-between;color:var(--danger);"><span>Desconto geral</span><span>−${formatMoney(sale.overallDiscountAmount)}</span></div>` : ''}
        </div>
        <div class="cart-total"><span>Total</span><span class="value">${formatMoney(sale.total)}</span></div>
        <p class="section-title" style="margin-top:14px;">Pagamento</p>
        ${sale.payments.map((p) => `
          <div style="display:flex;justify-content:space-between;font-size:13px;"><span>${paymentMethodLabel(p)}</span><span>${formatMoney(p.amount)}</span></div>
          ${p.interestAmount > 0.001 ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);"><span>Juro do parcelamento</span><span>+${formatMoney(p.interestAmount)}</span></div>` : ''}
        `).join('')}
        ${sale.creditInterestTotal > 0.001 ? `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-top:4px;"><span>Total com juro</span><span>${formatMoney(sale.total + sale.creditInterestTotal)}</span></div>` : ''}
        ${sale.refunds.length > 0 ? `
          <p class="section-title" style="margin-top:14px;">Estornos</p>
          ${sale.refunds.map((r) => `
            <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:8px;padding:8px;background:var(--surface-alt);border-radius:6px;">
              <div><strong>${formatMoney(r.totalRefunded)}</strong> em ${formatDateTime(r.timestamp)} por ${escapeHtml(r.userName)}</div>
              <div>Motivo: ${escapeHtml(r.reason)}</div>
              <div>${r.items.map((i) => `${formatQty(i.qty)}× ${escapeHtml(i.name)}`).join(', ')}</div>
            </div>
          `).join('')}
        ` : ''}
      `,
      onMount: (modalEl) => {
        modalEl.querySelector('#print-receipt-btn').addEventListener('click', () => {
          printSaleReceipt(sale, company, sale.customerId ? customerName(sale.customerId) : null);
        });
      },
      onSubmit: (modalEl, close) => {
        if (!canRefund) return true;
        close();
        openRefundModal(sale);
        return false;
      },
    });
  }

  function openRefundModal(sale) {
    // `idx` é a posição de verdade dentro de `sale.items` (não a posição
    // depois do filter abaixo) — é o que refundSaleItems usa pra saber
    // exatamente QUAL linha estornar. Precisa disso porque um produto
    // 'personalizado' pode aparecer em mais de uma linha na MESMA venda
    // (uma por forma vendida, ex: 3 latas + 1 metro de areia — mesmo
    // productId, linhas diferentes): casar só por productId (como era
    // antes) sempre pegava a PRIMEIRA linha daquele produto, então estornar
    // a segunda forma silenciosamente estornava a errada. Ver achado de
    // auditoria em data/salesRepo.js#refundSaleItems.
    const refundableItems = sale.items
      .map((i, idx) => ({ ...i, idx }))
      .filter((i) => i.qty - i.qtyRefunded > 0);
    // Achado de auditoria (P0): gerada uma vez só, na abertura do modal, e
    // reusada em toda tentativa de confirmar ESTE estorno — mesmo padrão já
    // usado em resgate de pontos/pagamento de fiado/conta. Comprovado por
    // teste que duas confirmações concorrentes do mesmo estorno PARCIAL
    // (sem essa chave) passavam as duas, devolvendo a mesma quantidade duas
    // vezes — ver data/salesRepo.js#refundSaleItems.
    const dedupeKey = crypto.randomUUID();
    openModal({
      title: `Estornar itens — venda de ${formatDateTime(sale.timestamp)}`,
      submitLabel: 'Confirmar estorno',
      bodyHtml: `
        <div id="modal-error"></div>
        <p class="text-muted" style="font-size:13px;">Marque a quantidade de cada item que está sendo devolvido.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Produto</th><th>Disponível p/ estorno</th><th>Estornar</th></tr></thead>
            <tbody>
              ${refundableItems.map((i) => `
                <tr>
                  <td>${escapeHtml(i.name)}</td>
                  <td>${formatQty(i.qty - i.qtyRefunded)} ${escapeHtml(i.unit)}</td>
                  <td><input type="number" min="0" step="0.5" max="${i.qty - i.qtyRefunded}" value="0" data-refund-qty="${i.idx}" class="table-inline-input" style="width:70px;"></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Motivo do estorno *</label>
          <input id="f-reason" placeholder="Ex: produto com defeito, troca, erro no pedido…">
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;margin-top:6px;">
          <input type="checkbox" id="f-credit"> Gerar crédito de troca (o cliente leva outro produto em vez do dinheiro de volta)
        </label>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const reason = modalEl.querySelector('#f-reason').value.trim();
        const generateCredit = modalEl.querySelector('#f-credit').checked;
        const items = refundableItems
          .map((i) => ({ productId: i.productId, itemIndex: i.idx, qty: Number(modalEl.querySelector(`[data-refund-qty="${i.idx}"]`).value) || 0 }))
          .filter((i) => i.qty > 0);

        if (!reason) { errBox.innerHTML = '<div class="form-error">Informe o motivo do estorno.</div>'; return false; }
        if (items.length === 0) { errBox.innerHTML = '<div class="form-error">Marque ao menos um item para estornar.</div>'; return false; }

        try {
          // A sessão de caixa ABERTA agora (não a da venda original — pode
          // ser de dias atrás) é o que importa pra conferência de fechamento
          // saber de onde esse dinheiro saiu (ver cashRepo.js#computeExpectedAmounts).
          const openSession = await getOpenSession();
          const { refund, debtReduced } = await refundSaleItems({
            saleId: sale.id, userId: ctx.user.id, userName: ctx.user.nome, reason, items, generateCredit,
            cashSessionId: openSession?.id || null,
            dedupeKey,
          });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Estorno de venda',
            details: `Estorno de ${formatMoney(refund.totalRefunded)} na venda de ${formatDateTime(sale.timestamp)}. Motivo: ${reason}.`,
            entity: 'sale', entityId: sale.id,
          });
          // Achado de auditoria: quando a venda estornada tinha parte ou todo
          // o pagamento em fiado, o toast de confirmação agora avisa que a
          // dívida do cliente também foi reduzida — sem isso o vendedor não
          // tem como saber, na hora, que o extrato do cliente mudou (ver
          // salesRepo.js#refundSaleItems e customersRepo.js#recordDebtRefund).
          const debtNote = debtReduced > 0 ? ` Dívida do cliente reduzida em ${formatMoney(debtReduced)}.` : '';
          if (generateCredit) {
            await addPendingCredit({ amount: refund.totalRefunded, sourceSaleId: sale.id, sourceRefundId: refund.id, reason: `Troca da venda de ${formatDateTime(sale.timestamp)}` });
            showToast(`Estorno confirmado. Crédito de ${formatMoney(refund.totalRefunded)} disponível na próxima venda.${debtNote}`, 'success');
          } else {
            showToast(`Estorno de ${formatMoney(refund.totalRefunded)} confirmado.${debtNote}`, 'success');
          }
          reload();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  document.getElementById('seller-filter').addEventListener('change', reload);
  enhanceSelect(document.getElementById('seller-filter'));
  document.getElementById('date-from').addEventListener('change', reload);
  document.getElementById('date-to').addEventListener('change', reload);

  renderCustomerFilterBox();
  await reload();
}
