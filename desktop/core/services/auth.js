// Hashing de senha no cliente com PBKDF2 (Web Crypto) — isso valida a senha
// digitada, mas por si só protege só contra acesso casual: quem tiver
// acesso ao IndexedDB deste navegador consegue ver o hash. O que de fato
// protege os ARQUIVOS gravados é a criptografia em repouso feita por
// core/services/crypto.js, cuja chave (DEK) é desembrulhada aqui embaixo
// sempre que a senha é confirmada com sucesso.
import { kv } from '../state/kv-store.js';
import {
  generateDek, generateSalt, wrapDek, unwrapDek,
  bytesToB64, b64ToBytes, setSessionDek, getSessionDek, clearSessionDek,
} from './crypto.js';

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

async function storeWrappedDek(dek, password) {
  const dekSalt = generateSalt();
  const wrapped = await wrapDek(dek, password, dekSalt);
  await kv.set('auth.dekSalt', bytesToB64(dekSalt));
  await kv.set('auth.wrappedDek', wrapped);
}

/** Cria a senha E uma DEK nova pra cifrar os arquivos desta conta — usado na
 * criação de uma conta nova e na redefinição via e-mail (que, por não
 * conhecer a senha antiga, não tem como recuperar a DEK antiga; ver o
 * comentário no topo de crypto.js). Pra trocar de senha SEM perder acesso
 * aos arquivos já cifrados, use changePasswordKnowingOld. */
export async function setPassword(password) {
  const salt = bufToHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const hash = await deriveHash(password, salt);
  await kv.set('auth.salt', salt);
  await kv.set('auth.hash', hash);

  const dek = await generateDek();
  await storeWrappedDek(dek, password);
  setSessionDek(dek);
}

/** Desembrulha a DEK desta conta com a senha já confirmada e carrega na
 * sessão atual. Instalações de antes da criptografia de arquivos existir
 * não têm `auth.wrappedDek` ainda — nesse caso cria uma DEK nova agora
 * mesmo (não perde nada, já que nenhum arquivo daquela conta foi cifrado
 * antes disso existir). */
async function unlockDek(password) {
  const dekSaltB64 = await kv.get('auth.dekSalt');
  const wrapped = await kv.get('auth.wrappedDek');
  if (!dekSaltB64 || !wrapped) {
    const dek = await generateDek();
    await storeWrappedDek(dek, password);
    setSessionDek(dek);
    return;
  }
  try {
    const dek = await unwrapDek(wrapped, password, b64ToBytes(dekSaltB64));
    setSessionDek(dek);
  } catch {
    // Não deveria acontecer (a senha já foi validada pelo hash acima) —
    // mas se acontecer, não deixa uma DEK de outra sessão/conta vazando.
    clearSessionDek();
  }
}

export async function verifyPassword(password) {
  const salt = await kv.get('auth.salt');
  const hash = await kv.get('auth.hash');
  if (!salt || !hash) return false;
  const attempt = await deriveHash(password, salt);
  const ok = attempt === hash;
  if (ok) await unlockDek(password);
  return ok;
}

/** Troca de senha SABENDO a senha atual: preserva a mesma DEK (só
 * re-embrulha com a senha nova), então os arquivos já cifrados continuam
 * legíveis — ao contrário de setPassword(), que gera uma DEK nova. */
export async function changePasswordKnowingOld(oldPassword, newPassword) {
  const ok = await verifyPassword(oldPassword);
  if (!ok) return false;
  const dek = getSessionDek();
  const salt = bufToHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const hash = await deriveHash(newPassword, salt);
  await kv.set('auth.salt', salt);
  await kv.set('auth.hash', hash);
  if (dek) await storeWrappedDek(dek, newPassword);
  return true;
}

export async function getEmail() {
  return kv.get('auth.email', '');
}

export async function setEmail(email) {
  await kv.set('auth.email', (email || '').trim());
}

/** Confirma que o e-mail informado bate com o cadastrado — só quem sabe
 * qual e-mail foi usado no cadastro consegue redefinir a senha. Não existe
 * envio real de e-mail aqui: é só uma verificação local (não há backend). */
export async function verifyEmail(email) {
  const stored = await getEmail();
  if (!stored) return false;
  return stored.toLowerCase() === (email || '').trim().toLowerCase();
}

/** Redefine a senha sem conhecer a antiga (fluxo "Esqueci minha senha").
 * Gera uma DEK nova de propósito — sem a senha antiga não tem como
 * recuperar a que cifrava os arquivos já salvos, então eles ficam
 * ilegíveis a partir daqui (o mesmo compromisso de qualquer disco cifrado
 * de verdade). A tela que chama isso avisa isso claramente antes. */
export async function resetPasswordWithEmail(email, newPassword) {
  const ok = await verifyEmail(email);
  if (!ok) return false;
  await setPassword(newPassword);
  return true;
}
