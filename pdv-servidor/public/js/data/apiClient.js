// Wrapper de fetch compartilhado por TODOS os módulos data/*.js do modo
// multi-terminal (productsRepo.js, stockRepo.js, e os que vierem depois) —
// mesmo papel que db.js tem pra extensão single-machine (um lugar só pro
// "como falar com a fonte de dados"), só que aqui a fonte é o servidor por
// HTTP em vez do IndexedDB local. Extraído do protótipo em
// public/test.html (função `api()` de lá), pra não duplicar em cada
// repositório novo.
const TERMINAL_ID_KEY = 'terminalId';

// Em HTTP puro (sem certificado), o navegador bloqueia crypto.randomUUID()
// — só libera em contexto seguro (HTTPS ou localhost). Este sistema roda
// em rede local por HTTP simples por design, então precisamos de um plano
// B: crypto.getRandomValues() continua funcionando mesmo sem HTTPS, e só
// no pior caso (sem Web Crypto nenhuma) cai pra Math.random().
function gerarUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Identidade da MÁQUINA/navegador (não confundir com o usuário logado,
// que pode trocar sem trocar de terminal) — gerada uma vez, sobrevive a
// F5, é única por navegador/perfil. O servidor só usa isto no modo de
// caixa "porTerminal" (Fase 3), pra saber qual sessão de caixa pertence a
// qual máquina física; as demais rotas ignoram o cabeçalho.
function getOrCreateTerminalId() {
  let id = localStorage.getItem(TERMINAL_ID_KEY);
  if (!id) {
    id = gerarUUID();
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
  return gerarUUID();
}
