// Fase 8 (segurança): backup completo do sistema — junta todas as tabelas
// num único arquivo criptografado (senha escolhida na hora da exportação),
// pra guardar em outro lugar e restaurar depois, inclusive numa instalação
// nova do servidor. Diferente da extensão (que precisa reconstruir cada
// "object store" campo a campo a partir de um objeto JS, porque é o que o
// IndexedDB entende), aqui cada linha de cada tabela SQL já É a unidade
// completa (colunas indexadas + o blob `data`) — dá pra fazer um dump/
// restauração genérico, sem lógica por tabela: `SELECT *` na exportação,
// `DELETE` + reinserção linha a linha na restauração, com os MESMOS valores
// de coluna que saíram (nada precisa ser recalculado a partir do JSON).
import { db } from '../db/index.js';

const BACKUP_FORMAT_VERSION = 1;

// Todas as tabelas com dado de verdade da loja — de propósito SEM
// `idempotency_keys` (só controle de deduplicação, sem sentido restaurar)
// nem `sessions` (sessões de login são efêmeras, do mesmo jeito que a
// extensão não leva `chrome.storage.session` pro backup).
export const BACKUP_TABLES = [
  'company', 'users', 'products', 'sales', 'stock_movements', 'audit_log',
  'cash_sessions', 'cash_movements', 'customers', 'customer_debts',
  'suppliers', 'purchase_orders', 'financial_entries', 'loyalty_entries',
  'deliveries', 'store_credits',
];

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

/** Lê todas as tabelas de backup e monta o payload (ainda sem cifrar). */
export function buildBackupPayload() {
  const tables = {};
  for (const table of BACKUP_TABLES) {
    tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
  }
  return { backupFormatVersion: BACKUP_FORMAT_VERSION, exportedAt: new Date().toISOString(), tables };
}

/** Quantos registros existem HOJE em cada tabela — pra mostrar "o que vai
 * ser substituído" antes de uma restauração, junto com a contagem de cada
 * tabela do arquivo (ver routes/backup.js). */
export function getCurrentCounts() {
  const counts = {};
  for (const table of BACKUP_TABLES) {
    counts[table] = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c;
  }
  return counts;
}

/** Apaga tudo que existe hoje (nas tabelas de backup) e regrava com o
 * conteúdo do payload — ação destrutiva e irreversível, quem chama já
 * confirmou com o usuário antes (ver routes/backup.js). Tudo dentro de UMA
 * ÚNICA transação: se qualquer tabela falhar no meio (linha corrompida,
 * coluna que não existe mais), a transação inteira desfaz e o banco volta
 * exatamente pro estado de antes — nunca fica com algumas tabelas já
 * trocadas e outras ainda com os dados antigos. */
export const applyBackupPayload = db.transaction((payload) => {
  for (const table of BACKUP_TABLES) {
    const rows = payload.tables?.[table] || [];
    db.prepare(`DELETE FROM ${table}`).run();
    if (rows.length === 0) continue;
    const cols = tableColumns(table);
    const placeholders = cols.map((c) => `@${c}`).join(', ');
    const insertStmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
    for (const row of rows) {
      // Só usa as colunas que a tabela ATUAL conhece — um backup mais
      // antigo (de antes de uma coluna nova existir) não pode falhar por
      // faltar uma chave; um backup mais novo (com uma coluna que esta
      // versão não tem) não pode tentar inserir uma coluna inexistente.
      const params = {};
      for (const c of cols) params[c] = row[c] !== undefined ? row[c] : null;
      insertStmt.run(params);
    }
  }
});

// ---------- Reiniciar operação (zerar dados de teste/transição) ----------
// Portado de data/backupRepo.js#resetOperationalData da extensão: depois de
// um período de teste ou de transição vindo de outro sistema de PDV, a loja
// quer "zerar" pra começar a operar de verdade sem perder o CADASTRO que já
// levou trabalho pra montar. Metade das tabelas de BACKUP_TABLES é
// cadastro/config (não nasce de vender, só muda quando alguém edita de
// propósito); a outra metade é MOVIMENTO (nasce de cada venda, cada
// abertura de caixa, cada compra) — é só essa segunda metade que faz
// sentido zerar aqui.
//
// De propósito fora da lista (fica tudo intacto): `products` — inclusive a
// quantidade atual de cada um, é o motivo desta função existir — e
// `stock_movements`, o histórico dela (não referencia o id de nenhuma venda
// específica, então continua consistente mesmo com `sales` zerado);
// `company`, `users`, `suppliers` e `customers` (cadastro, não movimento).
// `financial_entries`, `customer_debts` e `loyalty_entries` não guardam
// nenhum saldo "solto" em cache — são sempre somados a partir da própria
// tabela na hora de mostrar (ver routes/finance.js, routes/customers.js,
// routes/loyalty.js) — então limpar cada uma aqui já deixa saldo de fiado e
// pontos de fidelidade voltando a zero sozinhos, sem precisar tocar em
// `customers` pra isso. `store_credits` (crédito de troca cross-terminal,
// sem equivalente na extensão) é MOVIMENTO no mesmo sentido de
// `loyalty_entries` — entra na lista.
export const RESET_TABLES = [
  'sales', 'cash_sessions', 'cash_movements', 'customer_debts', 'deliveries',
  'audit_log', 'purchase_orders', 'loyalty_entries', 'financial_entries', 'store_credits',
];

/** Apaga tudo que é MOVIMENTO (ver RESET_TABLES acima) — inclusive
 * `idempotency_keys` (mesmo raciocínio da extensão: as chaves de
 * deduplicação só fazem sentido junto da ação que as gerou, e ficariam
 * bloqueando ações novas e legítimas por coincidência de id depois do
 * reinício). Estoque (produtos + quantidade + histórico de movimentação),
 * dados da loja, usuários, fornecedores e clientes continuam exatamente
 * como estavam. Ação destrutiva e irreversível — quem chama isso já
 * confirmou com o usuário e já gerou um backup de segurança antes (ver
 * routes/backup.js). Tudo dentro de UMA ÚNICA transação, mesmo raciocínio
 * de applyBackupPayload() acima: ou zera tudo da lista, ou (numa falha no
 * meio do caminho) não muda nada — nunca fica pela metade. */
export const resetOperationalData = db.transaction(() => {
  for (const table of RESET_TABLES) db.prepare(`DELETE FROM ${table}`).run();
  db.prepare('DELETE FROM idempotency_keys').run();
});

export { BACKUP_FORMAT_VERSION };
