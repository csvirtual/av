// Ponte pra worker que gera/lê o backup — ver backupWorker.js pro porquê:
// gerar (JSON.stringify de dezenas de MB, cifrar) e ler um backup grande
// (loja com anos de histórico) são operações pesadas demais pra thread
// principal sem travar a aba. A worker abre sua própria conexão com o
// banco e faz tudo lá dentro; daqui só entra/sai o mínimo (senha, e um
// Blob já pronto — Blob cruza por referência, não é copiado byte a byte).
let worker = null;
let nextRequestId = 1;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./backupWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, ok, result, error } = ev.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error));
    };
    worker.onerror = (ev) => {
      // Falha ao carregar/rodar a worker em si (não um erro de dentro do
      // try/catch da mensagem) — rejeita todas as chamadas pendentes pra
      // não deixar a tela travada esperando uma resposta que nunca vem.
      const err = new Error(ev.message || 'Falha na worker de backup.');
      for (const [id, p] of pending) { pending.delete(id); p.reject(err); }
    };
  }
  return worker;
}

function callWorker(message) {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, ...message });
  });
}

/** Gera o backup completo (lê o banco, monta e cifra o payload) inteiramente
 * dentro da worker, devolvendo um Blob já pronto pra virar o arquivo —
 * nenhum dado grande passa pela thread principal (ver data/backupRepo.js). */
export async function buildBackupBlob(password) {
  const { blob } = await callWorker({ op: 'buildBackupBlob', password });
  return blob;
}

/** Decripta um envelope (já parseado do arquivo) com a senha informada.
 * Lança erro se a senha estiver errada ou o arquivo estiver corrompido — a
 * checagem de autenticidade do AES-GCM garante isso: não existe "decriptou
 * errado silenciosamente" aqui, ou dá certo com os dados originais intactos,
 * ou falha alto e claro. Usa as iterações gravadas no próprio envelope (não
 * uma constante local) pra continuar lendo backups antigos mesmo se esse
 * número mudar no futuro. */
export async function decryptPayload(envelope, password) {
  const { payload } = await callWorker({ op: 'decrypt', envelope, password });
  return payload;
}
