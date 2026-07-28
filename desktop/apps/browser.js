// Navegador simplificado: como é uma janela dentro do próprio site, só
// consegue exibir páginas que permitem ser incorporadas em outro site
// (a maioria dos grandes bloqueia isso por segurança, ex: X-Frame-Options).
// Quando bloquear, o usuário pode abrir numa aba de verdade do navegador.
export function openBrowser(ctx, { url } = {}) {
  const { windows } = ctx;

  const root = document.createElement('div');
  root.className = 'browser-app';
  root.innerHTML = `
    <div class="browser-toolbar">
      <button data-action="back" title="Voltar">←</button>
      <button data-action="forward" title="Avançar">→</button>
      <button data-action="reload" title="Recarregar">↻</button>
      <input type="text" class="browser-address" data-role="address" placeholder="Pesquisar ou digitar um endereço da Web">
      <button data-action="go" title="Ir">Ir</button>
      <button data-action="newtab" title="Abrir numa aba de verdade">⤴</button>
    </div>
    <div class="browser-hint">Alguns sites bloqueiam ser exibidos dentro de outro app (proteção do próprio site) — use ⤴ pra abrir numa aba de verdade.</div>
    <iframe class="browser-frame" data-role="frame" referrerpolicy="no-referrer"></iframe>
  `;

  const win = windows.createWindow({
    appId: 'browser',
    title: 'Navegador',
    icon: '🌐',
    width: 760,
    height: 500,
    content: root,
  });

  const frame = root.querySelector('[data-role="frame"]');
  const address = root.querySelector('[data-role="address"]');
  const history = [];
  let historyIndex = -1;

  function normalize(input) {
    const v = (input || '').trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(v)) return `https://${v}`;
    return `https://www.bing.com/search?q=${encodeURIComponent(v)}`;
  }

  function navigate(input, pushHistory = true) {
    const url = normalize(input);
    if (!url) return;
    address.value = url;
    frame.src = url;
    if (pushHistory) {
      history.splice(historyIndex + 1);
      history.push(url);
      historyIndex = history.length - 1;
    }
  }

  root.querySelector('[data-action="go"]').addEventListener('click', () => navigate(address.value));
  address.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigate(address.value);
  });
  root.querySelector('[data-action="reload"]').addEventListener('click', () => {
    frame.src = frame.src;
  });
  root.querySelector('[data-action="back"]').addEventListener('click', () => {
    if (historyIndex > 0) {
      historyIndex--;
      navigate(history[historyIndex], false);
    }
  });
  root.querySelector('[data-action="forward"]').addEventListener('click', () => {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      navigate(history[historyIndex], false);
    }
  });
  root.querySelector('[data-action="newtab"]').addEventListener('click', () => {
    const target = normalize(address.value);
    if (target) window.open(target, '_blank', 'noopener');
  });

  navigate(url || 'https://www.wikipedia.org', true);
  return win;
}
