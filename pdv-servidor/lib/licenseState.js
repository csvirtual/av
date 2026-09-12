// Estado do trial/ativação — mesmo papel de licenseRepo.js da extensão
// (que usa chrome.storage.local), só que aqui é uma tabela própria do
// servidor (`license_state`, ver db/schema.sql), de propósito FORA de
// BACKUP_TABLES (lib/backup.js) — restaurar um backup nunca reseta o
// trial nem apaga uma ativação já feita (mesmo raciocínio documentado lá
// e no schema).
import { db } from '../db/index.js';
import { verifyLicenseKey, TRIAL_DURATION_MS } from './license.js';

const getStmt = db.prepare('SELECT data FROM license_state WHERE id = ?');
const upsertStmt = db.prepare(`
  INSERT INTO license_state (id, data) VALUES ('state', @data)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data
`);

function getState() {
  const row = getStmt.get('state');
  if (!row) return {};
  try {
    return JSON.parse(row.data);
  } catch {
    return {};
  }
}

function setState(partial) {
  const merged = { ...getState(), ...partial };
  upsertStmt.run({ data: JSON.stringify(merged) });
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
export function markTrialStartIfNeeded() {
  const state = getState();
  if (state.trialStartedAt) return;
  setState({ trialStartedAt: Date.now() });
}

/** Estado completo de licenciamento, já resolvido contra o CNPJ atual da
 * loja — mesmo contrato de getLicenseStatus() da extensão. */
export async function getLicenseStatus(cnpj) {
  const state = getState();
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

export function setStoredActivationKey(keyString) {
  setState({ activationKey: keyString });
}
