// Formatação e validação de CEP brasileiro: sempre 8 dígitos, exibido como
// "xxxxx-xxx". Só confere a quantidade de dígitos — não dá
// pra validar se o CEP existe de verdade sem consultar um serviço externo,
// e o sistema não faz chamada nenhuma pra fora.
import { onlyDigits } from './format.js';

export function formatCep(value) {
  const d = onlyDigits(value).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function isValidCep(value) {
  return onlyDigits(value).length === 8;
}
