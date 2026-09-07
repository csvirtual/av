import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'dados-da-loja.sqlite3');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// CREATE TABLE IF NOT EXISTS não adiciona coluna nova a uma tabela que já
// existia de uma versão anterior — cobre isso na mão pra não perder o banco
// de uma loja já em uso.
const cashSessionsCols = db.prepare('PRAGMA table_info(cash_sessions)').all().map((c) => c.name);
if (!cashSessionsCols.includes('terminal_id')) {
  db.exec('ALTER TABLE cash_sessions ADD COLUMN terminal_id TEXT');
}
