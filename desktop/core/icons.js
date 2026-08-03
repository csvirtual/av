// Ícones compartilhados entre main.js e os apps (evita import circular, já
// que main.js importa os apps — um app não pode importar de volta de
// main.js).
//
// A Lixeira já teve duas variantes (cheia/vazia) em SVG, mas o visual da
// versão "cheia" não agradou — voltou a ser um ícone único e simples, sem
// indicar se tem itens dentro ou não (o parâmetro fica só por compatibilidade
// com quem já chama esta função passando hasItems).
export function trashGlyph(_hasItems) {
  return '🗑️';
}

// Ícone da pasta "Usuários" — duas pessoas (é plural), desenhado em SVG de
// propósito em vez de usar um emoji: o mesmo caractere (ex.: 👥) é desenhado
// de um jeito diferente por cada fabricante/versão de Android, podendo sair
// azul, colorido ou em outro estilo qualquer — um SVG garante a mesma cor e
// o mesmo desenho em qualquer aparelho, sempre.
export const USERS_GLYPH = `<svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true">
  <circle cx="20.5" cy="10" r="4.2" fill="#6b6975"/>
  <path d="M13.5 27c0.3-4.9 3.3-8 7.3-8 3.5 0 6.3 2.6 7.1 6.6-0.9 0.9-2 1.4-3.3 1.4Z" fill="#6b6975"/>
  <circle cx="11.5" cy="12" r="5" fill="#55555f"/>
  <path d="M3 27c0-5.2 3.6-8.8 8.5-8.8s8.5 3.6 8.5 8.8Z" fill="#55555f"/>
</svg>`;

// Ícone de "Copiar" desenhado em SVG pelo mesmo motivo do USERS_GLYPH acima:
// o emoji 🗐 (U+1F5D0) não tem glyph em vários Android/Chrome — aparece como
// caractere ausente (quadrado com X) em vez do ícone de páginas sobrepostas.
export const COPY_GLYPH = `<svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true">
  <rect x="12" y="3" width="16" height="20" rx="2.5" fill="#8a8a96" stroke="#6b6b76" stroke-width="1"/>
  <rect x="4" y="9" width="16" height="20" rx="2.5" fill="#55555f" stroke="#3f3f47" stroke-width="1"/>
  <line x1="8" y1="15" x2="16" y2="15" stroke="#c3c3cc" stroke-width="1.4"/>
  <line x1="8" y1="19" x2="16" y2="19" stroke="#c3c3cc" stroke-width="1.4"/>
  <line x1="8" y1="23" x2="14" y2="23" stroke="#c3c3cc" stroke-width="1.4"/>
</svg>`;
