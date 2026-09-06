// Camada mais baixa de acesso ao IndexedDB do app: abre a conexão (única,
// reaproveitada) e expõe helpers genéricos de transação/promisificação.
// Nenhuma regra de negócio deve viver aqui — só mecanismo de acesso ao banco,
// reutilizado pelos repositórios em js/data/*.js.
const DB_NAME = 'loja-gestao-db';
const DB_VERSION = 9;

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

      // v7: placar diário de vendas (achado de auditoria) — Histórico de
      // vendas/Painel precisavam somar a tabela `sales` inteira toda vez só
      // pra saber "quantas vendas e quanto faturou" (mesmo já paginados pra
      // LISTAGEM, ver dbScanByIndex acima — a soma total é outra conta).
      // Medido ao vivo: ~2,8s pra abrir o Histórico de vendas com 100 mil
      // vendas no banco. `dailySales` guarda um registro por DIA (chave
      // "AAAA-MM-DD" em horário local, não UTC — precisa bater com o "hoje"
      // que o lojista vê na tela) com a contagem e o total líquido daquele
      // dia, atualizado incrementalmente a cada venda/estorno (ver
      // data/salesRepo.js#createSale/refundSaleItems) — depois disso, somar
      // qualquer período vira somar algumas centenas/milhares de linhas
      // minúsculas, não centenas de milhares de vendas inteiras.
      //
      // Propositalmente FORA de STORE_NAMES (não faz parte do backup): é
      // dado só derivado de `sales`, não uma fonte de verdade — incluir no
      // backup seria redundante, e pior, arriscaria restaurar um placar
      // desatualizado junto com vendas mais novas. Por isso é sempre
      // RECALCULADO do zero depois de restaurar um backup (ver
      // data/backupRepo.js#applyBackup → salesRepo.js#rebuildDailySales),
      // nunca restaurado diretamente.
      if (!db.objectStoreNames.contains('dailySales')) {
        const dailyStore = db.createObjectStore('dailySales', { keyPath: 'date' });
        // Backfill pra quem já tem vendas de antes desta versão existir —
        // sem isso, o placar nasceria vazio e uma loja com anos de
        // histórico veria "0 vendas" até a próxima venda ser registrada.
        // Roda uma vez só, dentro da própria transação de upgrade do
        // IndexedDB (não impacta nada depois de terminar); pra uma
        // instalação nova (sem nenhuma venda ainda) o cursor abaixo não
        // encontra nada e não faz nada.
        const salesStore = req.transaction.objectStore('sales');
        const byDay = new Map();
        salesStore.openCursor().onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) {
            for (const row of byDay.values()) dailyStore.put(row);
            return;
          }
          const s = cursor.value;
          // Achado de auditoria (dinheiro não pode ter brecha): venda de
          // uma versão bem antiga do sistema, com `timestamp` inválido,
          // viraria uma chave "NaN-NaN-NaN" que — por ordenação de string —
          // ficaria DEPOIS de qualquer data real, entrando em consultas "de
          // hoje em diante" por engano (ver mesmo raciocínio em
          // salesRepo.js#rebuildDailySales). Pulada, não silenciada: fica
          // fora do placar, mas não contamina o dia errado. `total`/
          // `refundedTotal`/`creditInterestTotal` também protegidos contra
          // undefined/NaN pelo mesmo motivo — nunca deixar um valor
          // inválido entrar na soma persistida.
          if (!Number.isFinite(s.timestamp)) { cursor.continue(); return; }
          const d = new Date(s.timestamp);
          const pad = (n) => String(n).padStart(2, '0');
          const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          const row = byDay.get(key) || { date: key, count: 0, netTotal: 0 };
          row.count += 1;
          row.netTotal += (Number(s.total) || 0) - (Number(s.refundedTotal) || 0) + (Number(s.creditInterestTotal) || 0);
          byDay.set(key, row);
          cursor.continue();
        };
      }

      // v8: chaves de idempotência (achado de auditoria P2, dinheiro não
      // pode ter brecha) — sangria/suprimento de caixa, pagamento de fiado,
      // pagamento de conta financeira, resgate de pontos de fidelidade e
      // recebimento de compra só bloqueavam um valor MAIOR que o
      // disponível — nunca uma submissão DUPLICADA e legítima (ex: uma
      // chamada repetida sem passar pela tela, ou duas abas confirmando a
      // mesma ação quase junto). A tela já trava um clique duplo comum (ver
      // components/modal.js), mas essas funções também precisam se
      // proteger sozinhas, na fonte — mesmo princípio já usado nas
      // permissões (nunca confiar só na tela). Cada chamada sensível passa
      // a exigir uma `dedupeKey` (gerada uma vez por abertura do modal, não
      // por tentativa de envio) que só pode ser usada uma vez: a segunda
      // tentativa com a mesma chave falha ao tentar `add()` numa chave
      // primária já existente, dentro da MESMA transação atômica da
      // operação — sem outro campo/índice extra pra manter em dia.
      if (!db.objectStoreNames.contains('idempotencyKeys')) {
        db.createObjectStore('idempotencyKeys', { keyPath: 'key' });
      }

      // v9: índices de caixa em `sales`/`customerDebts` (achado de
      // auditoria, dinheiro não pode engasgar): cashRepo.js#computeExpectedAmounts
      // — que roda a CADA renderização do Caixa, sangria, suprimento,
      // retificação e fechamento — carregava TODA a tabela `sales` (e toda
      // `customerDebts`) da loja inteira pra filtrar em memória só as linhas
      // da sessão atual. Não trava com pouco histórico, mas cresce sem teto:
      // com dezenas de milhares de vendas acumuladas (meses/anos de loja em
      // operação), a tela de Caixa passaria a travar por segundos a cada
      // abertura. Mesmo padrão já corrigido antes em Relatórios/Histórico/
      // Painel (ver dbScanByIndex acima) — ficou faltando só aqui.
      //
      // `byCashSessionId` em `customerDebts`: o campo já existe em todo
      // registro desde sempre (`cashSessionId: null` por padrão), então o
      // índice cobre o histórico inteiro sem precisar de backfill.
      const salesStoreV9 = req.transaction.objectStore('sales');
      if (!salesStoreV9.indexNames.contains('byCashSessionId')) {
        salesStoreV9.createIndex('byCashSessionId', 'cashSessionId', { unique: false });
      }
      const customerDebtsStoreV9 = req.transaction.objectStore('customerDebts');
      if (!customerDebtsStoreV9.indexNames.contains('byCashSessionId')) {
        customerDebtsStoreV9.createIndex('byCashSessionId', 'cashSessionId', { unique: false });
      }

      // `byHasRefunds`: `hasRefunds` é um campo NOVO (espelha `refunds.length
      // > 0`, ver data/salesRepo.js#createSale/refundSaleItems) — vendas
      // gravadas antes desta versão não têm esse campo ainda, então precisam
      // de backfill (mesmo padrão do placar diário, v7 acima) pra o índice
      // enxergar os reembolsos que já existiam. Sem isso, o índice nasceria
      // "vazio" pra qualquer venda antiga com reembolso, e o Caixa deixaria
      // de encontrar reembolsos legítimos feitos antes da atualização.
      if (!salesStoreV9.indexNames.contains('byHasRefunds')) {
        // `hasRefunds` é 1/0, não booleano de verdade: IndexedDB não aceita
        // `true`/`false` como chave de índice (`getAll(true)` lança
        // "not a valid key") — número é o jeito mais simples de continuar
        // indexável.
        salesStoreV9.createIndex('byHasRefunds', 'hasRefunds', { unique: false });
        salesStoreV9.openCursor().onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;
          const s = cursor.value;
          if (typeof s.hasRefunds !== 'number') {
            s.hasRefunds = (s.refunds && s.refunds.length > 0) ? 1 : 0;
            cursor.update(s);
          }
          cursor.continue();
        };
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

