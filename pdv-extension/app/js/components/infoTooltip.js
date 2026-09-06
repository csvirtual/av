// Ícone "?" pequeno ao lado de um label, que abre um texto de apoio ao
// clicar — usado hoje só no aviso legal do campo CNPJ (setup.js e
// company.js), mas escrito genérico (id + conteúdo por fora) pra servir
// de novo em qualquer outro campo que precise do mesmo padrão depois.
import { icon } from './icon.js';

export function infoTooltipHtml(id, ariaLabel, bodyHtml) {
  return `
    <button type="button" class="info-tip-btn" data-info-tip="${id}" aria-label="${ariaLabel}">?</button>
    <div class="info-tip-popover" id="${id}" hidden>${bodyHtml}</div>
  `;
}

// Fecha ao clicar fora — ligado uma única vez no documento (não a cada
// render), pra não empilhar um listener novo toda vez que a tela é
// redesenhada (setup.js e company.js substituem o innerHTML inteiro a
// cada renderização).
let outsideClickBound = false;
function ensureOutsideClickHandler() {
  if (outsideClickBound) return;
  outsideClickBound = true;
  document.addEventListener('click', (e) => {
    if (e.target.closest('.info-tip-btn') || e.target.closest('.info-tip-popover')) return;
    document.querySelectorAll('.info-tip-popover:not([hidden])').forEach((p) => { p.hidden = true; });
  });
}

// Chamar depois de colocar o HTML de infoTooltipHtml() na tela. Os botões
// em si são recriados a cada render (fazem parte do innerHTML substituído),
// então os listeners deles não se acumulam — só o handler de "clicar fora"
// precisa da proteção acima.
export function initInfoTooltips(container) {
  ensureOutsideClickHandler();
  container.querySelectorAll('[data-info-tip]').forEach((btn) => {
    const popover = container.querySelector(`#${btn.dataset.infoTip}`);
    if (!popover) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wasOpen = !popover.hidden;
      container.querySelectorAll('.info-tip-popover').forEach((p) => { p.hidden = true; });
      popover.hidden = wasOpen;
    });
  });
}

export const CNPJ_LEGAL_NOTICE_HTML = `
  <strong>Depois de salvo não poderá ser alterado.</strong>
  <p>O CNPJ cadastrado aqui identifica esta loja em todo o sistema — aparece nas notas, nos recibos, nos relatórios e é usado para ativar a licença deste programa.</p>
  <p>Errou ao digitar? Fale com o suporte para corrigir.</p>
  <p>${icon('warning', { size: 15 })} Cadastrar um CNPJ que não é desta empresa — inclusive para usar uma chave de ativação obtida de forma indevida — pode configurar falsidade ideológica (Código Penal, art. 299) e estelionato (art. 171). Distribuir ou repassar chaves de ativação a terceiros, por qualquer meio online ou offline, também é crime (Lei do Software, Lei 9.609/1998, art. 12).</p>
  <p class="info-tip-disclaimer">Aviso informativo, não substitui orientação jurídica.</p>
`;
