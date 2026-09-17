// A linha 'config' de `company` guarda TODAS as configurações da loja num
// JSON só (modo de caixa, taxas de fidelidade...) — updateConfig faz
// leitura+mescla+gravação, nunca sobrescreve o blob inteiro, senão salvar
// uma configuração apagava a outra que já estivesse lá (ex: mudar o modo de
// caixa zerando a taxa de fidelidade configurada antes).
import { db } from '../db/index.js';

const GET_SQL = 'SELECT data FROM company WHERE id = ?';
const UPSERT_SQL = `
  INSERT INTO company (id, data) VALUES ('config', @data)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data
`;

// `targetDb` opcional em todo este arquivo (etapa 5 do roteiro multi-tenant,
// ver artifact "PDV Multi-Tenant") — normalmente req.db, resolvido pelo
// tenant da requisição. Sem ele (todo call site de hoje), lê/grava no
// banco fixo do processo, comportamento idêntico a sempre.
export function getConfig(targetDb = db) {
  const row = targetDb.prepare(GET_SQL).get('config');
  if (!row) return {};
  try {
    return JSON.parse(row.data);
  } catch {
    return {};
  }
}

export function updateConfig(partial, targetDb = db) {
  const merged = { ...getConfig(targetDb), ...partial };
  targetDb.prepare(UPSERT_SQL).run({ data: JSON.stringify(merged) });
  return merged;
}