/** Pagina um índice em ordem decrescente (mais recente primeiro) via
 * IDBCursor, sem NUNCA carregar o store inteiro em memória — a diferença
 * central pra dbGetAll(), que traz tudo de uma vez (achado de auditoria:
 * era assim que listSales()/listAuditLog() ficavam mais lentas a cada ano
 * de loja em operação, e o `list.map()` de renderização em cima disso
 * criava um nó de DOM por registro — com dezenas de milhares de vendas,
 * as duas coisas juntas travavam a aba por vários segundos).
 *
 * `range` (opcional) já restringe o cursor a uma faixa do índice (ex: um
 * filtro de data vira um IDBKeyRange, e o cursor nem visita o que está
 * fora dele). `matches(record)` filtra registro a registro durante a
 * varredura (ex: vendedor, termo de busca) — não dá pra indexar toda
 * combinação de filtro, mas isso evita as duas partes mais caras (array
 * gigante em memória + milhares de linhas na tela) mesmo quando o filtro
 * em si ainda precisa passar por cada registro.
 *
 * Devolve até `limit` registros que passem no filtro, mais `hasMore`
 * (true de forma otimista sempre que a página encheu — pode custar um
 * "carregar mais" a mais que devolve vazio quando não sobra mais nada
 * batendo no filtro, troca deliberada por simplicidade) e
 * `nextKey`/`nextId`, a "âncora" do último registro incluído pra retomar
 * exatamente dali na próxima chamada (usa a chave do índice + a chave
 * primária juntas de propósito — o índice de timestamp não é único, dois
 * registros no mesmo milissegundo não podem se confundir). */
