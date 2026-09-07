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
// Registro de todas as instâncias abertas no momento — precisa disto (em
// vez de só `document.querySelectorAll('.custom-select.is-open')`) porque,
// enquanto aberta, a lista de cada instância mora temporariamente fora do
// próprio `.custom-select` (reparentada pro <body> — ver enhanceSelect
// abaixo), então a árvore do DOM sozinha não basta pra achar todas.
const openInstances = new Set();

function closeAll(exceptInstance = null) {
  openInstances.forEach((instance) => {
    if (instance !== exceptInstance) instance.close();
  });
}

// Um único listener pra vida inteira do app (não por instância) — evita
// vazar um listener de document a cada troca de tela, já que cada tela
// recria seus próprios elementos de filtro do zero a cada visita.
function ensureGlobalHandlers() {
  if (globalHandlersReady) return;
  globalHandlersReady = true;
  document.addEventListener('click', (e) => {
    // Fecha qualquer instância cujo clique não caiu nem no gatilho nem na
    // própria lista dela — cobre clicar fora de tudo. Clicar numa opção já
    // fecha sozinho (ver item.addEventListener('click', ...) abaixo), e
    // clicar no gatilho de uma instância fechada abre só ela (o próprio
    // listener do gatilho cuida disso antes deste rodar).
    openInstances.forEach((instance) => {
      if (!instance.wrap.contains(e.target) && !instance.list.contains(e.target)) instance.close();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });
  // A lista é `position:fixed`, calculada uma vez na abertura (ver
  // position() abaixo) — ela não acompanha o gatilho sozinha se a página
  // rolar embaixo dela. Mais simples e seguro fechar ao rolar (mesmo
  // padrão já usado em views/products.js#row-options-menu) do que tentar
  // reposicionar a cada evento de scroll.
  window.addEventListener('scroll', () => closeAll(), true);
}

const CHEVRON_SVG = '<svg class="cs-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
// Mesmo traço do ícone "close" de components/icon.js, reaproveitado aqui
// sem importar o módulo inteiro só por causa de um ícone — mesma linha
// que o resto deste arquivo já segue (CHEVRON_SVG acima).
const CLEAR_SVG = '<svg width="12" height="12" viewBox="0 0 24 24"><path d="M5.5 5.5l13 13M18.5 5.5l-13 13" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

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

  // Achado do usuário: quando a tela tinha pouco (ou nenhum) conteúdo —
  // ex: "Nenhuma conta encontrada" — a lista aberta aparecia cortada. Causa:
  // `.main` (o container de toda tela, ver styles.css) tem `overflow-x:
  // auto` pra tabelas largas rolarem na horizontal; por regra do CSS, isso
  // faz `overflow-y` virar `auto` sozinho também — então `.main` fica com
  // altura presa ao seu próprio conteúdo em fluxo normal, e uma lista
  // `position:absolute` que ultrapassa essa altura (comum quando a tela
  // está curta, com pouco conteúdo acima) fica cortada/rolando junto dela
  // em vez de flutuar por cima. É o MESMO bug de raiz já documentado e
  // corrigido em `.row-options-menu` (ver views/products.js) pro caso de
  // `.table-wrap`.
  //
  // Mesma correção aqui, com uma diferença de propósito: a lista mora
  // dentro de `wrap` (como sempre foi) enquanto fechada — pra continuar
  // sendo limpa sozinha quando a tela troca (`container.innerHTML = ...`
  // de cada view derruba `wrap` e tudo dentro dele, sem precisar de nenhum
  // cleanup manual) — e só é REPARENTADA pro `<body>`, virando
  // `position:fixed` calculada na hora (ver position()), enquanto está
  // aberta. Diferente do menu "Opções" (criado do zero a cada clique e
  // removido ao fechar), aqui a mesma lista é reaproveitada — mover ela
  // de volta pra `wrap` em close() é mais barato que recriar do zero a
  // cada abertura, e dá no mesmo resultado (zero sobra no body).
  const list = document.createElement('div');
  list.className = 'custom-select-list';
  list.setAttribute('role', 'listbox');

  // Achado do usuário: sem nenhum jeito rápido de saber "esse filtro não
  // tá no padrão" nem de voltar pra lá sem abrir a lista de novo e catar
  // a primeira opção manualmente. A 1ª <option> de todo filtro do app já é
  // sempre o "sem filtro" (Todos os status, Todas as categorias, Pagar e
  // receber…) — por convenção, nunca precisou de configuração extra pra
  // saber qual é. Este botão só aparece quando a seleção atual NÃO é essa
  // primeira opção, e volta pra ela com um clique.
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'custom-select-clear';
  clearBtn.title = 'Limpar filtro';
  clearBtn.setAttribute('aria-label', 'Limpar filtro');
  clearBtn.hidden = true;
  clearBtn.innerHTML = CLEAR_SVG;
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // não abre/fecha o trigger nem conta como clique "fora"
    if (select.selectedIndex === 0) return;
    select.selectedIndex = 0;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncFromSelect();
    close();
  });

  wrap.appendChild(trigger);
  wrap.appendChild(clearBtn);
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
    clearBtn.hidden = select.selectedIndex <= 0;
  }

  /** Calcula a posição fixa da lista a partir do gatilho — mesmo raciocínio
   * de `left = rect.right - menu.offsetWidth` já usado e comentado em
   * views/products.js#openOptionsMenuFor (evita a armadilha de
   * window.innerWidth contar a barra de rolagem e o containing block de
   * position:fixed não contar). Reabre pra CIMA do gatilho se nasceria
   * cortada embaixo da janela. */
  function position() {
    const rect = trigger.getBoundingClientRect();
    list.style.width = `${rect.width}px`;
    list.style.left = `${rect.left}px`;
    list.style.top = `${rect.bottom + 4}px`;
    if (list.getBoundingClientRect().bottom > window.innerHeight) {
      list.style.top = `${rect.top - list.offsetHeight - 4}px`;
    }
  }

  function open() {
    closeAll(instance);
    wrap.classList.add('is-open');
    document.body.appendChild(list); // reparenta pra fora do overflow de .main — ver comentário acima
    list.classList.add('is-open');
    position();
    setActive(select.selectedIndex, true);
    openInstances.add(instance);
  }

  function close() {
    wrap.classList.remove('is-open');
    list.classList.remove('is-open');
    wrap.appendChild(list); // volta pra dentro do wrap — ver comentário acima
    activeIndex = -1;
    openInstances.delete(instance);
  }

  function isOpen() { return list.classList.contains('is-open'); }

  const instance = { wrap, list, close };

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
