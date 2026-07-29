// Contas locais do dispositivo: cada uma tem seu próprio espaço de dados
// (configurações, arquivos, senha) via o prefixo de conta do kv-store — ver
// core/state/kv-store.js. Este módulo só cuida da LISTA de contas em si
// (nome/avatar exibidos na tela de seleção), que fica fora do espaço de
// qualquer conta (kv.global).
import { kv } from '../state/kv-store.js';

export async function listAccounts() {
  return kv.global.get('accounts', []);
}

export async function addAccountRecord({ id, name, avatar = null }) {
  const accounts = await listAccounts();
  accounts.push({ id, name, avatar });
  await kv.global.set('accounts', accounts);
}

export async function updateAccountRecord(id, patch) {
  const accounts = await listAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) return;
  accounts[idx] = { ...accounts[idx], ...patch };
  await kv.global.set('accounts', accounts);
}

export async function removeAccountRecord(id) {
  const accounts = await listAccounts();
  await kv.global.set('accounts', accounts.filter((a) => a.id !== id));
}

export async function getLastActiveAccountId() {
  return kv.global.get('lastActiveAccountId', null);
}

export async function setLastActiveAccountId(id) {
  await kv.global.set('lastActiveAccountId', id);
}

export function newAccountId() {
  return crypto.randomUUID();
}