export async function dbScanByIndex(storeName, indexName, { range, limit = 50, afterKey, afterId, matches } = {}) {
  const store = await tx(storeName, 'readonly');
  const index = store.index(indexName);
  return new Promise((resolve, reject) => {
    const items = [];
    let skipping = afterKey !== undefined && afterKey !== null;
    let lastKey = null;
    let lastId = null;
    const req = index.openCursor(range ?? null, 'prev');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve({ items, hasMore: false, nextKey: null, nextId: null }); return; }
      if (skipping) {
        if (cursor.key === afterKey && cursor.primaryKey === afterId) skipping = false;
        cursor.continue();
        return;
      }
      if (items.length === limit) {
        resolve({ items, hasMore: true, nextKey: lastKey, nextId: lastId });
        return;
      }
      const record = cursor.value;
      if (!matches || matches(record)) {
        items.push(record);
        lastKey = cursor.key;
        lastId = cursor.primaryKey;
      }
      cursor.continue();
    };
  });
}

/** Soma/conta um índice inteiro sem acumular os registros em memória — só
 * o acumulador (`reduceFn(acc, record) => acc`) fica vivo durante a
 * varredura, nunca um array com tudo. Usado pra manter total/contagem
 * exatos de uma lista filtrada mesmo quando a listagem em si é paginada
 * (ver dbScanByIndex acima) — sem isso, paginar a tela faria o "total"
 * mostrado parar de bater com o filtro selecionado. */
export async function dbReduceByIndex(storeName, indexName, { range, matches, reduceFn, initial }) {
  const store = await tx(storeName, 'readonly');
  const index = store.index(indexName);
  return new Promise((resolve, reject) => {
    let acc = initial;
    const req = index.openCursor(range ?? null);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(acc); return; }
      const record = cursor.value;
      if (!matches || matches(record)) acc = reduceFn(acc, record);
      cursor.continue();
    };
  });
}

/** Igual a dbReduceByIndex, mas percorre a chave PRIMÁRIA do store
 * diretamente (sem índice) — usado pra somar `dailySales` (ver
 * data/salesRepo.js#summarizeSales), cuja própria keyPath ("date",
 * "AAAA-MM-DD") já é a ordenação que interessa, sem precisar de um índice
 * separado só pra isso. */
