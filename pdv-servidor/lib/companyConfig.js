// A linha 'config' de `company` guarda TODAS as configurações da loja num
// JSON só (modo de caixa, taxas de fidelidade...) — updateConfig faz
// leitura+mescla+gravação, nunca sobrescreve o blob inteiro, senão salvar
// uma configuração apagava a outra que já estivesse lá (ex: mudar o modo de
// caixa zerando a taxa de fidelidade configurada antes).
import { db } from '../db/index.js';

const getConfigStmt = db.prepare('SELECT data FROM company WHERE id = ?');
const upsertConfigStmt = db.prepare(`
  INSERT INTO company (id, data) VALUES ('config', @data)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data
`);

export function getConfig() {
  const row = getConfigStmt.get('config');
  if (!row) return {};
  try {
    return JSON.parse(row.data);
  } catch {
    return {};
  }
}

export function updateConfig(partial) {
  const merged = { ...getConfig(), ...partial };
  upsertConfigStmt.run({ data: JSON.stringify(merged) });
  return merged;
}
