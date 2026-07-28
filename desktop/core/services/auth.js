// Hashing de senha no cliente com PBKDF2 (Web Crypto). Isto protege a
// interface contra acesso casual, mas não é segurança de nível de sistema
// operacional: quem acessar os dados do navegador (IndexedDB) pode ver o
// hash. Não use isto para proteger dados realmente sensíveis.
import { kv } from '../state/kv-store.js';

const ITERATIONS = 150000;

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes.buffer;
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

export async function hasPassword() {
  return !!(await kv.get('auth.hash'));
}

export async function setPassword(password) {
  const salt = bufToHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const hash = await deriveHash(password, salt);
  await kv.set('auth.salt', salt);
  await kv.set('auth.hash', hash);
}

export async function verifyPassword(password) {
  const salt = await kv.get('auth.salt');
  const hash = await kv.get('auth.hash');
  if (!salt || !hash) return false;
  const attempt = await deriveHash(password, salt);
  return attempt === hash;
}

export async function changePassword(oldPassword, newPassword) {
  const ok = await verifyPassword(oldPassword);
  if (!ok) return false;
  await setPassword(newPassword);
  return true;
}

export async function getHint() {
  return kv.get('auth.hint', '');
}

export async function setHint(hint) {
  await kv.set('auth.hint', hint);
}
