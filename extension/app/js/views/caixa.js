// Caixa da loja — abertura, sangria/suprimento e fechamento com conferência.
// Disponível pra admin e vendedor (é um caixa único da loja: quem está de
// turno abre e fecha, não é uma sessão pessoal de cada um). Toda ação aqui
// (abrir, sangria, suprimento, fechar) vai pro log de auditoria com
// usuário, data/hora e valores — independente da política de caixa
// obrigatório estar ligada ou não (ver Dados da loja > Políticas de venda).
import {
  getOpenSession, openSession, listSessionMovements, recordCashMovement,
  computeExpectedAmounts, closeSession, listSessions,
} from '../data/cashRepo.js';
import { logAction } from '../data/auditRepo.js';
import { formatMoney, formatDateTime, escapeHtml } from '../utils/format.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';

const METHOD_ORDER = ['Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Pix'];

function orderedMethods(amounts) {
  const keys = Object.keys(amounts);
  return [...METHOD_ORDER.filter((m) => keys.includes(m)), ...keys.filter((m) => !METHOD_ORDER.includes(m))];
}

export async function renderCaixa(container, ctx) {
  async function refresh() {
    const session = await getOpenSession();
    if (session) {
      await renderOpenSession(container, ctx, session, refresh);
    } else {
      await renderClosedState(container, ctx, refresh);
    }
  }
  await refresh();
}

