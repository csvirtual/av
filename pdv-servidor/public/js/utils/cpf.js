// Validação e formatação de CPF (algoritmo padrão dos dígitos verificadores
// — mesmo usado pela Receita Federal). Sem chamada externa nenhuma: tudo
// verificado localmente. Mesmo esqueleto de utils/cnpj.js.
import { onlyDigits } from './format.js';

export function formatCpf(value) {
  const d = onlyDigits(value).slice(0, 11);
  let out = d;
  if (d.length > 3) out = `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length > 6) out = `${out.slice(0, 7)}.${out.slice(7)}`;
  if (d.length > 9) out = `${out.slice(0, 11)}-${out.slice(11)}`;
  return out;
}

function calcDigit(digits, weights) {
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCpf(value) {
  const d = onlyDigits(value);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false; // todos os dígitos iguais

  const digits = d.split('').map(Number);
  const w1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calcDigit(digits.slice(0, 9), w1);
  if (d1 !== digits[9]) return false;

  const d2 = calcDigit(digits.slice(0, 10), w2);
  if (d2 !== digits[10]) return false;

  return true;
}
