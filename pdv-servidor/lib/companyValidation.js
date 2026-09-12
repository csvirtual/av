// Validação/formatação dos dados cadastrais da loja (CNPJ, CEP, e-mail) —
// usado só em routes/company.js. Mesma lógica de public/js/utils/cnpj.js/
// cep.js/email.js (a extensão validava isso na tela; aqui precisa validar
// de novo no SERVIDOR, que é quem grava de verdade — nunca confia só na
// tela, mesmo princípio já usado em toda rota deste sistema). Arquivo
// próprio do servidor (não um import de public/js/) porque os dois lados
// rodam em ambientes diferentes (browser vs Node) e este projeto já separa
// assim em outros casos (ver lib/pricing.js vs public/js/utils/pricing.js).

export function onlyDigits(str) {
  return String(str || '').replace(/\D/g, '');
}

export function formatCnpj(value) {
  const d = onlyDigits(value).slice(0, 14);
  let out = d;
  if (d.length > 2) out = `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length > 5) out = `${out.slice(0, 6)}.${out.slice(6)}`;
  if (d.length > 8) out = `${out.slice(0, 10)}/${out.slice(10)}`;
  if (d.length > 12) out = `${out.slice(0, 15)}-${out.slice(15)}`;
  return out;
}

function calcCnpjDigit(digits, weights) {
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCnpj(value) {
  const d = onlyDigits(value);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const digits = d.split('').map(Number);
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calcCnpjDigit(digits.slice(0, 12), w1);
  if (d1 !== digits[12]) return false;
  const d2 = calcCnpjDigit(digits.slice(0, 13), w2);
  if (d2 !== digits[13]) return false;
  return true;
}

export function formatCep(value) {
  const d = onlyDigits(value).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function isValidCep(value) {
  return onlyDigits(value).length === 8;
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}
