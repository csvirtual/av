// Preferência de aparência (claro/escuro/automático) — persiste em
// chrome.storage.local, que sobrevive a fechar o navegador (diferente de
// chrome.storage.session, usado só pra sessão de login). É uma escolha
// explícita do usuário e tem prioridade sobre o tema do sistema
// operacional quando definida como 'light' ou 'dark'; 'system' (padrão)
// simplesmente não define o atributo, deixando o @media
// (prefers-color-scheme: dark) do CSS decidir sozinho — ver styles.css.
const KEY = 'theme.preference';

export async function getThemePreference() {
  const data = await chrome.storage.local.get(KEY);
  return data[KEY] || 'system'; // 'system' | 'light' | 'dark'
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
  await chrome.storage.local.set({ [KEY]: value });
  applyTheme(value);
}
