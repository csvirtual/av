// Formatação de telefone brasileiro: celular (11 dígitos) vira
// "(xx) x xxxx-xxxx" — com o "9" isolado por espaço, como o padrão adotado
// desde que a Anatel unificou os números de celular em 9 dígitos — e fixo
// (10 dígitos) vira "(xx) xxxx-xxxx", sem esse dígito extra pra isolar.
import { onlyDigits } from './format.js';

export function formatPhoneBR(value) {
  const d = onlyDigits(value).slice(0, 11);
  const len = d.length;
  if (len === 0) return '';
  if (len <= 2) return `(${d}`;
  if (len <= 10) {
    // Ainda pode virar celular (11 dígitos) ou já é fixo (10) — trata como
    // fixo enquanto digita; se o 11º dígito chegar, o bloco abaixo reflui
    // pro agrupamento de celular (com o espaço depois do primeiro "9").
    const ddd = d.slice(0, 2);
    const rest = d.slice(2);
    if (rest.length <= 4) return `(${ddd}) ${rest}`;
    return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  const ddd = d.slice(0, 2);
  const firstDigit = d.slice(2, 3);
  const rest = d.slice(3);
  return `(${ddd}) ${firstDigit} ${rest.slice(0, 4)}-${rest.slice(4)}`;
}
