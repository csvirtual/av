// Fase 8 (segurança): mesma cifra da extensão (app/js/backupWorker.js) —
// PBKDF2-SHA256 pra derivar a chave da senha + AES-GCM pra cifrar. Web
// Crypto API pura (crypto.subtle), disponível globalmente no Node 22+, sem
// precisar de worker_threads: o servidor não trava uma "aba" — no pior caso
// atrasa a resposta desta única requisição, aceitável pro tamanho de dados
// de uma loja usando este sistema. Buffer.from(...).toString('base64')
// substitui o FileReader/data-URI que o navegador precisava.
const ITERATIONS = 150000;

async function deriveKey(password, salt, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Cifra `payload` (qualquer objeto serializável) com `password`, devolvendo
 * o envelope pronto pra virar o arquivo de backup (mesmo formato da
 * extensão — um backup gerado por um funciona no outro). */
export async function encryptPayload(payload, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload)));
  return {
    app: 'gestao-de-loja-estoque-vendas',
    salt: Buffer.from(salt).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    iterations: ITERATIONS,
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  };
}

/** Decifra um envelope com a senha informada. Lança erro se a senha estiver
 * errada ou o arquivo estiver corrompido — a checagem de autenticidade do
 * AES-GCM garante isso: não existe "decriptou errado silenciosamente", ou
 * dá certo com os dados originais intactos, ou falha alto e claro. Usa as
 * iterações gravadas no próprio envelope, não uma constante local, pra
 * continuar lendo backups antigos mesmo se esse número mudar no futuro. */
export async function decryptPayload(envelope, password) {
  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const key = await deriveKey(password, salt, envelope.iterations || ITERATIONS);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plainBuf));
}
