// Estado do trial e da chave de ativação — de propósito em
// chrome.storage.local, NUNCA no IndexedDB (que é o que entra no backup,
// ver backupRepo.js/STORE_LABELS). Se isso morasse no banco, restaurar o
// backup de alguém já ativado destravaria a licença de qualquer instalação
// nova sozinho, sem chave nenhuma — o chrome.storage não viaja no arquivo
// de backup, então restaurar sempre continua sob o mesmo trial da chave, a
// menos que a própria pessoa digite uma chave válida depois.
import { verifyLicenseKey, TRIAL_DURATION_MS } from '../license.js';

const TRIAL_KEY = 'license.trialStartedAt';
const KEY_KEY = 'license.activationKey';

/** Registra o início do trial de 1h — só deve ser chamado uma única vez,
 * ao concluir o setup (cadastro do zero OU restauração de backup), nunca
 * em qualquer outro boot. Não sobrescreve se já existir (idempotente),
 * então chamar de novo por engano não reinicia o relógio. Uma instalação
 * que já tinha empresa/usuário cadastrados ANTES desta função existir
 * nunca passa por aqui — fica para sempre sem essa chave, ou seja, sem
 * efeito de trial nenhum (ver getGateStatus abaixo). */
export async function markTrialStartIfNeeded() {
  const data = await chrome.storage.local.get(TRIAL_KEY);
  if (data[TRIAL_KEY]) return;
  await chrome.storage.local.set({ [TRIAL_KEY]: Date.now() });
}

async function getTrialStartedAt() {
  const data = await chrome.storage.local.get(TRIAL_KEY);
  return data[TRIAL_KEY] || null;
}

async function getStoredActivationKey() {
  const data = await chrome.storage.local.get(KEY_KEY);
  return data[KEY_KEY] || null;
}

export async function setStoredActivationKey(keyString) {
  await chrome.storage.local.set({ [KEY_KEY]: keyString });
}

/** Estado completo de licenciamento desta instalação, já resolvido contra
 * o CNPJ da loja. Nunca bloqueia uma instalação que nunca teve
 * trialStartedAt gravado (grandfathering de instalações anteriores a esta
 * função, ver markTrialStartIfNeeded). */
export async function getLicenseStatus(cnpj) {
  const storedKey = await getStoredActivationKey();
  if (storedKey) {
    const result = await verifyLicenseKey(storedKey, cnpj);
    if (result.valid) {
      return result.tipo === 'demo'
        ? { active: true, tipo: 'demo', expiraEm: result.expiraEm }
        : { active: true, tipo: 'full', expiraEm: null };
    }
    // Chave guardada parou de valer (CNPJ mudou, demo expirou etc.) — cai
    // pro trial padrão como se não houvesse chave nenhuma.
  }

  const trialStartedAt = await getTrialStartedAt();
  if (!trialStartedAt) return { active: true, tipo: 'sem-trial' }; // instalação anterior a esta função — nunca bloqueia

  const expired = (Date.now() - trialStartedAt) > TRIAL_DURATION_MS;
  return expired
    ? { active: false, tipo: 'trial-expirado' }
    : { active: true, tipo: 'trial', expiraEm: trialStartedAt + TRIAL_DURATION_MS };
}
