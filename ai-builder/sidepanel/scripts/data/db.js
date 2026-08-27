// Thin promise wrapper around IndexedDB. No dependency: IndexedDB's callback
// API is small enough that wrapping it by hand is ~60 lines, versus pulling
// in a library for what is fundamentally get/put/delete/getAll.

const DB_NAME = 'av-builder';
const DB_VERSION = 1;
export const STORES = { projects: 'projects', snapshots: 'snapshots' };

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.projects)) {
        db.createObjectStore(STORES.projects, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.snapshots)) {
        const s = db.createObjectStore(STORES.snapshots, { keyPath: 'id' });
        s.createIndex('byProject', 'projectId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  put(storeName, value) {
    return withStore(storeName, 'readwrite', (s) => s.put(value));
  },
  get(storeName, key) {
    return withStore(storeName, 'readonly', (s) => s.get(key));
  },
  delete(storeName, key) {
    return withStore(storeName, 'readwrite', (s) => s.delete(key));
  },
  getAll(storeName) {
    return withStore(storeName, 'readonly', (s) => s.getAll());
  },
  getAllByIndex(storeName, indexName, value) {
    return withStore(storeName, 'readonly', (s) => s.index(indexName).getAll(value));
  },
};
