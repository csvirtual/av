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

  // Achado do usuário (etapa 9, multi-tenant): markTrialStartIfNeeded() só
  // era chamado UMA VEZ, no arranque do servidor (ver server.js), contra
  // o banco FIXO de db/index.js — nunca contra o banco de CADA loja em
  // modo multi-tenant (cada tenant abre o próprio arquivo só quando a
  // primeira requisição pra ele chega, bem depois do arranque). Sem isso,
  // toda loja nova ficava presa pra sempre em "sem-trial" (mostrado na
  // tela como "Sem restrição de licença", como se o trial de 7 dias nunca
  // tivesse existido). Inicia aqui, lazy, na primeira LEITURA de status
  // — cobre os dois modos (legado e multi-tenant) sem depender de nenhum
  // outro ponto do código lembrar de chamar isto no momento certo.
  const trialStartedAt = state.trialStartedAt || setState({ trialStartedAt: Date.now() }, targetDb).trialStartedAt;
  const expired = (Date.now() - trialStartedAt) > TRIAL_DURATION_MS;
  return expired
    ? { active: false, tipo: 'trial-expirado', keyIssue }
    : { active: true, tipo: 'trial', expiraEm: trialStartedAt + TRIAL_DURATION_MS, keyIssue };
}

export function setStoredActivationKey(keyString, targetDb = db) {
  setState({ activationKey: keyString }, targetDb);
}

/** Reinicia o relógio do período de teste de 7 dias — usado quando o Super
 * Admin seleciona "trial" no Painel de Controle e salva (ver
 * routes/admin/tenants.js), pra "renovar" uma loja que tinha sido
 * suspensa automaticamente por trial vencido (ver
 * control/db.js#autoSuspendExpiredTrial). Não mexe numa chave de
 * ativação eventualmente guardada — ela continua tendo prioridade em
 * getLicenseStatus() se ainda for válida, então reiniciar o relógio de
 * trial é inofensivo nesse caso (nunca é lido). */
export function restartTrial(targetDb = db) {
  setState({ trialStartedAt: Date.now() }, targetDb);
}
