// Autenticação local: hashing de senha com PBKDF2 (Web Crypto), sem nenhum
// envio pra fora — tudo fica no IndexedDB deste navegador. Isso protege
// contra acesso casual, mas não é um cofre: quem tem acesso ao profile do
// Chrome consegue inspecionar o IndexedDB da extensão. É o compromisso
// aceitável para um sistema local de controle de loja, não um banco digital.
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
 * vaze, por timing, quantos caracteres do início já bateram. Baixo risco
 * real aqui (é tudo local, sem rede), mas é troca de graça: mesmo
 * resultado, mesmo custo, sem esse canal lateral. */
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
