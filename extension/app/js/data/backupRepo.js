// Backup completo do sistema: junta os dados de todos os object stores do
// IndexedDB num único arquivo criptografado (senha escolhida na hora da
// exportação), pra guardar em outro lugar (pendrive, e-mail pra si mesmo,
// nuvem pessoal) e restaurar depois — inclusive numa instalação nova da
// extensão, em outro computador. É manual por decisão consciente: nada de
// permissão de downloads/alarms pra automatizar isso sozinho (ver README) —
// quem decide quando fazer backup é o lojista.
import { dbGetAll, dbPut, dbClear, dbCount, STORE_NAMES } from '../db.js';
import { encryptPayload, decryptPayload } from '../backupCrypto.js';

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

  const counts = {};
  for (const name of STORE_NAMES) counts[name] = (payload.stores[name] || []).length;
  return { payload, counts };
}

/** Aplica os dados decriptados: apaga tudo que existe hoje e regrava com o
 * conteúdo do backup, store por store. Ação destrutiva e irreversível —
 * quem chama isso já confirmou com o usuário antes (ver views/backup.js). */
export async function applyBackup(payload) {
  for (const name of STORE_NAMES) {
    await dbClear(name);
    const records = payload.stores[name] || [];
    for (const record of records) {
      await dbPut(name, record);
    }
  }
}
