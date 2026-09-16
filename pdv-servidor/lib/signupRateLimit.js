// Etapa 9 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// cadastro self-service é a única rota do sistema inteiro alcançável por
// QUALQUER UM na internet, sem login nenhum, e que CRIA um banco novo no
// disco — precisa de alguma trava contra abuso trivial (um script batendo
// em loop), mesmo que simples. Mesmo estilo de lib/loginLockout.js: Map em
// memória do processo (efêmero, não entra em backup, não sobrevive a um
// restart — proporcional ao risco: isto não protege dinheiro nem dado de
// ninguém, só limita quantas lojas vazias um único IP consegue criar por
// hora).
//
// Achado de limitação conhecida (documentado, não corrigido nesta etapa):
// o servidor não habilita `trust proxy` (ver server.js — decisão de
// propósito, documentada lá, porque nada mais lia req.ip até agora) —
// atrás de um proxy reverso comum (Nginx, Cloudflare) sem esse cabeçalho
// configurado, todo pedido chega com o MESMO IP (o do proxy), e o limite
// abaixo passa a valer pro tráfego inteiro, não por visitante real. Quem
// hospedar isto atrás de um proxy precisa decidir e configurar
// `trust proxy` conscientemente (não é escopo deste código decidir sozinho
// — mudaria o que `req.ip`/`req.secure` significam em TODO o resto do
// servidor, não só aqui).
const WINDOW_MS = 60 * 60 * 1000; // 1h
const MAX_SIGNUPS_PER_WINDOW = 5;

const state = new Map(); // ip -> { count, windowStart }

export function checkSignupRateLimit(ip) {
  const key = ip || 'unknown';
  const now = Date.now();
  const entry = state.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    state.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (entry.count >= MAX_SIGNUPS_PER_WINDOW) {
    return { allowed: false, remainingMs: WINDOW_MS - (now - entry.windowStart) };
  }
  entry.count += 1;
  return { allowed: true };
}

export { WINDOW_MS, MAX_SIGNUPS_PER_WINDOW };
