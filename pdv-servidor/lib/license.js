// Verificação de chave de ativação (assinatura assimétrica ECDSA P-256) —
// porta quase literal de pdv-extension/app/js/license.js pro servidor, com
// a MESMA chave pública (o gerador da chave privada, fora deste repositório,
// já existe e continua funcionando sem mudar nada). A chave é gerada FORA
// deste sistema, por uma ferramenta local separada — nunca a chave PRIVADA
// entra aqui, só a PÚBLICA (não é secreta), usada só para CONFERIR.
//
// Portado quase sem alteração porque o Node (desde a v19, e confirmado
// nesta instalação) já tem `crypto.subtle`/`atob`/`TextEncoder`/
// `TextDecoder` globais, exatamente como no navegador — a mesma chave JWK
// importa e verifica igual dos dois lados.
const PUBLIC_KEY_JWK = {
  crv: 'P-256', ext: true, key_ops: ['verify'], kty: 'EC',
  x: 'D3W9wRCk6bnu6W_LMM7fdPlF_BwmZZCJQqc-sqhkqY0',
  y: 'Dz2omm8yelVZT9DG1ZtdeBnlGoRpJE15J2WFOlgBomY',
};

// Diferente da extensão (1h, valor de demonstração/teste do código-fonte):
// aqui é o período de teste de verdade oferecido a uma loja nova — 7 dias
// dá tempo real de operar alguns dias inteiros (caixa, vendas, fechamento)
// antes de decidir.
export const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

function b64urlToBuf(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

let cachedPublicKey = null;
async function getPublicKey() {
  if (!cachedPublicKey) {
    cachedPublicKey = await crypto.subtle.importKey('jwk', PUBLIC_KEY_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  }
  return cachedPublicKey;
}

/** Confere uma chave de ativação contra o CNPJ desta loja. Nunca lança —
 * sempre devolve { valid, reason } (reason só quando valid é false), pra
 * quem chama não precisar de try/catch pra um caso totalmente esperado
 * (alguém colou algo errado). Mesmo contrato exato de license.js da
 * extensão. */
export async function verifyLicenseKey(keyString, cnpj) {
  try {
    const raw = (keyString || '').trim();
    const parts = raw.split('.');
    if (parts.length !== 2) return { valid: false, reason: 'Chave em formato inválido.' };
    const [payloadB64, sigB64] = parts;

    const payloadBuf = b64urlToBuf(payloadB64);
    const payload = JSON.parse(new TextDecoder().decode(payloadBuf));

    const publicKey = await getPublicKey();
    const sigBuf = b64urlToBuf(sigB64);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      sigBuf,
      new TextEncoder().encode(payloadB64),
    );
    if (!ok) return { valid: false, reason: 'Chave inválida — assinatura não confere.' };

    if (payload.cnpj !== cnpj) {
      return { valid: false, reason: 'Essa chave não corresponde ao CNPJ cadastrado nesta loja.' };
    }
    if (payload.expiraEm && new Date(payload.expiraEm).getTime() < Date.now()) {
      return { valid: false, reason: payload.tipo === 'cnpj-unlock' ? 'Esse código de liberação já expirou. Peça um novo.' : 'Essa chave já expirou. Peça uma nova chave.' };
    }

    return { valid: true, tipo: payload.tipo, expiraEm: payload.expiraEm || null };
  } catch (e) {
    return { valid: false, reason: 'Chave em formato inválido.' };
  }
}
