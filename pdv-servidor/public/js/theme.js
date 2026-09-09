// Preferência de aparência (claro/escuro/automático) — versão multi-
// terminal. Mesmo contrato de app/js/theme.js da extensão, mas persiste em
// localStorage (por navegador/perfil, sobrevive a fechar a aba) em vez de
// chrome.storage.local — é uma escolha "deste computador", não da loja
// (mesmo raciocínio do terminalId em apiClient.js), então não faz sentido
// nenhum morar no servidor: cada terminal decide seu próprio tema.
const KEY = 'theme.preference';

export async function getThemePreference() {
  return localStorage.getItem(KEY) || 'system'; // 'system' | 'light' | 'dark'
}

/** Aplica visualmente a preferência (atributo data-theme na <html>), sem
 * gravar nada — usado no boot pra já renderizar no tema certo desde o
 * primeiro frame, sem esperar a escrita no storage. */
export function applyTheme(value) {
  if (value === 'dark' || value === 'light') {
    document.documentElement.setAttribute('data-theme', value);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

export async function setThemePreference(value) {
  localStorage.setItem(KEY, value);
  applyTheme(value);
}