export async function dbReduceByRange(storeName, { range, reduceFn, initial } = {}) {
  const store = await tx(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    let acc = initial;
    const req = store.openCursor(range ?? null);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(acc); return; }
      acc = reduceFn(acc, cursor.value);
      cursor.continue();
    };
  });
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

/** Reivindica uma chave de idempotência DENTRO de uma transação já aberta
 * que já inclua o store `idempotencyKeys` (ver DB_VERSION 8 acima) — usada
 * por operações sensíveis (dinheiro/estoque) que precisam rejeitar uma
 * segunda chamada com a mesma `dedupeKey`, não só um valor maior que o
 * disponível. `add()` numa chave primária já existente dispara o `onerror`
 * da própria requisição; `event.preventDefault()` evita que isso aborte a
 * transação sozinho com um erro técnico (ConstraintError) — em vez disso,
 * chama `onDuplicate()`, que quem chamou usa pra abortar com a MESMA
 * mensagem amigável e o mesmo padrão (`fail(mensagem)` +
 * `transaction.abort()`) já usado no resto da função. Se `dedupeKey` não
 * for informada, não faz nada — chamada antiga/interna que não precisa
 * dessa proteção (ex: crédito de estoque automático de um estorno). */
export function claimIdempotencyKey(transaction, dedupeKey, onDuplicate) {
  if (!dedupeKey) return;
  const req = transaction.objectStore('idempotencyKeys').add({ key: dedupeKey, at: Date.now() });
  req.onerror = (ev) => {
    ev.preventDefault();
    onDuplicate();
  };
}

// Nota de auditoria (re-auditoria, decisão registrada — não é uma lacuna
// esquecida): `idempotencyKeys` nunca tem registros removidos, então cresce
// sem limite pelo tempo de vida da loja. Avaliado deliberadamente e aceito:
// uma chave é gravada só nos poucos pontos de "dinheiro/estoque sensível a
// duplicata" (pagamento de fiado, resgate de pontos, sangria/suprimento de
// caixa, pagamento de conta, recebimento de compra) — não em toda operação
// do sistema. Mesmo uma loja com uso muito acima do normal (centenas dessas
// operações por dia, todo dia, por 5 anos) fica na casa de algumas centenas
// de milhares de linhas — poucos MB num IndexedDB, sem índice, chave
// primária só (string). Não compensa o risco de um mecanismo de expiração
// (teria que decidir um TTL sem nunca poder invalidar uma dedupeKey ainda
// "viva" numa aba esquecida aberta) pra resolver um problema que a escala
// real do produto não apresenta.

export function newId() {
  return crypto.randomUUID();
}

// Todos os object stores do banco, na ordem em que são criados acima — é a
// lista usada pelo backup (data/backupRepo.js) pra saber exatamente o que
// exportar/restaurar sem precisar repetir os nomes em outro lugar. Toda vez
// que um novo store for criado num upgrade futuro, ele entra aqui também —
// EXCETO `dailySales` (v7), de propósito: é um placar derivado de `sales`,
// não uma fonte de verdade, e é sempre recalculado do zero depois de
// restaurar um backup (ver salesRepo.js#rebuildDailySales), nunca
// restaurado diretamente. `idempotencyKeys` (v8) também fica fora, pelo
// mesmo espírito: são só tokens de "essa ação específica já foi
// processada", sem significado nenhum fora do momento em que foram usados
// — não faz sentido restaurá-los de um backup antigo (bloqueariam ações
// novas e legítimas com uma chave que só por coincidência bate).
export const STORE_NAMES = [
  'company', 'users', 'products', 'sales', 'stockMovements', 'auditLog',
  'cashSessions', 'cashMovements', 'customers', 'customerDebts',
  'suppliers', 'purchaseOrders', 'financialEntries', 'loyaltyEntries',
  'deliveries',
];
