// Formatação de moeda, data e hora — tudo em pt-BR, usando Intl (nativo do
// navegador, sem biblioteca externa).
const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
const timeFormatter = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });

export function formatMoney(value) {
  return currencyFormatter.format(Number(value) || 0);
}

export function formatDate(timestamp) {
  return dateFormatter.format(new Date(timestamp));
}

export function formatDateTime(timestamp) {
  return dateTimeFormatter.format(new Date(timestamp));
}

export function formatTime(timestamp) {
  return timeFormatter.format(new Date(timestamp));
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
