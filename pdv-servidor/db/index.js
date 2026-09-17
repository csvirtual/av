// Ponto de entrada pro banco de UM tenant. Desde a etapa 2 do roteiro
// multi-tenant (ver artifact "PDV Multi-Tenant"), na prática um pool
// cacheado (getTenantDb) por cima de db/connection.js#openTenantConnection
// — a lógica de aplicar schema.sql + migrações mudou de lugar, mas é
// idêntica.
//
// `db` (o export de sempre) continua existindo e continua síncrono/pronto
// na hora do import — TODO o resto do código (14 arquivos de routes/*.js +
// praticamente todo lib/*.js) ainda importa `{ db }` direto e faz
// `db.prepare(...)` no topo do próprio módulo, então isso não pode virar
// assíncrono nem preguiçoso sem quebrar tudo — essa troca só acontece numa
// etapa futura do roteiro (routes/*.js passando a usar req.db, resolvido
// por requisição). Por enquanto `db` resolve SEMPRE o mesmo tenant fixo: o
// indicado pela variável de ambiente TENANT_ID, ou — se ela não estiver
// definida, que é o caso de toda instalação de hoje — o arquivo
// dados-da-loja.sqlite3 de sempre, no mesmo lugar de sempre. Nada muda pra
// quem não optou em multi-tenant.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlDb } from '../control/db.js';
import { openTenantConnection } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_DB_PATH = path.join(__dirname, '..', 'dados-da-loja.sqlite3');
// Chave interna do pool pro caso "sem multi-tenant configurado" — nunca é
// um id de tenant de verdade (esses são uuids), então não colide.
const LEGACY_TENANT_KEY = '__legacy__';

const pool = new Map();

function resolveDbPath(tenantId) {
  if (tenantId === LEGACY_TENANT_KEY) return LEGACY_DB_PATH;
  const row = controlDb.prepare('SELECT db_path FROM tenants WHERE id = ?').get(tenantId);
  if (!row) throw new Error(`Tenant desconhecido: "${tenantId}".`);
  return row.db_path;
}

/** Devolve a conexão do tenant pedido, abrindo (e aplicando schema +
 * migrações) só na primeira vez — chamadas seguintes pro mesmo tenantId
 * reusam a mesma conexão cacheada, nunca reabrem o arquivo. */
export function getTenantDb(tenantId) {
  const cached = pool.get(tenantId);
  if (cached) return cached;
  const conn = openTenantConnection(resolveDbPath(tenantId));
  pool.set(tenantId, conn);
  return conn;
}

const FIXED_TENANT_ID = process.env.TENANT_ID || LEGACY_TENANT_KEY;
export const db = getTenantDb(FIXED_TENANT_ID);

// Achado de auditoria (P4): cada chamada mutadora precisa de `dedupeKey`
// (ver rotas em routes/*.js) e cada uma grava uma linha nova em
// `idempotency_keys` que nunca é apagada sozinha — numa loja usando o
// sistema todo santo dia, a tabela só cresce pra sempre. Uma `dedupeKey`
// só existe pra pegar um duplo-clique/reenvio da MESMA tentativa (janela de
// segundos/minutos, nunca dias) — 30 dias de retenção é bem mais folga do
// que qualquer reenvio legítimo precisaria, e ainda deixa uma margem grande
// pra investigar algo estranho no log antes da linha sumir. Mesmo padrão
// de sweepExpiredSessions (lib/session.js), chamado pelo mesmo
// `setInterval` periódico em server.js.
const IDEMPOTENCY_KEY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const deleteOldIdempotencyKeysStmt = db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?');
export function sweepOldIdempotencyKeys() {
  deleteOldIdempotencyKeysStmt.run(Date.now() - IDEMPOTENCY_KEY_RETENTION_MS);
}

// Achado de auditoria (DRY): mesma validação + mesmo INSERT copiados
// idênticos em 8 arquivos de rota (vendas, caixa, clientes, entregas,
// financeiro, fidelidade, produtos, compras) — cada operação mutadora
// "reivindica" a própria dedupeKey antes de prosseguir, e a constraint
// UNIQUE da tabela é quem de fato barra um reenvio duplicado (duplo
// clique, retry automático do navegador). Fonte única agora: mesma regra,
// um lugar só. `targetDb` sempre passado explicitamente pelas rotas (o
// tenant da requisição) — sem default pra `db` de propósito, isto roda
// dentro da MESMA transação da operação que está protegendo, nunca faria
// sentido cair silenciosamente no banco errado.
const CLAIM_IDEMPOTENCY_KEY_SQL = 'INSERT INTO idempotency_keys (key, created_at) VALUES (?, ?)';
export function claimIdempotencyKey(dedupeKey, targetDb) {
  if (!dedupeKey) throw new Error('Requisição sem identificador de deduplicação.');
  targetDb.prepare(CLAIM_IDEMPOTENCY_KEY_SQL).run(dedupeKey, Date.now());
}
