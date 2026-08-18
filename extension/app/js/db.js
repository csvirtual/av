// Camada mais baixa de acesso ao IndexedDB do app: abre a conexão (única,
// reaproveitada) e expõe helpers genéricos de transação/promisificação.
// Nenhuma regra de negócio deve viver aqui — só mecanismo de acesso ao banco,
// reutilizado pelos repositórios em js/data/*.js.
const DB_NAME = 'loja-gestao-db';
const DB_VERSION = 5;

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains('company')) {
        db.createObjectStore('company', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('users')) {
        const store = db.createObjectStore('users', { keyPath: 'id' });
        store.createIndex('byUsername', 'usernameLower', { unique: true });
      }

      if (!db.objectStoreNames.contains('products')) {
        const store = db.createObjectStore('products', { keyPath: 'id' });
        store.createIndex('byBarcode', 'barcode', { unique: true });
        store.createIndex('byName', 'nameLower', { unique: false });
      }

      if (!db.objectStoreNames.contains('sales')) {
        const store = db.createObjectStore('sales', { keyPath: 'id' });
        store.createIndex('byTimestamp', 'timestamp', { unique: false });
        store.createIndex('byUserId', 'userId', { unique: false });
      }

      if (!db.objectStoreNames.contains('stockMovements')) {
        const store = db.createObjectStore('stockMovements', { keyPath: 'id' });
        store.createIndex('byProductId', 'productId', { unique: false });
        store.createIndex('byTimestamp', 'timestamp', { unique: false });
      }

      if (!db.objectStoreNames.contains('auditLog')) {
        const store = db.createObjectStore('auditLog', { keyPath: 'id' });
        store.createIndex('byTimestamp', 'timestamp', { unique: false });
        store.createIndex('byUserId', 'userId', { unique: false });
      }

      // v2: caixa (abertura/fechamento/sangria/suprimento) — ver data/cashRepo.js
      if (!db.objectStoreNames.contains('cashSessions')) {
        const store = db.createObjectStore('cashSessions', { keyPath: 'id' });
        store.createIndex('byOpenedAt', 'openedAt', { unique: false });
        store.createIndex('byStatus', 'status', { unique: false });
      }

      if (!db.objectStoreNames.contains('cashMovements')) {
        const store = db.createObjectStore('cashMovements', { keyPath: 'id' });
        store.createIndex('bySessionId', 'sessionId', { unique: false });
        store.createIndex('byTimestamp', 'timestamp', { unique: false });
      }

      // v3: clientes e fiado — ver data/customersRepo.js
      if (!db.objectStoreNames.contains('customers')) {
        const store = db.createObjectStore('customers', { keyPath: 'id' });
        store.createIndex('byNameLower', 'nameLower', { unique: false });
      }

      if (!db.objectStoreNames.contains('customerDebts')) {
        const store = db.createObjectStore('customerDebts', { keyPath: 'id' });
        store.createIndex('byCustomerId', 'customerId', { unique: false });
        store.createIndex('byTimestamp', 'timestamp', { unique: false });
      }

      // v4: fornecedores e pedidos de compra — ver data/suppliersRepo.js e
      // data/purchasesRepo.js
      if (!db.objectStoreNames.contains('suppliers')) {
        const store = db.createObjectStore('suppliers', { keyPath: 'id' });
        store.createIndex('byNameLower', 'nameLower', { unique: false });
      }

      if (!db.objectStoreNames.contains('purchaseOrders')) {
        const store = db.createObjectStore('purchaseOrders', { keyPath: 'id' });
        store.createIndex('bySupplierId', 'supplierId', { unique: false });
        store.createIndex('byStatus', 'status', { unique: false });
        store.createIndex('byCreatedAt', 'createdAt', { unique: false });
      }

      // v5: financeiro (contas a pagar/receber) e fidelidade — ver
      // data/financeRepo.js e data/loyaltyRepo.js
      if (!db.objectStoreNames.contains('financialEntries')) {
        const store = db.createObjectStore('financialEntries', { keyPath: 'id' });
        store.createIndex('byStatus', 'status', { unique: false });
        store.createIndex('byDueDate', 'dueDate', { unique: false });
      }

      if (!db.objectStoreNames.contains('loyaltyEntries')) {
        const store = db.createObjectStore('loyaltyEntries', { keyPath: 'id' });
        store.createIndex('byCustomerId', 'customerId', { unique: false });
        store.createIndex('byTimestamp', 'timestamp', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function tx(storeName, mode = 'readonly') {
  const db = await openDatabase();
  return db.transaction(storeName, mode).objectStore(storeName);
}

// ---------- Helpers genéricos de CRUD, reaproveitados pelos repositórios ----------

export async function dbGetAll(storeName) {
  const store = await tx(storeName, 'readonly');
  return reqToPromise(store.getAll());
}

export async function dbGet(storeName, id) {
  const store = await tx(storeName, 'readonly');
  return reqToPromise(store.get(id));
}

export async function dbPut(storeName, value) {
  const store = await tx(storeName, 'readwrite');
  await reqToPromise(store.put(value));
  return value;
}

export async function dbAdd(storeName, value) {
  const store = await tx(storeName, 'readwrite');
  await reqToPromise(store.add(value));
  return value;
}

export async function dbDelete(storeName, id) {
  const store = await tx(storeName, 'readwrite');
  await reqToPromise(store.delete(id));
}

export async function dbGetByIndex(storeName, indexName, value) {
  const store = await tx(storeName, 'readonly');
  return reqToPromise(store.index(indexName).get(value));
}

export async function dbGetAllByIndex(storeName, indexName, value) {
  const store = await tx(storeName, 'readonly');
  return reqToPromise(store.index(indexName).getAll(value));
}

export async function dbCount(storeName) {
  const store = await tx(storeName, 'readonly');
  return reqToPromise(store.count());
}

export async function dbClear(storeName) {
  const store = await tx(storeName, 'readwrite');
  await reqToPromise(store.clear());
}

export function newId() {
  return crypto.randomUUID();
}

// Todos os object stores do banco, na ordem em que são criados acima — é a
// lista usada pelo backup (data/backupRepo.js) pra saber exatamente o que
// exportar/restaurar sem precisar repetir os nomes em outro lugar. Toda vez
// que um novo store for criado num upgrade futuro, ele entra aqui também.
export const STORE_NAMES = [
  'company', 'users', 'products', 'sales', 'stockMovements', 'auditLog',
  'cashSessions', 'cashMovements', 'customers', 'customerDebts',
  'suppliers', 'purchaseOrders', 'financialEntries', 'loyaltyEntries',
];
