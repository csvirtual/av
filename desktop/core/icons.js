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
  <circle cx="20.5" cy="10" r="4.2" fill="#8a8a96"/>
  <path d="M13.5 27c0.3-4.9 3.3-8 7.3-8 3.5 0 6.3 2.6 7.1 6.6-0.9 0.9-2 1.4-3.3 1.4Z" fill="#8a8a96"/>
  <circle cx="11.5" cy="12" r="5" fill="#55555f"/>
  <path d="M3 27c0-5.2 3.6-8.8 8.5-8.8s8.5 3.6 8.5 8.8Z" fill="#55555f"/>
</svg>`;
