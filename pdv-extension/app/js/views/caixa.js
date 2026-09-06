// Caixa da loja — abertura, sangria/suprimento e fechamento com conferência.
// Disponível pra admin e vendedor (é um caixa único da loja: quem está de
// turno abre e fecha, não é uma sessão pessoal de cada um). Toda ação aqui
// (abrir, sangria, suprimento, fechar) vai pro log de auditoria com
// usuário, data/hora e valores — independente da política de caixa
// obrigatório estar ligada ou não (ver Dados da loja > Políticas de venda).
//
// Fechar caixa exige digitar usuário e senha de QUALQUER conta ativa (admin
// ou vendedor, não importa qual) como confirmação — e essa mesma senha, ao
// ser aceita, já criptografa um backup completo gerado e baixado sozinho na
// hora (ver openCloseModal mais abaixo), como segurança extra de fim de
// turno, sem depender de alguém lembrar de ir em Backup fazer isso manualmente.
import {
  getOpenSession, openSession, listSessionMovements, recordCashMovement,
  computeExpectedAmounts, closeSession, listSessions, recordCashAdjustment, effectiveAmount,
} from '../data/cashRepo.js';
import { confirmUserPassword } from '../components/passwordConfirm.js';
import { buildAutomaticCashCloseBackup } from '../data/backupRepo.js';
import { logAction } from '../data/auditRepo.js';
import { formatMoney, formatDateTime, escapeHtml, BASE_PAYMENT_METHODS } from '../utils/format.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { downloadBlob, timestampForFilename } from './backup.js';
import { paginationHtml, wirePagination, createPageState } from '../components/pagination.js';

