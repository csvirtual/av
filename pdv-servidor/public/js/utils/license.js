// Verificação de código de liberação de CNPJ, do lado do CLIENTE — só pra
// destravar o CAMPO na tela na hora (mesma UX da extensão: cola o código,
// clica "Destravar", o campo libera pra editar), sem persistir nada. A
// gravação de verdade (routes/company.js#PUT) confere o mesmo token de
// novo, no servidor — nunca confia só nesta checagem daqui (mesmo
// princípio de sempre: a tela pode ficar mais rápida/melhor com uma
// checagem otimista, mas nunca é ela quem decide de verdade).
//
// Mesma chave pública de lib/license.js (servidor) e da extensão — o
// gerador da chave privada continua sendo o mesmo, sem nenhuma mudança.
const PUBLIC_KEY_JWK = {
  crv: 'P-256', ext: true, key_ops: ['verify'], kty: 'EC',
  x: 'D3W9wRCk6bnu6W_LMM7fdPlF_BwmZZCJQqc-sqhkqY0',
  y: 'Dz2omm8yelVZT9DG1ZtdeBnlGoRpJE15J2WFOlgBomY',
};

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

/** Mesmo contrato de verifyLicenseKey() em lib/license.js (servidor) e na
 * extensão — nunca lança, sempre `{ valid, reason }`. */
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
