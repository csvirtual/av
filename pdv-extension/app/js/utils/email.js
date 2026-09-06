// Validação de formato de e-mail (usuário@domínio.tld) — só o formato, não
// dá pra confirmar que o endereço existe de verdade sem enviar algo pra ele,
// e o sistema não faz chamada nenhuma pra fora.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return EMAIL_RE.test((value || '').trim());
}
