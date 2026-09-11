// Contato com o suporte pra pedir a chave de ativação — núcleo compartilhado
// entre a tela de bloqueio por trial/demo expirado (app.js) e o atalho
// "Solicitar chave" em Dados da loja (views/company.js), que precisa do
// mesmo fluxo mas ANTES do trial/demo ter expirado — por isso a mensagem
// recebe `reasonText` como parâmetro em vez de vir fixa. Porta quase
// literal de pdv-extension/app/js/components/supportContact.js.
import { openModal } from './modal.js';
import { icon } from './icon.js';
import { escapeHtml } from '../utils/format.js';

const SUPPORT_WHATSAPP = '5571986461027'; // 71 98646-1027, formato E.164 pro link wa.me
const SUPPORT_EMAIL = 'csvirtual.av@gmail.com';

function supportContactMessage(company, reasonText) {
  return `Olá! Uso o sistema PDV - C&S Virtual e ${reasonText}.\n\nLoja: ${company.nomeFantasia || '(não cadastrado)'}\nCNPJ: ${company.cnpj || '(não cadastrado)'}`;
}

function supportContactChipsHtml(company) {
  return `
    <div style="display:flex;gap:10px;margin-bottom:14px;">
      <div style="flex:1;background:var(--surface-alt);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 11px;">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px;">Loja</div>
        <div style="font-size:13.5px;font-weight:600;">${escapeHtml(company.nomeFantasia || '(não cadastrado)')}</div>
      </div>
      <div style="flex:1;background:var(--surface-alt);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 11px;">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px;">CNPJ</div>
        <div style="font-size:13.5px;font-weight:600;">${escapeHtml(company.cnpj || '(não cadastrado)')}</div>
      </div>
    </div>
  `;
}

export function openSupportWhatsappModal(company, reasonText) {
  const message = supportContactMessage(company, reasonText);
  openModal({
    title: 'Contato via WhatsApp',
    centerTitle: true,
    centerActions: true,
    submitLabel: `${icon('whatsapp', { size: 15 })} Abrir WhatsApp`,
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);line-height:1.5;text-align:center;">Vamos abrir uma conversa com o suporte no WhatsApp, já com a mensagem abaixo pronta pra enviar.</p>
      ${supportContactChipsHtml(company)}
      <div style="background:var(--surface-alt);border-radius:var(--radius-sm);padding:12px 14px;font-size:12.5px;color:var(--text-muted);line-height:1.6;white-space:pre-wrap;">${escapeHtml(message)}</div>
    `,
    onSubmit: () => {
      window.open(`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
      return true;
    },
  });
}

export function openSupportEmailModal(company, reasonText) {
  const message = supportContactMessage(company, reasonText);
  openModal({
    title: 'Contato por e-mail',
    centerTitle: true,
    centerActions: true,
    submitLabel: `${icon('mail', { size: 15 })} Enviar e-mail`,
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);line-height:1.5;text-align:center;">Confirme seu e-mail e clique em enviar — seu programa de e-mail abre com a mensagem pronta pra <strong>${escapeHtml(SUPPORT_EMAIL)}</strong>.</p>
      ${supportContactChipsHtml(company)}
      <div id="support-email-error"></div>
      <div class="field">
        <label for="support-contact-email">Seu e-mail para contato *</label>
        <input id="support-contact-email" type="email" placeholder="seuemail@exemplo.com" value="${escapeHtml(company.email || '')}">
      </div>
    `,
    onSubmit: (modalEl) => {
      const input = modalEl.querySelector('#support-contact-email');
      const contactEmail = input.value.trim();
      if (!contactEmail || !contactEmail.includes('@')) {
        modalEl.querySelector('#support-email-error').innerHTML = '<div class="form-error">Informe um e-mail válido.</div>';
        return false;
      }
      const subject = `Solicitação de chave de ativação — ${company.nomeFantasia || 'minha loja'}`;
      const body = `${message}\nE-mail para contato: ${contactEmail}`;
      window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return true;
    },
  });
}

// Atalho em Dados da loja, ao lado do botão "Ativar", pra ir direto pedir
// a chave ao suporte — mesmo fluxo que existe na tela de bloqueio por
// trial/demo expirado, mas alcançável a qualquer momento (mesmo com
// trial/demo ainda válido), sem precisar esperar travar.
export function openSupportContactChoiceModal(company, reasonText) {
  openModal({
    title: '<span style="text-transform:uppercase;">Solicitar chave de ativação</span>',
    centerTitle: true,
    centerActions: true,
    singleButton: true,
    submitLabel: 'Fechar',
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);line-height:1.5;text-align:center;">Escolha como prefere falar com o suporte pra receber sua chave.</p>
      <div style="display:flex;justify-content:center;gap:22px;">
        <div style="text-align:center;">
          <button type="button" class="contact-icon-btn" id="support-choice-whatsapp-btn" title="Falar no WhatsApp">${icon('whatsapp', { size: 42 })}</button>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">WhatsApp</div>
        </div>
        <div style="text-align:center;">
          <button type="button" class="contact-icon-btn" id="support-choice-email-btn" title="Enviar e-mail">${icon('mail', { size: 42 })}</button>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">E-mail</div>
        </div>
      </div>
    `,
    onMount: (modalEl, close) => {
      modalEl.querySelector('#support-choice-whatsapp-btn').addEventListener('click', () => {
        close();
        openSupportWhatsappModal(company, reasonText);
      });
      modalEl.querySelector('#support-choice-email-btn').addEventListener('click', () => {
        close();
        openSupportEmailModal(company, reasonText);
      });
    },
    onSubmit: () => true,
  });
}
