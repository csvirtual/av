// Web Worker (módulo) dedicada à geração/leitura do backup — ver
// backupCrypto.js. Achado de auditoria (medido ao vivo, não só hipótese,
// em duas rodadas): a primeira tentativa de corrigir o travamento da aba
// durante o backup automático do fechamento de caixa só moveu a
// cifra/JSON.stringify pra uma worker comum, mas ainda montava o objeto
// gigante (todas as vendas etc.) na THREAD PRINCIPAL antes de mandar pra
// cá — e o próprio `postMessage` de um objeto grande e aninhado já
// custa um clone síncrono proporcional ao tamanho, do lado de quem envia.
// Com 100 mil vendas isso sozinho já travava a aba por ~2,3s. A correção
// de verdade: esta worker abre sua PRÓPRIA conexão com o IndexedDB (ver
// import de db.js abaixo — funciona igual dentro de uma worker) e lê os
// dados ELA MESMA, então nada grande cruza de main→worker (só a senha,
// que é minúscula). Na volta, devolve um Blob já pronto pra virar o
// arquivo (não uma string) — Blob é passado por referência entre
// contextos, não copiado byte a byte, então a volta worker→main também
// não trava nada. O resultado: a thread principal nunca vê o backup
// inteiro, só o Blob final pronto pra download.
import { dbGetAll, STORE_NAMES } from './db.js';

const ITERATIONS = 150000;
// Mesmo valor da constante de mesmo nome em data/backupRepo.js — duplicada
// aqui (em vez de importada) de propósito: importar backupRepo.js aqui
// carregaria o módulo inteiro (e tudo que ele importa, users/produtos/etc.)
// só pra pegar um número inteiro.
const BACKUP_FORMAT_VERSION = 1;

function bufToBase64(buf) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('Falha ao codificar o backup.'));
    reader.readAsDataURL(new Blob([buf]));
  });
}

async function base64ToBuf(b64) {
  const res = await fetch(`data:application/octet-stream;base64,${b64}`);
  return res.arrayBuffer();
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

/** Lê todos os stores do IndexedDB (aqui dentro, não na thread principal),
 * cifra e devolve um Blob já pronto pra virar o arquivo de backup. */
async function buildBackupBlob(password) {
  const stores = {};
  for (const name of STORE_NAMES) stores[name] = await dbGetAll(name);
  const payload = { backupFormatVersion: BACKUP_FORMAT_VERSION, exportedAt: new Date().toISOString(), stores };

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt.buffer, ITERATIONS);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload)));
  const [saltB64, ivB64, ciphertextB64] = await Promise.all([
    bufToBase64(salt.buffer),
    bufToBase64(iv.buffer),
    bufToBase64(ciphertext),
  ]);
  const envelope = {
    app: 'gestao-de-loja-estoque-vendas',
    salt: saltB64,
    iv: ivB64,
    iterations: ITERATIONS,
    ciphertext: ciphertextB64,
  };
  return new Blob([JSON.stringify(envelope)], { type: 'application/json' });
}

async function decryptPayload(envelope, password) {
  const [salt, iv, ciphertext] = await Promise.all([
    base64ToBuf(envelope.salt),
    base64ToBuf(envelope.iv),
    base64ToBuf(envelope.ciphertext),
  ]);
  const key = await deriveKey(password, salt, envelope.iterations || ITERATIONS);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plainBuf));
}

self.onmessage = async (ev) => {
  const { id, op, password, envelope } = ev.data;
  try {
    let result;
    if (op === 'buildBackupBlob') result = { blob: await buildBackupBlob(password) };
    else if (op === 'decrypt') result = { payload: await decryptPayload(envelope, password) };
    else throw new Error(`Operação desconhecida: ${op}`);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