const METHOD_ORDER = BASE_PAYMENT_METHODS;

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
    <div id="caixa-history-box"></div>
  `;

  // Paginação numerada do histórico (ver components/pagination.js) — só
  // troca o conteúdo desta caixinha, não o "Abrir caixa" acima, então
  // trocar de página não perde o que já tinha sido digitado no valor
  // inicial.
  let pgState = createPageState();
  const historyBox = document.getElementById('caixa-history-box');
  function renderHistorySection() {
    const total = history.length;
    const totalPages = Math.max(1, Math.ceil(total / pgState.pageSize));
    if (pgState.page > totalPages) pgState.page = totalPages;
    const start = (pgState.page - 1) * pgState.pageSize;
    historyBox.innerHTML = `
      ${renderHistoryTable(history.slice(start, start + pgState.pageSize))}
      ${paginationHtml({ page: pgState.page, pageSize: pgState.pageSize, total })}
    `;
    wirePagination(historyBox, pgState, (next) => { pgState = next; renderHistorySection(); });
  }
  renderHistorySection();

  const openBtn = document.getElementById('open-session-btn');
  openBtn.addEventListener('click', async () => {
    // openSession rejeita abrir um segundo caixa se já existir um aberto
    // (ex: duplo clique, ou duas abas abrindo ao mesmo tempo) — sem
    // try/catch aqui, esse erro sumia sem avisar ninguém, e um clique
    // duplo bem rápido podia disparar duas chamadas em paralelo antes do
    // primeiro terminar. Trava + try/catch, achado de auditoria.
    if (openBtn.disabled) return;
    openBtn.disabled = true;
    const amount = Number(document.getElementById('opening-amount').value) || 0;
    try {
      const session = await openSession({ userId: ctx.user.id, userName: ctx.user.nome, openingAmount: amount });
      await logAction({
        userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
        action: 'Abertura de caixa',
        details: `Caixa aberto com R$ ${amount.toFixed(2)} de troco inicial.`,
        entity: 'cashSession', entityId: session.id,
      });
      showToast('Caixa aberto.', 'success');
      refresh();
    } catch (err) {
      showToast(err.message, 'error');
      openBtn.disabled = false;
    }
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
        <button class="btn btn-secondary" id="adjust-btn">Retificar</button>
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
                  <td>${movementBadge(m)}</td>
                  <td>${m.type === 'ajuste' ? (m.amount >= 0 ? '+' : '−') : (m.type === 'sangria' ? '−' : '+')}${formatMoney(Math.abs(m.amount))}</td>
                  <td>${m.type === 'ajuste' ? escapeHtml(describeAdjustment(m, movements)) : escapeHtml(m.reason)}</td>
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
  document.getElementById('adjust-btn').addEventListener('click', () => openAdjustModal());
  document.getElementById('close-session-btn').addEventListener('click', () => openCloseModal());

  function movementBadge(m) {
    if (m.type === 'ajuste') return '<span class="badge badge-gold">Retificação</span>';
    return m.type === 'sangria' ? '<span class="badge badge-red">Sangria</span>' : '<span class="badge badge-green">Suprimento</span>';
  }

  // Descrição legível de uma retificação — mostra o que foi corrigido (troco
  // inicial ou qual sangria/suprimento específico), de/para, e o motivo
  // digitado. `movements` passado à parte (em vez de fechar sobre a variável
  // de fora) porque essa função também é chamada de dentro do modal, antes
  // do refresh, com a lista ainda desatualizada em memória.
  function describeAdjustment(m, allMovements) {
    let article, target;
    if (m.targetType === 'abertura') {
      article = 'do';
      target = 'troco inicial';
    } else {
      const original = allMovements.find((x) => x.id === m.targetMovementId);
      article = m.targetType === 'sangria' ? 'da' : 'do';
      target = original
        ? `${original.type === 'sangria' ? 'sangria' : 'suprimento'} de ${formatDateTime(original.timestamp)}`
        : `${m.targetType} (lançamento original não encontrado)`;
    }
    return `Retificação ${article} ${target}: ${formatMoney(m.originalAmount)} → ${formatMoney(m.correctedAmount)}. Motivo: ${m.reason}`;
  }

  function openMovementModal(type) {
    const label = type === 'sangria' ? 'Sangria (retirada)' : 'Suprimento (reforço)';
    // Achado de auditoria (P2): gerada uma vez só, na ABERTURA do modal —
    // não a cada tentativa de envio — pra distinguir "clicou duas vezes no
    // mesmo Confirmar" (mesma dedupeKey, a segunda é rejeitada) de "abriu o
    // modal de novo pra um novo movimento" (dedupeKey nova, legítima). Ver
    // data/cashRepo.js#recordCashMovement.
    const dedupeKey = crypto.randomUUID();
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
            sessionId: session.id, type, amount, reason, userId: ctx.user.id, userName: ctx.user.nome, dedupeKey,
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

  // Retificação: corrige um erro de digitação no troco inicial ou numa
  // sangria/suprimento já lançado, SEM editar/apagar o lançamento original
  // (ver comentário em data/cashRepo.js#recordCashAdjustment) — grava um
  // movimento tipo 'ajuste' por cima, com motivo obrigatório e referenciando
  // exatamente qual lançamento está sendo corrigido. Não retifica outra
  // retificação diretamente (não teria "magnitude" clara pra pedir) — se uma
  // retificação em si saiu errada, o jeito é lançar outra retificação sobre
  // o MESMO troco/sangria/suprimento original, que já soma corretamente em
  // cima da anterior (ver effectiveAmount).
  function openAdjustModal() {
    const correctableMovements = movements.filter((m) => m.type === 'sangria' || m.type === 'suprimento');
    const dedupeKey = crypto.randomUUID();

    function currentValueOf(targetType, targetMovementId) {
      if (targetType === 'abertura') return effectiveAmount('abertura', session.openingAmount, movements);
      const original = correctableMovements.find((m) => m.id === targetMovementId);
      return effectiveAmount(targetType, original.amount, movements, targetMovementId);
    }

    const options = [
      `<option value="abertura">Troco inicial (abertura) — atual ${formatMoney(currentValueOf('abertura'))}</option>`,
      ...correctableMovements.map((m) => `<option value="${m.type}:${m.id}">${m.type === 'sangria' ? 'Sangria' : 'Suprimento'} de ${formatDateTime(m.timestamp)} — atual ${formatMoney(currentValueOf(m.type, m.id))} — ${escapeHtml(m.reason)}</option>`),
    ].join('');

    openModal({
      title: 'Retificar caixa',
      submitLabel: 'Confirmar retificação',
      bodyHtml: `
        <div id="modal-error"></div>
        <p class="text-muted" style="font-size:13px;">
          Corrige um valor lançado errado (troco inicial, sangria ou suprimento) sem mexer nas vendas
          registradas — fica gravado como um ajuste à parte, mantendo o lançamento original intacto.
        </p>
        <div class="field"><label>O que você quer corrigir? *</label><select id="f-target">${options}</select></div>
        <div class="field"><label>Valor atual</label><input id="f-current" disabled></div>
        <div class="field"><label>Valor corrigido *</label><input id="f-corrected" type="number" min="0" step="0.01"></div>
        <div class="field"><label>Motivo da retificação *</label><input id="f-reason" placeholder="Ex: digitei R$ 30 de sangria, mas o valor certo era R$ 50"></div>
      `,
      onMount: (modalEl) => {
        const select = modalEl.querySelector('#f-target');
        const currentField = modalEl.querySelector('#f-current');
        const correctedField = modalEl.querySelector('#f-corrected');
        const sync = () => {
          const [targetType, targetMovementId] = select.value.split(':');
          const current = currentValueOf(targetType, targetMovementId);
          currentField.value = formatMoney(current);
          correctedField.value = current.toFixed(2);
        };
        select.addEventListener('change', sync);
        sync();
      },
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        const [targetType, targetMovementId] = modalEl.querySelector('#f-target').value.split(':');
        const correctedAmount = Number(modalEl.querySelector('#f-corrected').value);
        const reason = modalEl.querySelector('#f-reason').value.trim();
        const originalAmount = currentValueOf(targetType, targetMovementId);
        try {
          const movement = await recordCashAdjustment({
            sessionId: session.id,
            targetType,
            targetMovementId: targetType === 'abertura' ? null : targetMovementId,
            originalAmount, correctedAmount, reason,
            userId: ctx.user.id, userName: ctx.user.nome, dedupeKey,
          });
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Retificação de caixa',
            details: describeAdjustment(movement, [...movements, movement]),
            entity: 'cashSession', entityId: session.id,
          });
          showToast('Retificação registrada.', 'success');
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
                  <td><input type="number" step="0.01" data-count="${escapeHtml(method)}" value="${expected[method].toFixed(2)}" class="table-inline-input" style="width:110px;"></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Observações</label>
          <input id="f-notes" placeholder="Opcional">
        </div>

        <p class="section-title">Confirmação e backup de segurança</p>
        <p class="text-muted" style="font-size:12.5px;margin-top:-8px;">
          Digite usuário e senha de qualquer conta ativa no sistema (não precisa ser administrador) pra confirmar o
          fechamento. Ao aceitar a senha, o sistema já gera e baixa sozinho um backup completo e atualizado de tudo —
          segurança extra de fim de turno, sem precisar lembrar de ir em "Backup" fazer isso à parte.
        </p>
        <div class="form-row">
          <div class="field"><label>Usuário *</label><input id="f-confirm-user"></div>
          <div class="field"><label>Senha *</label><input id="f-confirm-pass" type="password"></div>
        </div>
      `,
      onSubmit: async (modalEl) => {
        const errBox = modalEl.querySelector('#modal-error');
        errBox.innerHTML = '';
        const countedAmounts = {};
        methods.forEach((method) => {
          countedAmounts[method] = Number(modalEl.querySelector(`[data-count="${method}"]`).value) || 0;
        });
        const closingNotes = modalEl.querySelector('#f-notes').value.trim();
        const confirmUsername = modalEl.querySelector('#f-confirm-user').value.trim();
        const confirmPassword = modalEl.querySelector('#f-confirm-pass').value;

        // Não precisa ser o mesmo usuário logado nesta aba, nem admin —
        // qualquer conta ativa serve, é só a confirmação de que alguém
        // autorizado está de fato fechando o caixa agora. confirmUserPassword
        // já trata erro inesperado de verifyLogin (ex: erro no IndexedDB)
        // sem deixar o modal travado sem explicar nada — mesmo padrão usado
        // no modal de aprovação de desconto em views/sale.js.
        const confirmingUser = await confirmUserPassword({
          username: confirmUsername, password: confirmPassword, errBox,
          emptyMessage: 'Informe usuário e senha pra confirmar o fechamento.',
        });
        if (!confirmingUser) return false;

        const ok = await confirmDialog({
          title: 'Confirmar fechamento',
          message: 'Depois de fechado, este caixa não pode ser reaberto — só dá pra abrir um novo. Deseja continuar?',
          confirmLabel: 'Fechar caixa',
        });
        if (!ok) return false;

        // closeSession é o único passo que pode abortar o fechamento
        // inteiro (erro aqui = nada foi gravado, o modal continua aberto
        // pra corrigir e tentar de novo). A PARTIR do sucesso dele, o
        // caixa já está fechado de verdade — log de auditoria e backup
        // automático viram avisos à parte se falharem, nunca fazem a tela
        // dar a entender que "o fechamento não aconteceu" (mesmo
        // raciocínio já usado pro carreto em views/sale.js#commitSale:
        // separar o passo que compromete o estado dos passos que só
        // registram/avisam sobre ele).
        let closed;
        try {
          closed = await closeSession({
            sessionId: session.id, userId: ctx.user.id, userName: ctx.user.nome, countedAmounts, closingNotes,
          });
        } catch (err) {
          errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
          return false;
        }

        // auditWarning/backupWarning viram parte de um showToast() — a
        // mensagem final pode ter trecho vindo de err.message, então o
        // toast nunca usa innerHTML pra montar o texto (ver components/
        // toast.js): cada aviso aqui é uma lista de partes — texto normal e
        // ícone — que o toast monta com createTextNode pro texto (nunca
        // interpretado como HTML) e innerHTML só pro SVG do ícone (esse
        // sim seguro, porque o nome do ícone é sempre fixo, nunca dado
        // externo).
        let auditWarning = [];
        try {
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Fechamento de caixa',
            details: `Caixa fechado. Dinheiro esperado ${formatMoney(closed.expectedAmounts.Dinheiro)}, contado ${formatMoney(closed.countedAmounts.Dinheiro)}, diferença ${formatMoney(closed.difference)}.`
              + (closingNotes ? ` Obs: ${closingNotes}.` : '')
              + ` Confirmado por "${confirmingUser.nome}" (${confirmingUser.username}).`,
            entity: 'cashSession', entityId: closed.id,
          });
        } catch {
          auditWarning = [{ text: ' ' }, { icon: 'warning' }, { text: ' Não foi possível registrar o fechamento no log de auditoria.' }];
        }

        const diffLabel = Math.abs(closed.difference) < 0.01
          ? 'Caixa bateu certinho.'
          : closed.difference > 0
            ? `Sobrou ${formatMoney(closed.difference)} em caixa.`
            : `Faltou ${formatMoney(-closed.difference)} em caixa.`;

        // Backup de segurança automático — a MESMA senha que acabou de
        // confirmar o fechamento também criptografa o arquivo (ver
        // data/backupRepo.js#buildAutomaticCashCloseBackup — usa o mesmo
        // núcleo do export manual, mas sem exigir a permissão 'backup':
        // fechar caixa já é uma ação que qualquer vendedor pode fazer, e
        // este backup é efeito colateral disso, não uma chamada solta),
        // sem pedir uma terceira senha só pra isso.
        let backupWarning = [];
        try {
          const blob = await buildAutomaticCashCloseBackup(confirmPassword);
          downloadBlob(blob, `backup-fechamento-caixa-${timestampForFilename()}.json`);
          await logAction({
            userId: ctx.user.id, userName: ctx.user.nome, role: ctx.user.role,
            action: 'Backup automático (fechamento de caixa)',
            details: `Backup completo gerado e baixado automaticamente ao fechar o caixa, confirmado por "${confirmingUser.nome}" (${confirmingUser.username}).`,
            entity: 'backup', entityId: 'export-fechamento-caixa',
          });
        } catch (err) {
          backupWarning = [{ text: ' ' }, { icon: 'warning' }, { text: ` O backup automático NÃO foi gerado (${err.message}) — gere um manualmente em "Backup", se puder.` }];
        }

        const needsAttention = auditWarning.length > 0 || backupWarning.length > 0 || Math.abs(closed.difference) >= 0.01;
        showToast([{ text: `Caixa fechado. ${diffLabel}` }, ...auditWarning, ...backupWarning], needsAttention ? 'error' : 'success');
        refresh();
        return true;
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
