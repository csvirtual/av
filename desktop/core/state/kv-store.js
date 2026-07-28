// Armazenamento de configurações e preferências (chave/valor) sobre IndexedDB.
import { tx, reqToPromise } from './database.js';

export const kv = {
  async get(key, fallback = null) {
    const store = await tx('kv', 'readonly');
    const row = await reqToPromise(store.get(key));
    return row ? row.value : fallback;
  },
  async set(key, value) {
    const store = await tx('kv', 'readwrite');
    await reqToPromise(store.put({ key, value }));
  },
  async remove(key) {
    const store = await tx('kv', 'readwrite');
    await reqToPromise(store.delete(key));
  },
};
