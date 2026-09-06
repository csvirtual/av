// Ícones em SVG colorido no lugar de emoji — achado do usuário: emoji
// "novos" (lançados no Unicode a partir de ~2016) dependem da fonte de
// emoji do sistema operacional pra desenhar; num Windows sem a atualização
// certa (build antiga, versão Server, ou Update represado por política de
// TI — comum em computador de caixa de loja, que não é atualizado com
// frequência) o navegador não acha o glifo e mostra um quadrado vazio no
// lugar. Já rolou de verdade com o ícone do Carreto (🛻). SVG embutido não
// depende de fonte nenhuma — o próprio navegador desenha, então não tem
// como faltar. As cores de cada ícone foram escolhidas pra ficar parecido
// com o emoji original (em vez de monocromático), por pedido do usuário —
// então, ao contrário de um ícone currentColor, aqui a cor não muda com o
// tema claro/escuro nem com o estado ativo do item de menu.
const PATHS = {
  home: '<path d="M3 11l9-8 9 8" fill="none" stroke="#8d6e63" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10v10h14V10z" fill="#fff3d6" stroke="#c9a227" stroke-width="1"/><path d="M10 20v-6h4v6z" fill="#8d4e2a"/>',
  box: '<path d="M3 7l9-4 9 4-9 4-9-4z" fill="#e0b385" stroke="#a9723f" stroke-width="1" stroke-linejoin="round"/><path d="M3 7v10l9 4 9-4V7" fill="#c98a4b" stroke="#a9723f" stroke-width="1" stroke-linejoin="round"/><path d="M12 11v10" stroke="#8a5a2b" stroke-width="1.5"/>',
  receipt: '<path d="M6 2h12v19l-2.5-1.5L13 21l-1-1.5-1 1.5-2.5-1.5L6 21V2z" fill="#ffffff" stroke="#6b7280" stroke-width="1.3" stroke-linejoin="round"/><line x1="9" y1="7" x2="15" y2="7" stroke="#6b7280" stroke-width="1.2"/><line x1="9" y1="11" x2="15" y2="11" stroke="#6b7280" stroke-width="1.2"/>',
  chart: '<rect x="3" y="14" width="3" height="6" rx="0.5" fill="#4c8bf5"/><rect x="8.3" y="9" width="3" height="11" rx="0.5" fill="#f4a428"/><rect x="13.6" y="12" width="3" height="8" rx="0.5" fill="#34a853"/><rect x="18.9" y="5" width="3" height="15" rx="0.5" fill="#ea4335"/>',
  cash: '<rect x="2" y="7" width="20" height="13" rx="2" fill="#2f3b52"/><rect x="2" y="7" width="20" height="3" rx="1" fill="#465774"/><circle cx="12" cy="14.5" r="3" fill="#f4c542" stroke="#c9971f" stroke-width=".6"/>',
  user: '<circle cx="12" cy="8" r="4" fill="#f4c27a"/><path d="M4.5 21v-1.5A5.5 5.5 0 0110 14h4a5.5 5.5 0 015.5 5.5V21z" fill="#5b7fdb"/>',
  truck: '<rect x="1" y="8" width="13" height="8" rx="1" fill="#e4e8ec" stroke="#6b7280" stroke-width="1.1"/><path d="M14 11h4l3 3v2h-7z" fill="#e2574c" stroke="#b23b31" stroke-width=".6"/><circle cx="5.5" cy="18" r="1.8" fill="#2b2f36"/><circle cx="17.5" cy="18" r="1.8" fill="#2b2f36"/>',
  cart: '<path d="M2 3h3l2.4 12.2a2 2 0 002 1.8h8.2a2 2 0 002-1.7L21 8H6" fill="none" stroke="#5c6773" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="20" r="1.5" fill="#5c6773"/><circle cx="17" cy="20" r="1.5" fill="#5c6773"/>',
  dollar: '<circle cx="12" cy="12" r="10" fill="#2e8b57"/><text x="12" y="16.5" font-size="12" font-weight="700" fill="#fff" text-anchor="middle" font-family="Arial, sans-serif">$</text>',
  trending: '<polyline points="3,17 9,11 13,15 21,6" fill="none" stroke="#2e8b57" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="15,6 21,6 21,12" fill="none" stroke="#2e8b57" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  users: '<circle cx="9" cy="8" r="3" fill="#f4c27a"/><path d="M3 20v-1a5 5 0 015-5h2a5 5 0 015 5v1z" fill="#5b7fdb"/><circle cx="18" cy="9" r="2.3" fill="#f4c27a"/><path d="M16 20v-.8a4 4 0 013-3.9" fill="none" stroke="#e2574c" stroke-width="2" stroke-linecap="round"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2" fill="#ffffff" stroke="#6b7280" stroke-width="1.1"/><path d="M9 3h6a1 1 0 011 1v1H8V4a1 1 0 011-1z" fill="#8a94a3"/><line x1="8" y1="10" x2="16" y2="10" stroke="#6b7280" stroke-width="1"/><line x1="8" y1="14" x2="16" y2="14" stroke="#6b7280" stroke-width="1"/><line x1="8" y1="18" x2="13" y2="18" stroke="#6b7280" stroke-width="1"/>',
  store: '<path d="M3 9l1-5h16l1 5z" fill="#e2574c"/><path d="M5 9v11h14V9z" fill="#f0d9a8" stroke="#c9a860" stroke-width=".8"/><rect x="10" y="14" width="4" height="6" fill="#5b3a1e"/>',
  save: '<path d="M5 3h11l4 4v13a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" fill="#2b4c8c"/><path d="M8 3v5h8V3z" fill="#d9d9d9"/><rect x="7" y="13" width="10" height="7" fill="#eef1f5"/>',
  palette: '<path d="M12 2a10 10 0 000 20 2 2 0 002-2 1.6 1.6 0 00-.5-1.1 1.6 1.6 0 01-.5-1.1 1.6 1.6 0 011.6-1.6H16a4 4 0 004-4c0-5.5-4.5-10-8-10z" fill="#c98a4b"/><circle cx="7" cy="12" r="1.3" fill="#e2574c"/><circle cx="8.5" cy="8" r="1.3" fill="#f4c542"/><circle cx="13" cy="6.5" r="1.3" fill="#4c8bf5"/><circle cx="17" cy="9" r="1.3" fill="#34a853"/>',
  question: '<circle cx="12" cy="12" r="10" fill="#6c5ce7"/><path d="M9.5 9a2.5 2.5 0 015 .3c0 1.8-2.5 1.7-2.5 3.7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="17" x2="12" y2="17.1" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>',
  printer: '<rect x="4" y="8" width="16" height="8" rx="1.3" fill="#9aa2ac" stroke="#6b7280" stroke-width=".6"/><path d="M7 8V4h10v4" fill="none" stroke="#6b7280" stroke-width="1.4" stroke-linejoin="round"/><rect x="7" y="13" width="10" height="7" fill="#ffffff" stroke="#6b7280" stroke-width="1"/><circle cx="17" cy="10.5" r=".9" fill="#34a853"/>',
  warning: '<path d="M12 2.5l10.2 18H1.8L12 2.5z" fill="#f4a428" stroke="#c9841f" stroke-width=".6" stroke-linejoin="round"/><path d="M12 10v4.2" stroke="#2b2f36" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1" fill="#2b2f36"/>',
  lock: '<rect x="4" y="10.5" width="16" height="10" rx="1.8" fill="#8a94a3"/><path d="M7.5 10.5V7a4.5 4.5 0 019 0v3.5" fill="none" stroke="#5c6773" stroke-width="2"/><circle cx="12" cy="15" r="1.6" fill="#5c6773"/>',
  download: '<path d="M12 3v11" stroke="#4c8bf5" stroke-width="2.4" stroke-linecap="round"/><path d="M7 10l5 5 5-5" fill="none" stroke="#4c8bf5" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 19h16" stroke="#2e8b57" stroke-width="2.4" stroke-linecap="round"/>',
  trash: '<path d="M4 7h16" stroke="#8a94a3" stroke-width="2" stroke-linecap="round"/><path d="M9 7V4h6v3" fill="none" stroke="#8a94a3" stroke-width="1.6"/><path d="M6 7l1 13h10l1-13z" fill="#c9ced6" stroke="#8a94a3" stroke-width="1"/><path d="M10 11v6M14 11v6" stroke="#8a94a3" stroke-width="1.4" stroke-linecap="round"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5" fill="#4a5568"/><rect x="5" y="6" width="14" height="8" fill="#4c8bf5"/><path d="M8 20h8M12 16v4" stroke="#4a5568" stroke-width="1.8" stroke-linecap="round"/>',
  sun: '<circle cx="12" cy="12" r="4.3" fill="#f4a428"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="#f4a428" stroke-width="2" stroke-linecap="round"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z" fill="#f4d35e" stroke="#d9b83f" stroke-width=".5"/>',
  flag: '<path d="M5 3v18" stroke="#5c6773" stroke-width="2" stroke-linecap="round"/><path d="M5 4h13l-2.5 4L18 12H5z" fill="#ffffff" stroke="#2b2f36" stroke-width=".6" stroke-linejoin="round"/><path d="M7.2 4h2.4v3.2H7.2zM11.9 4h2.4v3.2h-2.4zM9.6 7.2H12v3.2H9.6zM14.3 7.2h2.2l-1 2-1.2-.4z" fill="#2b2f36"/>',
  key: '<circle cx="8" cy="15" r="4.2" fill="none" stroke="#f4c542" stroke-width="2.4"/><path d="M11 12l9-9M16 7l3 3M13 10l2.5 2.5" fill="none" stroke="#c9971f" stroke-width="2.4" stroke-linecap="round"/>',
  undo: '<path d="M7 9H4V5" fill="none" stroke="#4c8bf5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 9C7 5.7 10.7 4 14 4.6c3.8.7 6.6 4 6.6 7.7 0 4-3.2 7.2-7.2 7.2-2.8 0-5.3-1.6-6.5-4" fill="none" stroke="#4c8bf5" stroke-width="2.2" stroke-linecap="round"/>',
  moneybag: '<path d="M9 4h6l1.6 3.4H7.4z" fill="#a9723f"/><path d="M7.4 7.4h9.2c2 3 2.9 5.4 2.9 7.6a6 6 0 01-12 0c0-2.2.9-4.6 2.9-7.6z" fill="#c98a4b" stroke="#8a5a2b" stroke-width=".8"/><text x="12" y="16.5" font-size="8.5" font-weight="700" fill="#fff3d6" text-anchor="middle" font-family="Arial, sans-serif">$</text>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2" fill="#5b7fdb" stroke="#3f5cb0" stroke-width=".8"/><rect x="2" y="8.5" width="20" height="3" fill="#2b2f36"/><rect x="5" y="14.5" width="6" height="2" rx=".6" fill="#f4c542"/>',
  checkCircle: '<circle cx="12" cy="12" r="10" fill="#2e8b57"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  refresh: '<path d="M4 4v5h5" fill="none" stroke="#4c8bf5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 20v-5h-5" fill="none" stroke="#4c8bf5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 9a7 7 0 0112.4-3M18.5 15a7 7 0 01-12.4 3" fill="none" stroke="#4c8bf5" stroke-width="2.2" stroke-linecap="round"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2.5h8.5A1.5 1.5 0 0121 9v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18V6.5z" fill="#e0b385" stroke="#a9723f" stroke-width=".8" stroke-linejoin="round"/><path d="M3 9h18" stroke="#c98a4b" stroke-width=".8"/>',
  hourglass: '<rect x="4" y="2.5" width="16" height="2" rx="1" fill="#8a5a2b"/><rect x="4" y="19.5" width="16" height="2" rx="1" fill="#8a5a2b"/><path d="M6 4.5h12l-5.2 7.5L18 19.5H6l5.2-7.5z" fill="#f4c542" stroke="#c9971f" stroke-width=".8" stroke-linejoin="round"/><path d="M9.5 6.5h5L12 11z" fill="#e8b93a"/>',
  // whatsapp/mail usam gradiente (não flat como os demais, por pedido do
  // usuário — mais refinado pros botões de contato do bloqueio de trial)
  // — por isso são função, não string: cada chamada de icon() precisa de
  // um id de <linearGradient> ÚNICO (ver uid abaixo), senão dois ícones
  // do mesmo tipo na mesma tela colidiriam no mesmo id e o navegador
  // resolveria os dois pro primeiro <defs> encontrado no DOM.
  whatsapp: (id) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#32D96A"/><stop offset="100%" stop-color="#1EAE53"/></linearGradient></defs><circle cx="12" cy="12" r="10" fill="url(#${id})"/><path d="M12 5.3a6.7 6.7 0 00-5.72 10.15L5.4 18.7l3.34-.88A6.7 6.7 0 1012 5.3z" fill="#fff"/><path d="M9.06 8.4c.24-.53.49-.54.72-.55.19-.01.4-.01.58.01.2.02.47-.08.73.55.28.65.92 2.27 1 2.43.09.17.14.36.02.57-.11.22-.17.34-.33.53-.17.19-.35.42-.5.57-.17.17-.34.35-.15.68.2.34.88 1.44 1.89 2.33 1.3 1.15 2.39 1.51 2.73 1.68.34.17.54.15.74-.08.2-.24.86-1 1.09-1.34.23-.34.47-.28.78-.17.32.12 2.02.95 2.36 1.12.34.17.56.26.65.4.08.15.08.85-.2 1.66-.29.82-1.64 1.6-2.29 1.68-.58.08-1.3.11-2.1-.14-.48-.15-1.09-.35-1.88-.69-3.31-1.43-5.47-4.77-5.64-5-.17-.22-1.35-1.79-1.35-3.42 0-1.63.85-2.42 1.15-2.75z" fill="#1EAE53"/>`,
  mail: (id) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6EA8FF"/><stop offset="100%" stop-color="#3F7FF0"/></linearGradient></defs><rect x="2" y="4" width="20" height="16" rx="4.5" fill="url(#${id})"/><path d="M2.6 6.3l8.75 6.9c.38.3.92.3 1.3 0l8.75-6.9" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,

  // arrowLeft/arrowRight/check/close/menu são ícones de INTERFACE (setas de
  // paginação/voltar, "selecionado", remover, menu mobile) — diferente do
  // resto do arquivo, esses usam currentColor de propósito: precisam se
  // misturar com o texto ao lado (dentro de um <button>, herdando a cor do
  // botão) e funcionar igual em qualquer tema/estado de hover, o que uma
  // cor fixa não daria. Substituem ← → ✓ ✕ ☰ digitados como caractere —
  // achado do usuário mapeando os símbolos restantes depois da troca de
  // emoji por SVG: mesmo esses sendo glifo comum (não emoji colorido, sem o
  // risco de quadrado vazio), pediu consistência visual com o resto do app.
  arrowLeft: '<path d="M14.5 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowRight: '<path d="M9.5 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M4 12.5l5.5 5.5L20 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M5.5 5.5l13 13M18.5 5.5l-13 13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  fullscreen: '<path d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  fullscreenExit: '<path d="M9 4v3a1 1 0 01-1 1H5M15 4v3a1 1 0 001 1h3M9 20v-3a1 1 0 00-1-1H5M15 20v-3a1 1 0 011-1h3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><line x1="16.2" y1="16.2" x2="21" y2="21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
};

// Contador só pra gerar id de <linearGradient> único por chamada (ver
// whatsapp/mail acima) — não precisa ser mais sofisticado que isso, um
// simples incremento já garante unicidade dentro da mesma página.
let gradUid = 0;

/** Devolve o SVG inline pronto pra colar no HTML. `size` em px (padrão
 * 18). Cada ícone já vem com a cor própria embutida (não usa currentColor
 * — ver comentário acima), então funciona igual em qualquer fundo, claro
 * ou escuro. */
export function icon(name, { size = 18 } = {}) {
  const raw = PATHS[name];
  if (!raw) throw new Error(`Ícone "${name}" não existe.`);
  const inner = typeof raw === 'function' ? raw(`icon-grad-${gradUid++}`) : raw;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="vertical-align:-3px;flex-shrink:0;">${inner}</svg>`;
}