async function renderClosedState(container, ctx, refresh) {
  const history = await listSessions();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Caixa</h1>
        <div class="desc">Nenhum caixa aberto no momento.</div>
      </div>
    </div>
    <div class="card" style="max-width:420px;margin-bottom:24px;">
      <p class="section-title mt-0">Abrir caixa</p>
      <div class="field">
        <label for="opening-amount">Valor inicial em dinheiro (troco)</label>
        <input id="opening-amount" type="number" min="0" step="0.01" value="0">
      </div>
      <button class="btn" id="open-session-btn" style="width:100%;">Abrir caixa</button>
    </div>
    <p class="section-title">Histórico de caixas</p>
    ${renderHistoryTable(history)}
  `;

  document.getElementById('open-session-btn').addEventListener('click', async () => {
    const amount = Number(document.getElementById('opening-amount').value) || 0;
    const session = await openSession({ userId: ctx.user.id, userName: ctx.user.nome, openingAmount: amount });
    await logAction({
      userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
      action: 'Abertura de caixa',
      details: `Caixa aberto com R$ ${amount.toFixed(2)} de troco inicial.`,
      entity: 'cashSession', entityId: session.id,
    });
    showToast('Caixa aberto.', 'success');
    refresh();
  });
}

async function renderOpenSession(container, ctx, session, refresh) {
  const [movements, expected] = await Promise.all([
    listSessionMovements(session.id),
    computeExpectedAmounts(session),
  ]);

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Caixa</h1>
        <div class="desc">Aberto por ${escapeHtml(session.openedBy.userName)} em ${formatDateTime(session.openedAt)} — troco inicial ${formatMoney(session.openingAmount)}.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" id="sangria-btn">− Sangria</button>
        <button class="btn btn-secondary" id="suprimento-btn">+ Suprimento</button>
        <button class="btn" id="close-session-btn">Fechar caixa</button>
      </div>
    </div>

    <div class="stat-grid">
      ${orderedMethods(expected).map((method) => `
        <div class="stat-card">
          <div class="label">${escapeHtml(method)}</div>
          <div class="value">${formatMoney(expected[method])}</div>
        </div>
      `).join('')}
    </div>

    <div class="card">
      <p class="section-title mt-0">Sangrias e suprimentos</p>
      ${movements.length === 0 ? '<div class="table-empty">Nenhum movimento registrado neste caixa ainda.</div>' : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Data/Hora</th><th>Tipo</th><th>Valor</th><th>Motivo</th><th>Usuário</th></tr></thead>
            <tbody>
              ${movements.map((m) => `
                <tr>
                  <td>${formatDateTime(m.timestamp)}</td>
                  <td>${m.type === 'sangria' ? '<span class="badge badge-red">Sangria</span>' : '<span class="badge badge-green">Suprimento</span>'}</td>
                  <td>${m.type === 'sangria' ? '−' : '+'}${formatMoney(m.amount)}</td>
                  <td>${escapeHtml(m.reason)}</td>
                  <td>${escapeHtml(m.userName)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  document.getElementById('sangria-btn').addEventListener('click', () => openMovementModal('sangria'));
  document.getElementById('suprimento-btn').addEventListener('click', () => openMovementModal('suprimento'));
  document.getElementById('close-session-btn').addEventListener('click', () => openCloseModal());

  function openMovementModal(type) {
    const label = type === 'sangria' ? 'Sangria (retirada)' : 'Suprimento (reforço)';
    openModal({
      title: label,
      submitLabel: 'Confirmar',
      bodyHtml: `
        <div id="modal-error"></div>
        <div class="field"><label>Valor *</label><input id="f-amount" type="number" min="0.01" step="0.01"></div>
        <div class="field"><label>Motivo *</label><input id="f-reason" placeholder="${type === 'sangria' ? 'Ex: depósito no banco' : 'Ex: reforço de troco'}"></div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const amount = Number(modalEl.querySelector('#f-amount').value) || 0;
        const reason = modalEl.querySelector('#f-reason').value.trim();
        try {
          const movement = await recordCashMovement({
            sessionId: session.id, type, amount, reason, userId: ctx.user.id, userName: ctx.user.nome,
          });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: type === 'sangria' ? 'Sangria de caixa' : 'Suprimento de caixa',
            details: `${type === 'sangria' ? 'Retirada' : 'Reforço'} de ${formatMoney(movement.amount)}. Motivo: ${movement.reason}.`,
            entity: 'cashSession', entityId: session.id,
          });
          showToast(`${label} registrada.`, 'success');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }

  function openCloseModal() {
    const methods = orderedMethods(expected);
    openModal({
      title: 'Fechar caixa',
      submitLabel: 'Confirmar fechamento',
      wide: true,
      bodyHtml: `
        <div id="modal-error"></div>
        <p class="text-muted" style="font-size:13px;">
          Conte o dinheiro físico da gaveta e informe abaixo. Os demais valores são só conferência
          contra o extrato da maquininha/pix — confirme se bateram ou ajuste se necessário.
        </p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Forma</th><th>Esperado pelo sistema</th><th>Contado</th></tr></thead>
            <tbody>
              ${methods.map((method) => `
                <tr>
                  <td>${escapeHtml(method)}</td>
                  <td>${formatMoney(expected[method])}</td>
                  <td><input type="number" step="0.01" data-count="${escapeHtml(method)}" value="${expected[method].toFixed(2)}" style="width:110px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;"></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Observações</label>
          <input id="f-notes" placeholder="Opcional">
        </div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const countedAmounts = {};
        methods.forEach((method) => {
          countedAmounts[method] = Number(modalEl.querySelector(`[data-count="${method}"]`).value) || 0;
        });
        const closingNotes = modalEl.querySelector('#f-notes').value.trim();

        const ok = await confirmDialog({
          title: 'Confirmar fechamento',
          message: 'Depois de fechado, este caixa não pode ser reaberto — só dá pra abrir um novo. Deseja continuar?',
          confirmLabel: 'Fechar caixa',
        });
        if (!ok) return false;

        try {
          const closed = await closeSession({
            sessionId: session.id, userId: ctx.user.id, userName: ctx.user.nome, countedAmounts, closingNotes,
          });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Fechamento de caixa',
            details: `Caixa fechado. Dinheiro esperado ${formatMoney(closed.expectedAmounts.Dinheiro)}, contado ${formatMoney(closed.countedAmounts.Dinheiro)}, diferença ${formatMoney(closed.difference)}.`
              + (closingNotes ? ` Obs: ${closingNotes}.` : ''),
            entity: 'cashSession', entityId: closed.id,
          });
          const diffLabel = Math.abs(closed.difference) < 0.01
            ? 'Caixa bateu certinho.'
            : closed.difference > 0
              ? `Sobrou ${formatMoney(closed.difference)} em caixa.`
              : `Faltou ${formatMoney(-closed.difference)} em caixa.`;
          showToast(`Caixa fechado. ${diffLabel}`, Math.abs(closed.difference) < 0.01 ? 'success' : 'error');
          refresh();
          return true;
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }
      },
    });
  }
}

function renderHistoryTable(sessions) {
  if (sessions.length === 0) return '<div class="table-wrap"><div class="table-empty">Nenhum caixa registrado ainda.</div></div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Aberto em</th><th>Aberto por</th><th>Fechado em</th><th>Fechado por</th><th>Diferença</th></tr></thead>
        <tbody>
          ${sessions.map((s) => `
            <tr>
              <td>${formatDateTime(s.openedAt)}</td>
              <td>${escapeHtml(s.openedBy.userName)}</td>
              <td>${s.closedAt ? formatDateTime(s.closedAt) : '<span class="badge badge-gold">Aberto</span>'}</td>
              <td>${s.closedBy ? escapeHtml(s.closedBy.userName) : '—'}</td>
              <td>${s.difference === null ? '—' : diffBadge(s.difference)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function diffBadge(difference) {
  if (Math.abs(difference) < 0.01) return '<span class="badge badge-green">Bateu certinho</span>';
  if (difference > 0) return `<span class="badge badge-gold">Sobrou ${formatMoney(difference)}</span>`;
  return `<span class="badge badge-red">Faltou ${formatMoney(-difference)}</span>`;
}
