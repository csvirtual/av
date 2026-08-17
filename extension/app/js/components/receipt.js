// Recibo de venda para impressão. Usa a impressão nativa do navegador — o
// mesmo diálogo de "Imprimir" do Chrome — em vez de qualquer integração
// direta com impressora: funciona com QUALQUER impressora já instalada no
// sistema operacional (térmica de cupom, comum, em rede), sem driver nem
// permissão extra nenhuma, e já oferece "Salvar como PDF" nativamente. É
// o jeito mais compatível de imprimir a partir de uma extensão 100% local.
//
// Técnica: o conteúdo do recibo fica num elemento escondido
// (#print-receipt-root) o tempo todo; @media print (ver styles.css) some
// com todo o resto da página e mostra só ele na hora de imprimir de
// verdade — não abre aba nova nem popup.
//
// Importante: isto é um RECIBO/comprovante de venda, não um documento
// fiscal (a extensão não emite NFe/NFC-e — decisão de escopo assumida
// desde o início do projeto). O recibo deixa isso explícito pro
// lojista não usá-lo como se fosse cupom fiscal.
import { formatMoney, formatDateTime, escapeHtml } from '../utils/format.js';

function formatAddress(company) {
  const e = company?.endereco || {};
  const parts = [
    [e.logradouro, e.numero].filter(Boolean).join(', '),
    e.complemento,
    e.bairro,
    [e.cidade, e.uf].filter(Boolean).join('/'),
    e.cep,
  ].filter(Boolean);
  return parts.join(' — ');
}

function buildReceiptHtml(sale, company, customerName) {
  const address = formatAddress(company);
  const itemsHtml = sale.items.map((i) => {
    const refunded = i.qtyRefunded > 0 ? ` <span class="r-item-refunded">(${i.qtyRefunded} estornado${i.qtyRefunded > 1 ? 's' : ''})</span>` : '';
    return `
      <tr>
        <td colspan="3" class="r-item-name">${escapeHtml(i.name)}${refunded}</td>
      </tr>
      <tr>
        <td class="r-item-qty">${i.qty} ${escapeHtml(i.unit)} × ${formatMoney(i.unitPrice)}</td>
        <td></td>
        <td class="r-item-total">${formatMoney(i.lineTotal)}</td>
      </tr>`;
  }).join('');

  const paymentsHtml = sale.payments.map((p) => {
    const installments = p.method === 'Cartão de crédito' && p.installments > 1 ? ` (${p.installments}x)` : '';
    return `<div class="r-row"><span>${escapeHtml(p.method)}${installments}</span><span>${formatMoney(p.amount)}</span></div>`;
  }).join('');

  const refundsHtml = sale.refunds && sale.refunds.length > 0 ? `
    <div class="r-sep"></div>
    <div class="r-section-title">Estornos</div>
    ${sale.refunds.map((r) => `
      <div class="r-row"><span>${formatDateTime(r.timestamp)}</span><span>−${formatMoney(r.totalRefunded)}</span></div>
      <div class="r-small">${escapeHtml(r.reason)}</div>
    `).join('')}
  ` : '';

  return `
    <div class="receipt">
      <div class="r-header">
        <div class="r-store-name">${escapeHtml(company?.nomeFantasia || 'Loja')}</div>
        ${company?.razaoSocial ? `<div class="r-small">${escapeHtml(company.razaoSocial)}</div>` : ''}
        ${company?.cnpj ? `<div class="r-small">CNPJ: ${escapeHtml(company.cnpj)}</div>` : ''}
        ${address ? `<div class="r-small">${escapeHtml(address)}</div>` : ''}
        ${company?.telefone ? `<div class="r-small">Tel: ${escapeHtml(company.telefone)}</div>` : ''}
      </div>

      <div class="r-sep"></div>
      <div class="r-title">Recibo de venda</div>
      <div class="r-small r-center">(comprovante não fiscal)</div>
      <div class="r-sep"></div>

      <div class="r-row"><span>Data</span><span>${formatDateTime(sale.timestamp)}</span></div>
      <div class="r-row"><span>Vendedor</span><span>${escapeHtml(sale.userName)}</span></div>
      ${customerName ? `<div class="r-row"><span>Cliente</span><span>${escapeHtml(customerName)}</span></div>` : ''}

      <div class="r-sep"></div>
      <table class="r-items">
        <tbody>${itemsHtml}</tbody>
      </table>
      <div class="r-sep"></div>

      <div class="r-row"><span>Subtotal</span><span>${formatMoney(sale.subtotal)}</span></div>
      ${sale.itemsDiscountTotal > 0 ? `<div class="r-row"><span>Desconto nos itens</span><span>−${formatMoney(sale.itemsDiscountTotal)}</span></div>` : ''}
      ${sale.overallDiscountAmount > 0 ? `<div class="r-row"><span>Desconto geral</span><span>−${formatMoney(sale.overallDiscountAmount)}</span></div>` : ''}
      <div class="r-row r-total"><span>TOTAL</span><span>${formatMoney(sale.total)}</span></div>

      <div class="r-sep"></div>
      <div class="r-section-title">Pagamento</div>
      ${paymentsHtml}

      ${refundsHtml}

      <div class="r-sep"></div>
      <div class="r-small r-center">Obrigado pela preferência!</div>
    </div>
  `;
}

/** Imprime o recibo de uma venda — abre direto o diálogo de impressão do
 * navegador (imprimir de verdade ou salvar em PDF são a mesma ação: o
 * usuário escolhe o "destino" no próprio diálogo do Chrome). */
export function printSaleReceipt(sale, company, customerName) {
  let root = document.getElementById('print-receipt-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-receipt-root';
    document.body.appendChild(root);
  }
  root.innerHTML = buildReceiptHtml(sale, company, customerName);
  window.print();
}
