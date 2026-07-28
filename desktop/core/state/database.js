// Camada mais baixa de acesso ao IndexedDB: abre a conexão e expõe helpers
// genéricos de transação. Nenhuma regra de negócio deve viver aqui — apenas
// mecanismo de acesso ao banco, reutilizado por kv-store e filesystem.
const DB_NAME = 'win11-web-os';
const DB_VERSION = 1;

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('nodes')) {
        const store = db.createObjectStore('nodes', { keyPath: 'id' });
        store.createIndex('byParent', 'parentId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function tx(storeName, mode) {
  return openDatabase().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

export function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
