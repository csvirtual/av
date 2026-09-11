import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'dados-da-loja.sqlite3');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// Achado de auditoria (P3): sem isto, better-sqlite3 lança SQLITE_BUSY na
// hora se o arquivo estiver momentaneamente travado por outro processo
// (ex.: uma ferramenta externa abrindo o .sqlite3 pra inspeção, ou uma
// segunda instância do servidor rodando por engano — ver o lockfile de PID
// em server.js, que existe justamente pra isso não acontecer). 5s de espera
// automática antes de desistir é imperceptível pra quem está operando o
// caixa e evita um erro 500 espúrio nesse tipo de colisão passageira.
db.pragma('busy_timeout = 5000');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// CREATE TABLE IF NOT EXISTS não adiciona coluna nova a uma tabela que já
// existia de uma versão anterior — cobre isso na mão pra não perder o banco
// de uma loja já em uso.
const cashSessionsCols = db.prepare('PRAGMA table_info(cash_sessions)').all().map((c) => c.name);
if (!cashSessionsCols.includes('terminal_id')) {
  db.exec('ALTER TABLE cash_sessions ADD COLUMN terminal_id TEXT');
}

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
