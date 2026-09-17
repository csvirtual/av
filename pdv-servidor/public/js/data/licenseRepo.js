// Status e ativação de licença — versão multi-terminal. Diferente da
// extensão (data/licenseRepo.js, que guarda tudo em chrome.storage.local
// e resolve o status no próprio navegador), aqui o estado mora no
// servidor (ver lib/licenseState.js) — o cliente só pergunta/envia.
import { api } from './apiClient.js';

/** `{ active, tipo, expiraEm? }` — mesmo formato de getLicenseStatus() da
 * extensão. Chamado SEM sessão (ver routes/license.js), inclusive antes
 * do login, pra decidir se mostra a tela de bloqueio. */
export async function getLicenseStatus() {
  return api('/api/license/status');
}

/** Ativa uma chave (tipo 'demo' ou 'full' — 'cnpj-unlock' é rejeitado,
 * conferido no servidor). Devolve o novo status já resolvido. */
export async function activateLicenseKey(key) {
  return api('/api/license/activate', { method: 'POST', body: JSON.stringify({ key }) });
}
