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
