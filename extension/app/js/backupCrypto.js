// Criptografia do arquivo de backup: deriva uma chave AES-256-GCM a partir
// da senha de backup via PBKDF2 (a mesma técnica do auth.js pra senha de
// login), com salt e IV novos e aleatórios a cada exportação. Sem a senha
// certa, o arquivo é só um monte de bytes ilegíveis — e não tem "esqueci
// minha senha" aqui, porque não existe servidor pra confirmar quem você é:
// é o preço aceitável de um backup 100% local e privado.
const ITERATIONS = 150000;

function bufToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function deriveKey(password, saltBuf, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuf, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Criptografa um objeto qualquer com uma senha, devolvendo o envelope
 * pronto pra virar o arquivo de backup. Salt/IV/iterações ficam em claro no
 * envelope — são material criptográfico, não segredo em si; o conteúdo de
 * verdade só existe dentro do ciphertext. */
export async function encryptPayload(payload, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt.buffer, ITERATIONS);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload)));
  return {
    salt: bufToBase64(salt.buffer),
    iv: bufToBase64(iv.buffer),
    iterations: ITERATIONS,
    ciphertext: bufToBase64(ciphertext),
  };
}

/** Decripta um envelope gerado por encryptPayload. Lança erro se a senha
 * estiver errada ou o arquivo estiver corrompido — a checagem de
 * autenticidade do AES-GCM garante isso: não existe "decriptou errado
 * silenciosamente" aqui, ou dá certo com os dados originais intactos, ou
 * falha alto e claro. Usa as iterações gravadas no próprio envelope (não a
 * constante local) pra continuar lendo backups antigos mesmo se esse
 * número mudar no futuro. */
export async function decryptPayload(envelope, password) {
  const salt = base64ToBuf(envelope.salt);
  const iv = base64ToBuf(envelope.iv);
  const key = await deriveKey(password, salt, envelope.iterations || ITERATIONS);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBuf(envelope.ciphertext));
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plainBuf));
}
