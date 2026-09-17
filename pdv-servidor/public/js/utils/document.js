// Campo único que aceita CPF (pessoa física) ou CNPJ (pessoa jurídica) —
// usado em Clientes e Fornecedores, onde o cadastro pode ser de qualquer um
// dos dois. Decide o formato pela quantidade de dígitos enquanto digita: até
// 11 vira CPF (xxx.xxx.xxx-xx), mais que isso vira CNPJ (xx.xxx.xxx/xxxx-xx).
import { formatCpf, isValidCpf } from './cpf.js';
import { formatCnpj, isValidCnpj } from './cnpj.js';
import { onlyDigits } from './format.js';

export function formatCpfOrCnpj(value) {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length <= 11) return formatCpf(d);
  return formatCnpj(d);
}

export function isValidCpfOrCnpj(value) {
  const d = onlyDigits(value);
  if (d.length === 11) return isValidCpf(d);
  if (d.length === 14) return isValidCnpj(d);
  return false;
}
