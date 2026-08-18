// Camada mais baixa de acesso ao IndexedDB do app: abre a conexão (única,
// reaproveitada) e expõe helpers genéricos de transação/promisificação.
// Nenhuma regra de negócio deve viver aqui — só mecanismo de acesso ao banco,
// reutilizado pelos repositórios em js/data/*.js.
const DB_NAME = 'loja-gestao-db';
const DB_VERSION = 6;

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

      // v6: carreto (entrega de material) — ver data/deliveriesRepo.js
      if (!db.objectStoreNames.contains('deliveries')) {
        const store = db.createObjectStore('deliveries', { keyPath: 'id' });
        store.createIndex('byCustomerId', 'customerId', { unique: false });
        store.createIndex('byStatus', 'status', { unique: false });
        store.createIndex('byCreatedAt', 'createdAt', { unique: false });
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // Sem isso, uma aba com conexão aberta bloqueia PRA SEMPRE qualquer
      // outra tentativa de abrir o banco numa versão mais nova (ex: outra
      // aba já rodando o código atualizado depois de a extensão se
      // atualizar sozinha, ou até um dev testando localmente com "Load
      // unpacked" + recarregar a extensão) — o pedido de upgrade da outra
      // aba fica parado esperando essa conexão fechar, e essa conexão
      // nunca fecha sozinha por padrão. Ao ouvir 'versionchange', fecha a
      // conexão desta aba de propósito; a próxima operação do banco NESTA
      // aba reabre uma conexão nova sozinha (dbPromise volta a null), sem
      // precisar de reload manual.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // Efeito colateral do mesmo cenário acima, do lado de quem está tentando
    // abrir a versão nova: enquanto a outra aba não fecha a conexão antiga,
    // este req fica com status 'blocked' (nem onsuccess nem onerror disparam
    // ainda). Não precisa fazer nada aqui além de não travar silenciosamente
    // pra sempre sem pista nenhuma — o onversionchange acima já resolve a
    // causa; isso só evita um estado "preso" sem log nenhum se, por algum
    // motivo, a outra aba não reagir a tempo.
    req.onblocked = () => console.warn('[db] Abertura do banco bloqueada por outra aba com conexão aberta — aguardando ela fechar.');
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

/** Lê e regrava um registro dentro de UMA ÚNICA transação — diferente de
 * "dbGet + dbPut" separados (cada um abre a própria transação), isto aqui
 * garante atomicidade real: entre o get e o put não existe brecha pra outra
 * chamada concorrente ler o mesmo valor "antigo" e sobrescrever o resultado
 * (lost update). `updateFn(current)` recebe o registro atual (ou
 * `undefined` se não existir) e deve devolver o registro já atualizado, ou
 * lançar um erro pra abortar a transação inteira sem gravar nada. */
export async function dbUpdate(storeName, id, updateFn) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const getReq = store.get(id);
    getReq.onerror = () => reject(getReq.error);
    getReq.onsuccess = () => {
      let updated;
      try {
        updated = updateFn(getReq.result);
      } catch (err) {
        reject(err);
        try { transaction.abort(); } catch { /* já pode não ter requisição pendente */ }
        return;
      }
      const putReq = store.put(updated);
      putReq.onerror = () => reject(putReq.error);
      putReq.onsuccess = () => resolve(updated);
    };
  });
}

/** Abre UMA transação cobrindo vários object stores de uma vez (o
 * IndexedDB suporta isso nativamente) e executa `work(transaction)`
 * dentro dela. Se `work` lançar um erro em qualquer ponto, a transação
 * inteira é abortada e desfeita — nenhuma escrita anterior (nem nos
 * outros stores) fica gravada. Usado pra restauração de backup
 * (data/backupRepo.js), que precisa trocar o conteúdo de vários stores de
 * uma vez sem correr o risco de deixar o banco pela metade se algo falhar
 * no meio do caminho. `work` deve ser síncrona (só enfileirar
 * store.get/put/clear/etc.) — nada de `await` no meio, ou a transação
 * fecha sozinha antes de todo o trabalho ser enfileirado. */
export async function dbTransaction(storeNames, mode, work) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    let result;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err || new Error('Transação cancelada.'));
    };
    transaction.onerror = () => fail(transaction.error);
    transaction.onabort = () => fail(transaction.error);
    transaction.oncomplete = () => {
      settled = true;
      resolve(result);
    };
    try {
      result = work(transaction);
    } catch (err) {
      fail(err);
      try { transaction.abort(); } catch { /* já pode não ter requisição pendente */ }
    }
  });
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
  'deliveries',
];
