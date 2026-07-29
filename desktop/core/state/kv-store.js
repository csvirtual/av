// Armazenamento de configurações e preferências (chave/valor) sobre IndexedDB.
// Cada conta local tem seu próprio espaço de chaves (prefixado), então
// trocar de conta ativa troca automaticamente tudo o que kv.get/set lê e
// grava — configurações, sistema de arquivos (via ensureSeed), etc. —
// sem precisar mudar nenhum outro módulo que já usa `kv`.
import { tx, reqToPromise } from './database.js';

let activeAccountId = null;

/** Define qual conta local está ativa — kv.get/set/remove passam a ler e
 * gravar dentro do espaço dessa conta a partir daqui. */
export function setActiveAccount(id) {
  activeAccountId = id;
}

export function getActiveAccount() {
  return activeAccountId;
}

function scopedKey(key) {
  return `acct:${activeAccountId}:${key}`;
}

async function rawGet(key, fallback) {
  const store = await tx('kv', 'readonly');
  const row = await reqToPromise(store.get(key));
  return row ? row.value : fallback;
}
async function rawSet(key, value) {
  const store = await tx('kv', 'readwrite');
  await reqToPromise(store.put({ key, value }));
}
async function rawRemove(key) {
  const store = await tx('kv', 'readwrite');
  await reqToPromise(store.delete(key));
}

export const kv = {
  async get(key, fallback = null) {
    return rawGet(scopedKey(key), fallback);
  },
  async set(key, value) {
    return rawSet(scopedKey(key), value);
  },
  async remove(key) {
    return rawRemove(scopedKey(key));
  },

  /** Lê uma chave de OUTRA conta sem trocar o contexto ativo — usado só
   * pela tela de contas (nome/avatar de contas que não estão logadas). */
  async getFor(accountId, key, fallback = null) {
    return rawGet(`acct:${accountId}:${key}`, fallback);
  },

  /** Apaga todas as chaves pertencentes a uma conta (usado ao remover uma
   * conta local). Não apaga os arquivos dela — isso é feito à parte, via
   * fs.deleteNodePermanently a partir do rootId dessa conta. */
  async removeAllFor(accountId) {
    const store = await tx('kv', 'readwrite');
    const keys = await reqToPromise(store.getAllKeys());
    const prefix = `acct:${accountId}:`;
    const toDelete = keys.filter((k) => typeof k === 'string' && k.startsWith(prefix));
    for (const k of toDelete) await reqToPromise(store.delete(k));
  },

  /** Chaves globais, fora do espaço de qualquer conta: a lista de contas
   * locais do dispositivo, qual foi usada por último, etc. */
  global: {
    get: (key, fallback = null) => rawGet(`global:${key}`, fallback),
    set: (key, value) => rawSet(`global:${key}`, value),
    remove: (key) => rawRemove(`global:${key}`),
  },
};

/** Instalações de antes do suporte a múltiplas contas gravavam tudo em
 * chaves soltas (sem prefixo de conta nem 'global:'). Detecta esse caso —
 * sem precisar de nenhuma conta ativa ainda. */
export async function hasLegacyAccountData() {
  return !!(await rawGet('auth.hash', null));
}

/** Migra todas as chaves soltas de uma instalação antiga para o espaço da
 * conta informada, preservando cada configuração e o sistema de arquivos
 * (cujos IDs de raiz ficam salvos em chaves como 'rootId'). Não apaga nada:
 * só move as chaves de lugar. */
export async function migrateLegacyDataToAccount(accountId) {
  const store = await tx('kv', 'readwrite');
  const keys = await reqToPromise(store.getAllKeys());
  const legacyKeys = keys.filter((k) => typeof k === 'string' && !k.startsWith('acct:') && !k.startsWith('global:'));
  for (const key of legacyKeys) {
    const row = await reqToPromise(store.get(key));
    if (row) await reqToPromise(store.put({ key: `acct:${accountId}:${key}`, value: row.value }));
    await reqToPromise(store.delete(key));
  }
}
