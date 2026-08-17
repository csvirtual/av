// Validação e formatação de CNPJ (algoritmo padrão dos dígitos verificadores
// — mesmo usado pela Receita Federal). Sem chamada externa nenhuma: tudo
// verificado localmente.
export function onlyDigits(str) {
  return (str || '').replace(/\D/g, '');
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

function calcDigit(digits, weights) {
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCnpj(value) {
  const d = onlyDigits(value);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false; // todos os dígitos iguais

  const digits = d.split('').map(Number);
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calcDigit(digits.slice(0, 12), w1);
  if (d1 !== digits[12]) return false;

  const d2 = calcDigit(digits.slice(0, 13), w2);
  if (d2 !== digits[13]) return false;

  return true;
}
