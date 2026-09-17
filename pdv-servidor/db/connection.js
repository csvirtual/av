// Abre (ou cria do zero) o arquivo `.sqlite3` de UMA loja, já com
// `schema.sql` aplicado e as migrações programáticas em dia. Extraído de
// db/index.js na etapa 2 do roteiro multi-tenant (ver artifact "PDV
// Multi-Tenant") pra virar uma função pura, sem nenhum efeito colateral de
// import — quem decide QUAL arquivo abrir é sempre quem chama: db/index.js
// pro tenant fixo de hoje (pool cacheado), scripts/createTenant.js pra
// provisionar ou adotar uma loja nova.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

export function openTenantConnection(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const conn = new Database(dbPath);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  // Achado de auditoria (P3): sem isto, better-sqlite3 lança SQLITE_BUSY na
  // hora se o arquivo estiver momentaneamente travado por outro processo
  // (ex.: uma ferramenta externa abrindo o .sqlite3 pra inspeção, ou uma
  // segunda instância do servidor rodando por engano). 5s de espera
  // automática antes de desistir é imperceptível pra quem está operando o
  // caixa e evita um erro 500 espúrio nesse tipo de colisão passageira.
  conn.pragma('busy_timeout = 5000');

  conn.exec(SCHEMA_SQL);

  // CREATE TABLE IF NOT EXISTS não adiciona coluna nova a uma tabela que já
  // existia de uma versão anterior de schema.sql — cobre isso na mão pra
  // não perder o banco de uma loja já em uso (inclusive uma adotada via
  // scripts/createTenant.js --from-existing, que pode vir de uma versão
  // bem mais antiga do sistema).
  const cashSessionsCols = conn.prepare('PRAGMA table_info(cash_sessions)').all().map((c) => c.name);
  if (!cashSessionsCols.includes('terminal_id')) {
    conn.exec('ALTER TABLE cash_sessions ADD COLUMN terminal_id TEXT');
  }
  // Modo de caixa "por vendedor" (além de "único" e "porTerminal") — cada
  // operador abre/fecha o seu, estoque continua compartilhado. Precisa de
  // uma coluna própria pra achar "o caixa aberto deste usuário" e pro
  // índice único abaixo. Aplicado aqui (nunca dentro de schema.sql) de
  // propósito: `conn.exec(SCHEMA_SQL)` já rodou ANTES deste bloco — um
  // CREATE INDEX dentro do schema apontando pra uma coluna que só passa a
  // existir DEPOIS deste ALTER quebraria justamente no banco de uma loja já
  // em uso, que é o caso que este bloco inteiro existe pra proteger.
  if (!cashSessionsCols.includes('user_id')) {
    conn.exec('ALTER TABLE cash_sessions ADD COLUMN user_id TEXT');
  }
  conn.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cashsessions_open_user_unique
    ON cash_sessions(user_id) WHERE status = 'aberto' AND user_id IS NOT NULL
  `);

  return conn;
}
