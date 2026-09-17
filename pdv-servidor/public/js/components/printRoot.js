// Mecânica de impressão compartilhada entre o recibo de venda
// (receipt.js) e o relatório em PDF (reportPrint.js): os dois usam a
// impressão nativa do navegador escondendo o conteúdo num elemento fixo
// que só aparece em @media print (ver styles.css) — sem abrir aba nova.
//
// Achado de auditoria original: como o CSS de impressão mostra TODOS os
// print-roots ao mesmo tempo (de propósito, pra não precisar saber de
// antemão qual vai ser usado), se um recibo já tivesse sido impresso
// antes na mesma sessão e depois alguém imprimisse um relatório, o root
// do recibo ficava com HTML antigo parado lá e aparecia sobreposto. Por
// isso: sempre esvazia os OUTROS print-roots antes de imprimir o atual.
const PRINT_ROOT_IDS = ['print-receipt-root', 'print-report-root'];

export function printFromRoot(rootId, html) {
  let root = document.getElementById(rootId);
  if (!root) {
    root = document.createElement('div');
    root.id = rootId;
    document.body.appendChild(root);
  }
  root.innerHTML = html;
  for (const otherId of PRINT_ROOT_IDS) {
    if (otherId === rootId) continue;
    const otherRoot = document.getElementById(otherId);
    if (otherRoot) otherRoot.innerHTML = '';
  }
  window.print();
}
