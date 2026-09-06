// Dropdown próprio pros <select> de filtro do topo das telas de lista —
// achado do usuário: no Linux, a lista aberta de um <select> nativo é
// desenhada pelo toolkit do sistema operacional, não pela página. Ela
// ignora completamente o CSS do app (cores, tema claro/escuro) e até o
// modo escuro do próprio navegador — sempre abre com fundo branco e letra
// preta, o que fica ilegível encostado no resto da tela escura. Não tem
// jeito de consertar isso só com CSS (confirmado: nem `color-scheme: dark`
// nem forçar dark mode no Chromium mudam essa lista). A única forma
// confiável de controlar a cor é desenhar a lista aberta com HTML/CSS
// próprio no lugar do popup nativo.
//
// O <select> original nunca sai do DOM — só fica escondido (display:none).
// Ele continua sendo a fonte de verdade do valor: escolher uma opção aqui
// só faz `select.value = ...` e dispara um 'change' nele, então qualquer
// código de tela que já escuta 'change' no select (todo filtro da
// extensão) continua funcionando sem precisar mudar nada.

let globalHandlersReady = false;

function closeAll(exceptWrap = null) {
  document.querySelectorAll('.custom-select.is-open').forEach((wrap) => {
    if (wrap !== exceptWrap) wrap.classList.remove('is-open');
  });
}

// Um único listener pra vida inteira do app (não por instância) — evita
// vazar um listener de document a cada troca de tela, já que cada tela
// recria seus próprios elementos de filtro do zero a cada visita.
function ensureGlobalHandlers() {
  if (globalHandlersReady) return;
  globalHandlersReady = true;
  document.addEventListener('click', (e) => {
    const openWrap = e.target.closest('.custom-select.is-open');
    if (!openWrap) closeAll();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });
}

const CHEVRON_SVG = '<svg class="cs-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

/** Troca a lista aberta de um <select> por uma versão estilizada com os
 * tokens do app. Idempotente — chamar de novo no mesmo <select> não faz
 * nada. */
export function enhanceSelect(select) {
  if (!select || select.dataset.customSelectReady === '1') return;
  select.dataset.customSelectReady = '1';
  ensureGlobalHandlers();

  const wrap = document.createElement('div');
  wrap.className = 'custom-select';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.style.display = 'none';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  const label = document.createElement('span');
  label.className = 'custom-select-label';
  trigger.appendChild(label);
  trigger.insertAdjacentHTML('beforeend', CHEVRON_SVG);

  const list = document.createElement('div');
  list.className = 'custom-select-list';
  list.setAttribute('role', 'listbox');

  wrap.appendChild(trigger);
  wrap.appendChild(list);

  let activeIndex = -1;

  function options() { return Array.from(list.children); }

  function buildList() {
    list.innerHTML = '';
    Array.from(select.options).forEach((opt, idx) => {
      const item = document.createElement('div');
      item.className = 'custom-select-option';
      item.setAttribute('role', 'option');
      item.dataset.index = String(idx);
      item.textContent = opt.textContent;
      item.addEventListener('mouseenter', () => setActive(idx, false));
      item.addEventListener('click', () => {
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncFromSelect();
        close();
        trigger.focus();
      });
      list.appendChild(item);
    });
  }

  function setActive(idx, scroll) {
    activeIndex = idx;
    options().forEach((el, i) => el.classList.toggle('is-active', i === idx));
    if (scroll) {
      const el = options()[idx];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }

  function syncFromSelect() {
    const opt = select.options[select.selectedIndex];
    label.textContent = opt ? opt.textContent : '';
    options().forEach((el, i) => el.classList.toggle('is-selected', i === select.selectedIndex));
  }

  function open() {
    closeAll(wrap);
    wrap.classList.add('is-open');
    setActive(select.selectedIndex, true);
  }

  function close() {
    wrap.classList.remove('is-open');
    activeIndex = -1;
  }

  function isOpen() { return wrap.classList.contains('is-open'); }

  trigger.addEventListener('click', () => { isOpen() ? close() : open(); });

  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isOpen()) { open(); return; }
      if (e.key === 'Enter' || e.key === ' ') {
        const el = options()[activeIndex];
        if (el) el.click();
        return;
      }
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = Math.min(Math.max(activeIndex + delta, 0), options().length - 1);
      setActive(next, true);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  // Reconstrói a lista se o código da tela mudar as <option> do <select>
  // depois do enhance (ex: Log do sistema monta o filtro de usuários a
  // partir de uma lista carregada async).
  const observer = new MutationObserver(() => { buildList(); syncFromSelect(); });
  observer.observe(select, { childList: true });

  buildList();
  syncFromSelect();
}
