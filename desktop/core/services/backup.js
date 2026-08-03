// Backup/restauração geral do sistema: exporta e reimporta o conteúdo bruto
// dos dois object stores do IndexedDB (kv e nodes) — todas as contas, todos
// os arquivos, todas as configurações do dispositivo, de uma vez só. Os
// arquivos continuam gravados como já ficam no IndexedDB (cifrados, ver
// core/services/crypto.js), então o arquivo de backup em si não expõe
// nenhum conteúdo em texto puro — só é útil de volta com a senha certa.
import { tx, reqToPromise } from '../state/database.js';

const BACKUP_FORMAT = 'win11-web-backup';
const BACKUP_VERSION = 1;

async function getAllFromStore(name) {
  const store = await tx(name, 'readonly');
  return reqToPromise(store.getAll());
}

async function clearStore(name) {
  const store = await tx(name, 'readwrite');
  await reqToPromise(store.clear());
}

async function putAll(name, rows) {
  const store = await tx(name, 'readwrite');
  await Promise.all(rows.map((row) => reqToPromise(store.put(row))));
}

/** Monta o objeto de backup com tudo que existe no dispositivo agora. */
export async function exportBackup() {
  const [kv, nodes] = await Promise.all([getAllFromStore('kv'), getAllFromStore('nodes')]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    kv,
    nodes,
  };
}

export function isValidBackup(data) {
  return !!data && data.format === BACKUP_FORMAT && typeof data.version === 'number'
    && Array.isArray(data.kv) && Array.isArray(data.nodes);
}

/** Restaura um backup válido: apaga o que existe agora e grava o conteúdo do
 * backup no lugar. Depois disso é necessário recarregar a página — nada no
 * app já em execução sabe que os dados por baixo mudaram. */
export async function restoreBackup(data) {
  if (!isValidBackup(data)) throw new Error('Arquivo de backup inválido.');
  await clearStore('kv');
  await clearStore('nodes');
  await putAll('kv', data.kv);
  await putAll('nodes', data.nodes);
}

/** Nomes reais (não inventados) de tudo que existe agora — usado só para
 * mostrar o que está sendo apagado durante a redefinição do dispositivo. */
export async function listRealEntryNames() {
  const [kv, nodes] = await Promise.all([getAllFromStore('kv'), getAllFromStore('nodes')]);
  const kvNames = kv.map((row) => ({ kind: 'config', name: String(row.key) }));
  const nodeNames = nodes.map((row) => ({ kind: row.type === 'folder' ? 'folder' : 'file', name: row.name }));
  return [...nodeNames, ...kvNames];
}
