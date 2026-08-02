// Ícones compartilhados entre main.js e os apps (evita import circular, já
// que main.js importa os apps — um app não pode importar de volta de
// main.js). Por enquanto só a Lixeira, que precisa mudar de aparência
// conforme tem ou não itens dentro (feature genuína do Windows).
export const TRASH_EMPTY_GLYPH = `<svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true">
  <rect x="11" y="6" width="10" height="2.2" rx="0.6" fill="#8a94a3"/>
  <rect x="8.5" y="7.6" width="15" height="2.4" rx="1" fill="#aab2bf"/>
  <path d="M10 10.5h12l-1.1 15.3c-0.1 1.3-1.2 2.2-2.5 2.2h-4.8c-1.3 0-2.4-0.9-2.5-2.2L10 10.5Z" fill="#c3cad4"/>
  <path d="M10 10.5h12l-0.4 5.6h-11.2Z" fill="#aab2bf"/>
  <rect x="13.2" y="13.5" width="1.4" height="11" rx="0.7" fill="#8a94a3"/>
  <rect x="17.4" y="13.5" width="1.4" height="11" rx="0.7" fill="#8a94a3"/>
</svg>`;

export const TRASH_FULL_GLYPH = `<svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true">
  <rect x="11" y="6" width="10" height="2.2" rx="0.6" fill="#8a94a3"/>
  <rect x="8.3" y="7.6" width="15.4" height="2.4" rx="1" fill="#aab2bf" transform="rotate(-4 16 8.8)"/>
  <path d="M10 11h12l-1.1 15.3c-0.1 1.3-1.2 2.2-2.5 2.2h-4.8c-1.3 0-2.4-0.9-2.5-2.2L10 11Z" fill="#c3cad4"/>
  <path d="M10 11h12l-0.4 5.6h-11.2Z" fill="#aab2bf"/>
  <rect x="13.2" y="14" width="1.4" height="11" rx="0.7" fill="#8a94a3"/>
  <rect x="17.4" y="14" width="1.4" height="11" rx="0.7" fill="#8a94a3"/>
  <path d="M13 6.5c-1.5-2.2-0.3-4.6 1.8-4.9 1.6-0.2 2.2 1.1 1.3 2-0.7 0.7-0.2 1.6 0.8 1.4 1.6-0.3 2.6 1 1.9 2.3-0.5 1-2 1.3-3.2 1.1-1-0.2-2-0.8-2.6-1.9Z" fill="#eef1f5"/>
</svg>`;

export function trashGlyph(hasItems) {
  return hasItems ? TRASH_FULL_GLYPH : TRASH_EMPTY_GLYPH;
}
