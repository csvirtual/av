// Notificações rápidas no canto inferior direito da tela (sucesso/erro),
// usadas em todas as views para dar feedback de ações (venda registrada,
// erro de validação...). Ficam visíveis por 5s por padrão — dá pra passar
// uma duração diferente pra um aviso específico que precise de mais tempo.
import { icon } from './icon.js';

const DEFAULT_DURATION_MS = 5000;

// `message` aceita uma string simples (a maioria das chamadas) OU uma
// lista de partes — [{ text }, { icon: 'warning' }, { text }, ...] — pra
// quando o aviso precisa de um ícone SVG no meio do texto (ex: caixa.js,
// aviso de auditoria/backup que falhou). Cada parte de texto sempre entra
// via createTextNode (nunca innerHTML) — mesma garantia de antes contra
// mensagem dinâmica (ex: err.message) virar HTML/script sem querer; só a
// marcação do ícone (sempre um nome fixo escolhido no código, nunca dado
// externo) passa por innerHTML.
export function showToast(message, type = 'info', duration = DEFAULT_DURATION_MS) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const parts = typeof message === 'string' ? [{ text: message }] : message;
  for (const part of parts) {
    if (part.icon) {
      const iconWrap = document.createElement('span');
      iconWrap.className = 'toast-icon';
      iconWrap.innerHTML = icon(part.icon, { size: 14 });
      el.appendChild(iconWrap);
    } else {
      el.appendChild(document.createTextNode(part.text));
    }
  }
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.25s ease';
    setTimeout(() => el.remove(), 250);
  }, duration);
}
