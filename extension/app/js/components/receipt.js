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
// O MESMO html serve pra impressora térmica estreita (bobina de cupom,
// 58/80mm) e pra impressora comum (A4/Carta) — não é o mesmo layout: o
// CSS detecta a largura real do papel escolhido no diálogo de impressão
// (@media print and (min-width: ...) — o Chrome resolve isso contra o
// tamanho de página selecionado) e troca pra uma segunda aparência bem
// diferente, pensada pra folha inteira, com tabela de verdade e mais
// espaço. Cada item já sai em células separadas (nome/qtd/unitário/total)
// exatamente pra isso: o CSS só rearruma as mesmas células, não duplica
// conteúdo nem recalcula nada.
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

/** Número de recibo amigável pra exibição — o id de verdade da venda é um
 * UUID longo (chave interna, não pensado pra leitura humana); os 8
 * primeiros caracteres já bastam pra diferenciar duas vendas visualmente
 * num comprovante impresso, como um "número de pedido" curto. */
function shortReceiptNumber(sale) {
  return sale.id.slice(0, 8).toUpperCase();
}

function buildReceiptHtml(sale, company, customerName) {
  const address = formatAddress(company);

  const itemsHtml = sale.items.map((i) => {
    const refunded = i.qtyRefunded > 0 ? ` <span class="r-item-refunded">(${i.qtyRefunded} estornado${i.qtyRefunded > 1 ? 's' : ''})</span>` : '';
    // Com quantidade 1, unitário e total são sempre o mesmo número — no
    // cupom estreito (sem cabeçalho de coluna pra deixar claro que são
    // duas informações diferentes) isso lia como o valor repetido à toa;
    // a classe abaixo deixa o CSS escondê-lo só nesse layout. Na tabela
    // larga (A4) a coluna "Unitário" continua sempre visível — é
    // convenção normal de nota/recibo mostrar as duas colunas.
    const unitRedundant = i.qty === 1 ? ' r-cell-unit-redundant' : '';
    return `
      <div class="r-item-row">
        <div class="r-cell r-cell-name">${escapeHtml(i.name)}${refunded}</div>
        <div class="r-cell r-cell-qty">${i.qty} ${escapeHtml(i.unit)}</div>
        <div class="r-cell r-cell-unit${unitRedundant}">${formatMoney(i.unitPrice)}</div>
        <div class="r-cell r-cell-total">${formatMoney(i.lineTotal)}</div>
      </div>`;
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
      <div class="r-title-block">
        <div class="r-title">Recibo de venda</div>
        <div class="r-receipt-number">Nº ${shortReceiptNumber(sale)}</div>
      </div>
      <div class="r-small r-center r-nonfiscal">(comprovante não fiscal)</div>
      <div class="r-sep"></div>

      <div class="r-row"><span>Data</span><span>${formatDateTime(sale.timestamp)}</span></div>
      <div class="r-row"><span>Vendedor</span><span>${escapeHtml(sale.userName)}</span></div>
      ${customerName ? `<div class="r-row"><span>Cliente</span><span>${escapeHtml(customerName)}</span></div>` : ''}

      <div class="r-sep"></div>
      <div class="r-items">
        <div class="r-items-head">
          <div class="r-cell r-cell-name">Produto</div>
          <div class="r-cell r-cell-qty">Qtd.</div>
          <div class="r-cell r-cell-unit">Unitário</div>
          <div class="r-cell r-cell-total">Total</div>
        </div>
        ${itemsHtml}
      </div>
      <div class="r-sep"></div>

      <div class="r-totals">
        <div class="r-row"><span>Subtotal</span><span>${formatMoney(sale.subtotal)}</span></div>
        ${sale.itemsDiscountTotal > 0 ? `<div class="r-row"><span>Desconto nos itens</span><span>−${formatMoney(sale.itemsDiscountTotal)}</span></div>` : ''}
        ${sale.overallDiscountAmount > 0 ? `<div class="r-row"><span>Desconto geral</span><span>−${formatMoney(sale.overallDiscountAmount)}</span></div>` : ''}
        <div class="r-row r-total"><span>TOTAL</span><span>${formatMoney(sale.total)}</span></div>
      </div>

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
