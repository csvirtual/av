// Cópia BYTE-A-BYTE de app/js/auth.js (extensão) — de propósito. É Web
// Crypto API pura (crypto.subtle, crypto.getRandomValues), sem nada
// específico de navegador, e o Node 22+ expõe a mesma API globalmente. Isso
// garante que o hash de senha gerado aqui é 100% compatível com o gerado
// pela extensão single-machine — uma senha criada num modo funciona no
// outro, sem conversão nenhuma, se um dia precisar migrar uma loja de um
// modo pro outro.
const ITERATIONS = 150000;

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes.buffer;
}

function randomSaltHex() {
  return bufToHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

async function deriveHash(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBuf(saltHex), iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bufToHex(bits);
}

/** Gera { salt, hash } para gravar num usuário novo ou numa redefinição de senha. */
export async function hashPassword(password) {
  const salt = randomSaltHex();
  const hash = await deriveHash(password, salt);
  return { salt, hash };
}

/** Compara duas strings de tamanho igual em tempo constante (não para no
 * primeiro caractere diferente) — evita que uma comparação `===` simples
 * vaze, por timing, quantos caracteres do início já bateram. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Confere a senha digitada contra o salt/hash gravados do usuário. */
export async function verifyPasswordHash(password, salt, hash) {
  if (!salt || !hash) return false;
  const attempt = await deriveHash(password, salt);
  return timingSafeEqual(attempt, hash);
}
