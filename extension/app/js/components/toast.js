// Notificações rápidas no canto inferior direito da tela (sucesso/erro),
// usadas em todas as views para dar feedback de ações (venda registrada,
// erro de validação...). Ficam visíveis por 5s por padrão — dá pra passar
// uma duração diferente pra um aviso específico que precise de mais tempo.
const DEFAULT_DURATION_MS = 5000;

export function showToast(message, type = 'info', duration = DEFAULT_DURATION_MS) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.25s ease';
    setTimeout(() => el.remove(), 250);
  }, duration);
}
