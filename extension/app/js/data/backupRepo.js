// Backup completo do sistema: junta os dados de todos os object stores do
// IndexedDB num único arquivo criptografado (senha escolhida na hora da
// exportação), pra guardar em outro lugar (pendrive, e-mail pra si mesmo,
// nuvem pessoal) e restaurar depois — inclusive numa instalação nova da
// extensão, em outro computador. É manual por decisão consciente: nada de
// permissão de downloads/alarms pra automatizar isso sozinho (ver README) —
// quem decide quando fazer backup é o lojista.
import { dbGetAll, dbCount, dbTransaction, STORE_NAMES } from '../db.js';
import { encryptPayload, decryptPayload } from '../backupCrypto.js';
import { hasAnyUser, assertActingUserIsAdmin } from './usersRepo.js';

const BACKUP_FORMAT_VERSION = 1;

export const STORE_LABELS = {
  company: 'Dados da loja',
  users: 'Usuários',
  products: 'Produtos',
  sales: 'Vendas',
  stockMovements: 'Movimentações de estoque',
  auditLog: 'Log de auditoria',
  cashSessions: 'Sessões de caixa',
  cashMovements: 'Movimentações de caixa',
  customers: 'Clientes',
  customerDebts: 'Dívidas de clientes (fiado)',
  suppliers: 'Fornecedores',
  purchaseOrders: 'Pedidos de compra',
  financialEntries: 'Contas financeiras',
  loyaltyEntries: 'Lançamentos de fidelidade',
  deliveries: 'Carretos (entregas)',
};

/** Quantos registros existem hoje em cada store — usado pra mostrar "o que
 * vai ser substituído" antes de uma restauração. */
export async function getCurrentCounts() {
  const counts = {};
  for (const name of STORE_NAMES) counts[name] = await dbCount(name);
  return counts;
}

/** Gera o envelope criptografado pronto pra virar arquivo — não mexe em
 * disco nem dispara download nenhum, isso fica por conta da view (facilita
 * reuso e teste). */
export async function buildBackupEnvelope(password) {
  const stores = {};
  for (const name of STORE_NAMES) stores[name] = await dbGetAll(name);
  const payload = {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    stores,
  };
  const encrypted = await encryptPayload(payload, password);
  return {
    app: 'gestao-de-loja-estoque-vendas',
    ...encrypted,
  };
}

/** Decripta e valida um arquivo de backup, sem gravar nada ainda — devolve
 * os dados junto com a contagem de registros de cada tipo, pra tela mostrar
 * um resumo e pedir confirmação antes de qualquer coisa destrutiva. */
export async function readBackupFile(fileText, password) {
  let envelope;
  try {
    envelope = JSON.parse(fileText);
  } catch {
    throw new Error('Arquivo inválido — não parece ser um backup deste sistema.');
  }
  if (!envelope || typeof envelope !== 'object' || !envelope.ciphertext || !envelope.salt || !envelope.iv) {
    throw new Error('Arquivo inválido — não parece ser um backup deste sistema.');
  }

  let payload;
  try {
    payload = await decryptPayload(envelope, password);
  } catch {
    throw new Error('Não foi possível abrir o backup — senha incorreta ou arquivo corrompido.');
  }
  if (!payload || typeof payload !== 'object' || !payload.stores) {
    throw new Error('Arquivo inválido — não parece ser um backup deste sistema.');
  }
  // O campo é gravado desde sempre (buildBackupEnvelope), mas nunca tinha
  // sido checado aqui — um backup de um formato mais novo (de uma versão
  // futura do sistema, com stores/campos que esta versão não conhece)
  // seria aplicado do mesmo jeito, sem aviso, e o dbTransaction atômico só
  // pegaria o problema na hora de gravar (se pegasse), com um erro cru em
  // vez de uma mensagem clara. Um backup de formato IGUAL ou MAIS ANTIGO
  // continua sendo aceito normalmente — só recusa o que esta versão do
  // sistema não tem como garantir que entende.
  if (typeof payload.backupFormatVersion !== 'number' || payload.backupFormatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error('Este arquivo de backup foi gerado por uma versão mais nova do sistema — atualize a extensão antes de restaurar.');
  }

  const counts = {};
  for (const name of STORE_NAMES) counts[name] = (payload.stores[name] || []).length;
  return { payload, counts };
}

/** Achado de auditoria: applyBackup() era só protegido pela TELA ("Backup"
 * restrita a admin) — a função em si aceitava qualquer chamada. Como ela
 * APAGA TUDO e regrava (é a ação mais destrutiva do sistema inteiro), um
 * vendedor com acesso ao console podia chamar applyBackup() direto com um
 * payload forjado (nem precisa ser um backup de verdade — só um objeto
 * `{ stores: {...} }` qualquer) e zerar a loja inteira sem senha de backup
 * nenhuma, sem senha de admin, sem confirmação nenhuma. Mesmo raciocínio de
 * usersRepo.js/companyRepo.js: só libera sem sessão de admin durante a
 * restauração de verdade numa instalação NOVA (setup.js chama isto antes
 * de existir qualquer usuário) — depois disso, precisa ser a sessão
 * realmente logada como admin agora. */
async function assertAllowedToApplyBackup() {
  if (!(await hasAnyUser())) return; // restauração numa instalação nova de verdade, ainda sem ninguém logado
  await assertActingUserIsAdmin();
}

/** Aplica os dados decriptados: apaga tudo que existe hoje e regrava com o
 * conteúdo do backup. Ação destrutiva e irreversível — quem chama isso já
 * confirmou com o usuário antes (ver views/backup.js e views/setup.js).
 *
 * Roda tudo (limpar + regravar os 14 stores) dentro de UMA ÚNICA transação
 * do IndexedDB, não uma transação separada por store: se qualquer escrita
 * falhar no meio do caminho (registro corrompido, cota de armazenamento
 * estourada), a transação inteira é desfeita e o banco volta exatamente
 * pro estado de antes da restauração — nunca fica com alguns stores já
 * trocados e outros ainda com os dados antigos. */
export async function applyBackup(payload) {
  await assertAllowedToApplyBackup();
  await dbTransaction(STORE_NAMES, 'readwrite', (transaction) => {
    for (const name of STORE_NAMES) {
      const store = transaction.objectStore(name);
      store.clear();
      const records = payload.stores[name] || [];
      for (const record of records) store.put(record);
    }
  });
}
