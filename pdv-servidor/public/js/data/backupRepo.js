// Backup completo do sistema — versão multi-terminal. Mesmo contrato
// público de data/backupRepo.js da extensão (`getCurrentCounts`,
// `buildBackupBlob`, `readBackupFile`, `applyBackup`, `resetOperationalData`,
// `STORE_LABELS`, mais `buildAutomaticCashCloseBackup` — só que aqui a
// leitura/cifra/gravação acontecem no SERVIDOR (routes/backup.js,
// lib/backup.js), não numa worker local com IndexedDB: o servidor já tem o
// banco (SQLite) e a senha nunca precisa sair do HTTPS entre navegador e
// servidor — mesmo raciocínio já usado no backup automático de fechamento
// de caixa (ver POST /api/cash/backup-fechamento, a fatia que já existia
// aqui desde a Fase 9 passo 12).
//
// Nenhuma checagem de permissão aqui do lado do cliente — a permissão
// 'backup' já é exigida pelo servidor no mount inteiro de /api/backup (ver
// server.js), mesmo padrão de relatorios/logs/financeiro: a tela renderiza
// pra qualquer logado, mas qualquer chamada real de quem não tem a
// permissão recebe 403 do servidor.
import { api } from './apiClient.js';

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
  storeCredits: 'Créditos de troca (cross-terminal)',
};

// camelCase (chave de STORE_NAMES/STORE_LABELS, o "nome de gaveta" da
// extensão) -> nome de tabela SQL de verdade (ver lib/backup.js#BACKUP_TABLES).
const TABLE_BY_STORE_NAME = {
  company: 'company',
  users: 'users',
  products: 'products',
  sales: 'sales',
  stockMovements: 'stock_movements',
  auditLog: 'audit_log',
  cashSessions: 'cash_sessions',
  cashMovements: 'cash_movements',
  customers: 'customers',
  customerDebts: 'customer_debts',
  suppliers: 'suppliers',
  purchaseOrders: 'purchase_orders',
  financialEntries: 'financial_entries',
  loyaltyEntries: 'loyalty_entries',
  deliveries: 'deliveries',
  storeCredits: 'store_credits',
};

/** Traduz um objeto de contagens por TABELA (o que o servidor devolve, ver
 * lib/backup.js#getCurrentCounts/BACKUP_TABLES) pra um objeto por
 * "gaveta" camelCase (o que views/backup.js espera, pra casar com
 * STORE_NAMES/STORE_LABELS — mesmas chaves da extensão). */
function mapTableCountsToStoreNames(tableCounts) {
  const counts = {};
  for (const [storeName, table] of Object.entries(TABLE_BY_STORE_NAME)) {
    counts[storeName] = tableCounts?.[table] ?? 0;
  }
  return counts;
}

/** Quantos registros existem hoje em cada "gaveta" — usado pra mostrar "o
 * que vai ser substituído" antes de uma restauração. */
export async function getCurrentCounts() {
  const { counts } = await api('/api/backup/current-counts');
  return mapTableCountsToStoreNames(counts);
}

/** Gera o backup completo (o servidor lê o banco inteiro e cifra com
 * `password`) e devolve um Blob já pronto pra virar arquivo — não mexe em
 * disco nem dispara download nenhum, isso fica por conta da view (facilita
 * reuso e teste). Mesmo contrato de buildBackupBlob() da extensão. */
export async function buildBackupBlob(password) {
  const { envelope } = await api('/api/backup/export', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  return new Blob([JSON.stringify(envelope)], { type: 'application/json' });
}

/** Backup de segurança gerado SOZINHO a cada fechamento de caixa (ver
 * views/caixa.js) — já existia aqui desde a Fase 9 passo 12, mantido como
 * está: rota própria (POST /api/cash/backup-fechamento), de propósito fora
 * do router de Backup real (mesmo raciocínio do comentário dela — fechar
 * caixa não exige a permissão 'backup', é uma ação que qualquer vendedor já
 * pode fazer). */
export async function buildAutomaticCashCloseBackup(password) {
  const { envelope } = await api('/api/cash/backup-fechamento', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  return new Blob([JSON.stringify(envelope)], { type: 'application/json' });
}

/** Decifra e valida um arquivo de backup, sem gravar nada ainda — devolve
 * `{ payload, counts }`, `counts` já traduzido pra "gaveta" camelCase (ver
 * countsTableHtml em views/backup.js) e `payload` guardando só o que
 * `applyBackup` abaixo vai precisar reenviar pro servidor pra restaurar de
 * verdade (o envelope cifrado original + a senha) — a extensão guarda o
 * PAYLOAD JÁ DECIFRADO aqui (a decifra roda no navegador dela); aqui é o
 * SERVIDOR quem decifra (mesmo raciocínio de buildBackupBlob acima, a senha
 * nunca precisa virar uma segunda cópia decifrada no cliente à toa) — a
 * view nunca olha dentro de `payload` além de `payload.exportedAt` (pra
 * mostrar "gerado em..."), então o contrato de chamada continua idêntico. */
export async function readBackupFile(fileText, password) {
  let envelope;
  try {
    envelope = JSON.parse(fileText);
  } catch {
    throw new Error('Arquivo inválido — não parece ser um backup deste sistema.');
  }
  const { fileCounts, exportedAt } = await api('/api/backup/preview', {
    method: 'POST',
    body: JSON.stringify({ envelope, password }),
  });
  return {
    payload: { envelope, password, exportedAt },
    counts: mapTableCountsToStoreNames(fileCounts),
  };
}

/** Aplica os dados decifrados: apaga tudo que existe hoje e regrava com o
 * conteúdo do backup. Ação destrutiva e irreversível — quem chama isso já
 * confirmou com o usuário antes (ver views/backup.js). `payload` é o mesmo
 * objeto devolvido por readBackupFile() acima (`{ envelope, password,
 * exportedAt }`) — reenviado pro servidor, que decifra de novo e aplica
 * tudo dentro de uma única transação SQL (ver lib/backup.js#
 * applyBackupPayload). */
export async function applyBackup(payload) {
  await api('/api/backup/import', {
    method: 'POST',
    body: JSON.stringify({ envelope: payload.envelope, password: payload.password }),
  });
}

/** Apaga tudo que é MOVIMENTO (vendas, caixa, financeiro, fiado, carreto,
 * compras, fidelidade, crédito de troca, log de auditoria) preservando
 * estoque, dados da loja, usuários, fornecedores e clientes — ver
 * lib/backup.js#resetOperationalData no servidor. Ação destrutiva e
 * irreversível — quem chama isso já confirmou a identidade e já gerou um
 * backup de segurança antes (ver views/backup.js). */
export async function resetOperationalData() {
  await api('/api/backup/reset', { method: 'POST' });
}
