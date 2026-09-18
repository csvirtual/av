// Cloudflare Turnstile — CAPTCHA na tela pública de cadastro de loja
// (routes/signup.js), a única rota do sistema alcançável por QUALQUER UM
// na internet sem login, e que já tinha só uma trava de taxa por IP
// (lib/signupRateLimit.js) contra um script batendo em loop — insuficiente
// contra um ataque de verdade, que reparte as tentativas entre vários IPs.
//
// Duas chaves, geradas juntas no painel da Cloudflare (Turnstile → Add
// site): TURNSTILE_SITE_KEY (pública, o navegador carrega o widget com
// ela — exposta via GET /api/signup/config) e TURNSTILE_SECRET_KEY
// (privada, só o servidor usa, nunca sai daqui). Sem a chave secreta
// configurada, a verificação fica DESLIGADA (nunca bloqueia o cadastro só
// porque a loja não configurou ainda) — é uma decisão consciente de quem
// hospeda, documentada no README, não algo que este código force sozinho.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function isTurnstileConfigured() {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

export function getTurnstileSiteKey() {
  return process.env.TURNSTILE_SITE_KEY || null;
}

/** Confere o token que o widget gerou no navegador contra a API da
 * Cloudflare. Devolve `true`/`false` — nunca lança por token ausente ou
 * inválido (quem chama decide a mensagem de erro pro usuário); só deixa
 * escapar um erro de rede/resposta inesperada da própria Cloudflare, que
 * quem chama também trata como falha de verificação (fail-closed: uma
 * instabilidade da Cloudflare não deve virar um jeito de pular o
 * CAPTCHA). */
export async function verifyTurnstileToken(token, remoteIp) {
  if (!isTurnstileConfigured()) return true;
  if (!token || typeof token !== 'string') return false;
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
    });
    const data = await res.json();
    return !!data.success;
  } catch {
    return false;
  }
}
