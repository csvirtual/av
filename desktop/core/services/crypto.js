// Criptografia de dados em repouso: o conteúdo de arquivos
// (core/state/filesystem.js) é cifrado com AES-256-GCM usando uma "chave de
// dados" (DEK) aleatória de 256 bits, gerada uma vez por conta. A DEK em si
// nunca é gravada em claro — fica "embrulhada" (wrapped, também AES-GCM) por
// uma "chave de senha" (KEK) derivada da senha do usuário via PBKDF2. É o
// mesmo esquema de envelope usado por BitLocker/LUKS/a maioria dos discos
// cifrados de verdade, e existe justamente pra separar duas coisas que não
// podem compartilhar a mesma chave: o valor usado pra VERIFICAR a senha
// (auth.hash, em auth.js) e o valor usado pra DECIFRAR os arquivos — se o
// hash de autenticação vazasse sozinho, ele não serviria pra decifrar nada.
//
// Consequência real e intencional (a mesma de qualquer disco cifrado de
// verdade): trocar a senha SABENDO a senha antiga apenas re-embrulha a
// mesma DEK (rápido, não recifra nenhum arquivo). Já "Esqueci minha senha"
// (redefinição via e-mail) não tem como recuperar a DEK antiga sem ela — os
// arquivos gravados antes da redefinição ficam permanentemente ilegíveis.
// Isso é avisado explicitamente na tela antes de confirmar (ver main.js).
const AES_ALG = 'AES-GCM';
const AES_LENGTH = 256;
const PBKDF2_ITERATIONS = 150000;

export function bytesToB64(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

export function b64ToBytes(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

async function deriveKek(password, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: AES_ALG, length: AES_LENGTH },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/** Gera uma DEK nova (extraível só o suficiente pra poder ser embrulhada
 * logo em seguida — nunca é exportada em texto puro fora de wrapDek). */
export async function generateDek() {
  return crypto.subtle.generateKey({ name: AES_ALG, length: AES_LENGTH }, true, ['encrypt', 'decrypt']);
}

export async function wrapDek(dek, password, saltBytes) {
  const kek = await deriveKek(password, saltBytes);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: AES_ALG, iv });
  return { iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(wrapped)) };
}

/** Desembrulha a DEK com a senha informada. Lança se a senha estiver errada
 * (a tag de autenticação do AES-GCM não bate) — quem chama deve tratar isso
 * como "senha incorreta", não deixar vazar como erro genérico. */
export async function unwrapDek(wrappedObj, password, saltBytes) {
  const kek = await deriveKek(password, saltBytes);
  const iv = b64ToBytes(wrappedObj.iv);
  const data = b64ToBytes(wrappedObj.data);
  return crypto.subtle.unwrapKey(
    'raw', data, kek, { name: AES_ALG, iv },
    { name: AES_ALG, length: AES_LENGTH },
    // Precisa ser extraível: trocar de senha (changePasswordKnowingOld, em
    // auth.js) re-embrulha esta mesma DEK de sessão com a senha nova, e
    // wrapKey só funciona em cima de uma chave extraível. Isso não abre
    // brecha nova de verdade — quem já tem execução de JS na página
    // consegue os mesmos dados chamando encryptText/decryptText direto,
    // com ou sem a chave sendo extraível.
    true,
    ['encrypt', 'decrypt']
  );
}

/** Cifra um texto com a DEK. O resultado é um objeto plano (serializável no
 * IndexedDB) com IV aleatório por chamada — nunca reusa IV com a mesma
 * chave, que quebraria a segurança do GCM. */
export async function encryptText(dek, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt({ name: AES_ALG, iv }, dek, enc.encode(plaintext));
  return { __enc: 1, iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(cipherBuf)) };
}

export async function decryptText(dek, payload) {
  const iv = b64ToBytes(payload.iv);
  const data = b64ToBytes(payload.data);
  const plainBuf = await crypto.subtle.decrypt({ name: AES_ALG, iv }, dek, data);
  return new TextDecoder().decode(plainBuf);
}

// ---------- Chave da sessão atual ----------
// Só existe em memória (nunca é persistida) — é recarregada a cada
// login/desbloqueio bem-sucedido (verifyPassword em auth.js) e apagada ao
// bloquear a tela ou sair da conta, pra não ficar disponível enquanto o
// dispositivo está bloqueado.
let sessionDek = null;
export function setSessionDek(dek) { sessionDek = dek; }
export function getSessionDek() { return sessionDek; }
export function clearSessionDek() { sessionDek = null; }
