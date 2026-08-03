// Diálogos de confirmar/avisar/pedir texto — substituem confirm()/alert()/
// prompt() nativos do navegador em todo o sistema. Os nativos não seguem o
// tema do SO, têm aparência inconsistente entre navegadores e não
// centralizam de forma confiável dentro da janela do app (em alguns
// navegadores aparecem colados no topo da viewport). Aqui o modal é
// desenhado com a mesma linguagem visual do resto do sistema (mesmo padrão
// de core/services/system-properties.js) e sempre centralizado dentro do
// `container` informado — a janela do app que chamou, ou a tela toda
// (document.body) quando não há uma janela específica envolvida.

function buildDialog({ title, bodyNodes, buttons, container }) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  const box = document.createElement('div');
  box.className = 'dialog-box';
  if (title) {
    const h = document.createElement('h3');
    h.className = 'dialog-title';
    h.textContent = title;
    box.appendChild(h);
  }
  bodyNodes.forEach((node) => box.appendChild(node));
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  buttons.forEach((btn) => actions.appendChild(btn));
  box.appendChild(actions);
  overlay.appendChild(box);
  container.appendChild(overlay);
  return overlay;
}

function makeButton(label, variant) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `dialog-btn dialog-btn-${variant}`;
  btn.textContent = label;
  return btn;
}

/** Enter confirma, Escape cancela — capturado antes de qualquer atalho do
 * app por baixo (ex.: Ctrl+S do Word), pra não disparar os dois ao mesmo
 * tempo enquanto o diálogo está aberto. */
function trapKeys(onEnter, onEscape) {
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onEnter(); }
  }
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}

export function showConfirm(message, { title = 'Confirmar', okLabel = 'OK', cancelLabel = 'Cancelar', danger = false, container = document.body } = {}) {
  return new Promise((resolve) => {
    const msg = document.createElement('p');
    msg.className = 'dialog-message';
    msg.textContent = message;
    const cancelBtn = makeButton(cancelLabel, 'secondary');
    const okBtn = makeButton(okLabel, danger ? 'danger' : 'primary');
    const overlay = buildDialog({ title, bodyNodes: [msg], buttons: [cancelBtn, okBtn], container });
    const untrap = trapKeys(() => close(true), () => close(false));
    function close(result) {
      untrap();
      overlay.remove();
      resolve(result);
    }
    okBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(false); });
    okBtn.focus();
  });
}

export function showAlert(message, { title = 'Aviso', okLabel = 'OK', container = document.body } = {}) {
  return new Promise((resolve) => {
    const msg = document.createElement('p');
    msg.className = 'dialog-message';
    msg.textContent = message;
    const okBtn = makeButton(okLabel, 'primary');
    const overlay = buildDialog({ title, bodyNodes: [msg], buttons: [okBtn], container });
    const untrap = trapKeys(close, close);
    function close() {
      untrap();
      overlay.remove();
      resolve();
    }
    okBtn.addEventListener('click', close);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    okBtn.focus();
  });
}

export function showPrompt(message, defaultValue = '', { title = 'Digite um valor', okLabel = 'OK', cancelLabel = 'Cancelar', container = document.body } = {}) {
  return new Promise((resolve) => {
    const msg = document.createElement('p');
    msg.className = 'dialog-message';
    msg.textContent = message;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dialog-input';
    input.value = defaultValue;
    const cancelBtn = makeButton(cancelLabel, 'secondary');
    const okBtn = makeButton(okLabel, 'primary');
    const overlay = buildDialog({ title, bodyNodes: [msg, input], buttons: [cancelBtn, okBtn], container });
    const untrap = trapKeys(() => close(input.value), () => close(null));
    function close(result) {
      untrap();
      overlay.remove();
      resolve(result);
    }
    okBtn.addEventListener('click', () => close(input.value));
    cancelBtn.addEventListener('click', () => close(null));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}
