// Wrapper de fetch compartilhado por TODOS os módulos data/*.js do modo
// multi-terminal (productsRepo.js, stockRepo.js, e os que vierem depois) —
// mesmo papel que db.js tem pra extensão single-machine (um lugar só pro
// "como falar com a fonte de dados"), só que aqui a fonte é o servidor por
// HTTP em vez do IndexedDB local. Extraído do protótipo em
// public/test.html (função `api()` de lá), pra não duplicar em cada
// repositório novo.
const TERMINAL_ID_KEY = 'terminalId';

// Identidade da MÁQUINA/navegador (não confundir com o usuário logado,
// que pode trocar sem trocar de terminal) — gerada uma vez, sobrevive a
// F5, é única por navegador/perfil. O servidor só usa isto no modo de
// caixa "porTerminal" (Fase 3), pra saber qual sessão de caixa pertence a
// qual máquina física; as demais rotas ignoram o cabeçalho.
function getOrCreateTerminalId() {
  let id = localStorage.getItem(TERMINAL_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(TERMINAL_ID_KEY, id);
  }
  return id;
}
const terminalId = getOrCreateTerminalId();

/** Chama a API do servidor e devolve o corpo já decodificado — lança um
 * Error com a mensagem amigável do servidor (`{ error: '...' }`) em vez de
 * um genérico "Failed to fetch" quando a resposta não é 2xx, pra encaixar
 * direto no mesmo padrão try/catch que as telas (views/*.js) já usam com
 * os repositórios da extensão single-machine (que também sempre lançam
 * Error com mensagem pronta pra mostrar). */
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Terminal-Id': terminalId, ...(opts.headers || {}) },
    credentials: 'include',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
  return body;
}

/** Chave de deduplicação pra proteger contra reenvio (duplo clique, F5
 * numa requisição em voo) — mesmo papel do `newId()` usado como dedupeKey
 * nas telas da extensão single-machine (ver views/products.js, sale.js
 * etc.), só que aqui vira o campo `dedupeKey` mandado pro servidor
 * reivindicar contra a tabela `idempotency_keys` (ver routes/*.js). */
export function newDedupeKey() {
  return crypto.randomUUID();
}
