// Estado do trial/ativação — mesmo papel de licenseRepo.js da extensão
// (que usa chrome.storage.local), só que aqui é uma tabela própria do
// servidor (`license_state`, ver db/schema.sql), de propósito FORA de
// BACKUP_TABLES (lib/backup.js) — restaurar um backup nunca reseta o
// trial nem apaga uma ativação já feita (mesmo raciocínio documentado lá
// e no schema).
import { db } from '../db/index.js';
import { verifyLicenseKey, TRIAL_DURATION_MS } from './license.js';

const GET_SQL = 'SELECT data FROM license_state WHERE id = ?';
const UPSERT_SQL = `
  INSERT INTO license_state (id, data) VALUES ('state', @data)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data
`;

// `targetDb` opcional em todo este arquivo (etapa 5 do roteiro multi-tenant,
// ver artifact "PDV Multi-Tenant") — normalmente req.db, resolvido pelo
// tenant da requisição. Sem ele (todo call site de hoje), lê/grava no
// banco fixo do processo, comportamento idêntico a sempre.
function getState(targetDb) {
  const row = targetDb.prepare(GET_SQL).get('state');
  if (!row) return {};
  try {
    return JSON.parse(row.data);
  } catch {
    return {};
  }
}

function setState(partial, targetDb) {
  const merged = { ...getState(targetDb), ...partial };
  targetDb.prepare(UPSERT_SQL).run({ data: JSON.stringify(merged) });
  return merged;
}

/** Registra o início do trial — chamado uma vez a cada arranque do
 * servidor (ver server.js), idempotente (não sobrescreve se já existir).
 * Diferente da extensão (que só registra ao concluir o assistente de
 * primeira execução — este servidor não tem um), aqui o próprio primeiro
 * arranque É o evento equivalente de "instalação nova": não existe
 * nenhum estado anterior a preservar (esta tabela nasceu com esta
 * funcionalidade), então não há "instalação já existente" pra
 * grandfather — a partir de agora, todo primeiro arranque começa o
 * relógio. */
export function markTrialStartIfNeeded(targetDb = db) {
  const state = getState(targetDb);
  if (state.trialStartedAt) return;
  setState({ trialStartedAt: Date.now() }, targetDb);
}

/** Estado completo de licenciamento, já resolvido contra o CNPJ atual da
 * loja — mesmo contrato de getLicenseStatus() da extensão. */
export async function getLicenseStatus(cnpj, targetDb = db) {
  const state = getState(targetDb);
  // Achado do usuário: uma chave definitiva guardada que pára de bater com
  // o CNPJ atual (ex: restaurou um backup com um CNPJ diferente do que
  // estava quando a chave foi ativada — `company` está em BACKUP_TABLES,
  // `license_state` não) sempre caiu pro trial em silêncio, sem NENHUMA
  // pista de que existia uma chave guardada que parou de funcionar —
  // parecia que a ativação tinha simplesmente sumido. `keyIssue` carrega
  // o motivo (mesmo `reason` de verifyLicenseKey) pra tela poder avisar
  // exatamente o que aconteceu, em vez de mostrar só "período de teste"
  // como se nunca tivesse existido chave nenhuma.
  let keyIssue = null;
  if (state.activationKey) {
    const result = await verifyLicenseKey(state.activationKey, cnpj);
    if (result.valid) {
      return result.tipo === 'demo'
        ? { active: true, tipo: 'demo', expiraEm: result.expiraEm }
        : { active: true, tipo: 'full', expiraEm: null };
    }
    // Chave guardada parou de valer (CNPJ mudou, demo expirou etc.) — cai
    // pro trial padrão como se não houvesse chave nenhuma, mas agora
    // avisando o motivo (keyIssue) em vez de ficar em silêncio.
    keyIssue = result.reason;
  }

  if (!state.trialStartedAt) return { active: true, tipo: 'sem-trial', keyIssue }; // nunca deveria acontecer (markTrialStartIfNeeded roda todo arranque), mas nunca bloqueia por segurança
  const expired = (Date.now() - state.trialStartedAt) > TRIAL_DURATION_MS;
  return expired
    ? { active: false, tipo: 'trial-expirado', keyIssue }
    : { active: true, tipo: 'trial', expiraEm: state.trialStartedAt + TRIAL_DURATION_MS, keyIssue };
}

export function setStoredActivationKey(keyString, targetDb = db) {
  setState({ activationKey: keyString }, targetDb);
}
