// Command palette (Ctrl/Cmd+K, spec §33/§34). A short static action list plus
// an always-present "ask the AI" entry — free-text goes straight to
// ai/planner.js::runCommand, so the palette doubles as the universal command
// input without needing its own NLU.
import { escapeHtml } from './codegen/sanitize.js';

export function createCommandPalette(root, input, resultsEl, { getActions, onRun }) {
  let activeIndex = 0;
  let items = [];

  function open() {
    root.hidden = false;
    input.value = '';
    input.focus();
    renderResults();
  }
  function close() {
    root.hidden = true;
  }

  function renderResults() {
    const query = input.value.trim();
    const actions = getActions().filter((a) => !query || a.label.toLowerCase().includes(query.toLowerCase()));
    items = query ? [{ id: '__ai__', label: `Perguntar à IA: "${query}"`, run: () => onRun(query) }, ...actions] : actions;
    activeIndex = 0;
    resultsEl.innerHTML = items
      .map((item, i) => `<li class="av-palette__item${i === activeIndex ? ' is-active' : ''}" role="option" data-index="${i}">${escapeHtml(item.label)}</li>`)
      .join('');
  }

  function move(delta) {
    if (!items.length) return;
    activeIndex = (activeIndex + delta + items.length) % items.length;
    [...resultsEl.children].forEach((el, i) => el.classList.toggle('is-active', i === activeIndex));
  }

  function runActive() {
    const item = items[activeIndex];
    if (item) {
      close();
      item.run();
    }
  }

  input.addEventListener('input', renderResults);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runActive(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  resultsEl.addEventListener('click', (e) => {
    const li = e.target.closest('[data-index]');
    if (!li) return;
    activeIndex = Number(li.dataset.index);
    runActive();
  });
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      root.hidden ? open() : close();
    }
  });

  return { open, close };
}
