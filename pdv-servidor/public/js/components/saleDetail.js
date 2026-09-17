// Modal de "Ver itens" de uma venda — extraído de views/salesHistory.js pra
// poder ser reaproveitado em views/clientes.js ("Ver compras" de um cliente
// específico, sem precisar ir até o Histórico de vendas só pra ver o que ele
// comprou). Só consulta (itens, pagamento, estornos já feitos e reimpressão
// de recibo) — a ação de ESTORNAR continua só em salesHistory.js, que já
// tem o contexto de sessão de caixa/log de auditoria/permissão certo pra
// isso; aqui o objetivo é só "o que foi comprado", não gerenciar a venda.
import { formatMoney, formatDateTime, escapeHtml, formatQty } from '../utils/format.js';
import { openModal } from './modal.js';
import { printSaleReceipt } from './receipt.js';
import { icon } from './icon.js';

export const SALE_STATUS_BADGE = {
  completa: '<span class="badge badge-green">Completa</span>',
  parcial: '<span class="badge badge-gold">Parcialmente estornada</span>',
  estornada: '<span class="badge badge-red">Estornada</span>',
};

/** Rótulo de uma forma de pagamento pra exibição — só mostra o número de
 * parcelas quando fizer diferença (cartão de crédito parcelado em mais de
 * 1x); à vista ou qualquer outra forma fica só o nome mesmo. Idêntico ao
 * de salesHistory.js — não importado de lá pra não criar uma dependência
 * de uma tela pra outra (cada view continua podendo evoluir sozinha). */
export function paymentMethodLabel(p) {
  const suffix = p.method === 'Cartão de crédito' && p.installments > 1 ? ` (${p.installments}x)` : '';
  return `${escapeHtml(p.method)}${suffix}`;
}

/** Abre o modal de "Ver itens" de uma venda, só-consulta. `status` é o
 * resultado de salesRepo.js#saleStatus(sale), calculado por quem chama
 * (evita esta função depender do repo só por causa de um badge). */
export function showSaleItemsModal({ sale, company, customerNameText, status }) {
  openModal({
    title: `Venda de ${formatDateTime(sale.timestamp)}`,
    submitLabel: 'Fechar',
    singleButton: true,
    wide: true,
    bodyHtml: `
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
        <button type="button" class="btn btn-secondary btn-sm" id="print-receipt-btn">${icon('printer', { size: 15 })} Imprimir recibo</button>
      </div>
      <p class="text-muted" style="font-size:13px;">
        Vendedor: <strong>${escapeHtml(sale.userName)}</strong>
        ${customerNameText ? ` · Cliente: <strong>${escapeHtml(customerNameText)}</strong>` : ''}
        · ${SALE_STATUS_BADGE[status]}
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
        printSaleReceipt(sale, company, customerNameText || null);
      });
    },
    onSubmit: () => true,
  });
}
