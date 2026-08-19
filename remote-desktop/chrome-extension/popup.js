'use strict';

const HOST_NAME = 'com.csvirtual.remotedesktop.host';

const els = {
  dot: document.getElementById('status-dot'),
  text: document.getElementById('status-text'),
  code: document.getElementById('code'),
  startBtn: document.getElementById('start-btn'),
  stopBtn: document.getElementById('stop-btn'),
  notInstalled: document.getElementById('not-installed'),
};

function sendNative(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: 'sem resposta' });
    });
  });
}

function render(status) {
  const running = !!status?.running;
  els.dot.classList.toggle('on', running);
  els.startBtn.classList.toggle('hidden', running);
  els.stopBtn.classList.toggle('hidden', !running);

  if (!running) {
    els.text.textContent = 'Host parado';
    els.code.classList.add('hidden');
    return;
  }
  els.text.textContent = status.connected ? 'Sessão ativa' : 'Host rodando';
  if (status.code) {
    els.code.textContent = status.code;
    els.code.classList.remove('hidden');
  } else {
    els.code.classList.add('hidden');
  }
}

async function refresh() {
  const res = await sendNative({ cmd: 'status' });
  if (!res.ok) {
    els.notInstalled.classList.remove('hidden');
    els.text.textContent = 'Host nativo indisponível';
    els.startBtn.classList.add('hidden');
    els.stopBtn.classList.add('hidden');
    return;
  }
  els.notInstalled.classList.add('hidden');
  render(res.status);
}

els.startBtn.addEventListener('click', async () => {
  els.startBtn.disabled = true;
  await sendNative({ cmd: 'start' });
  setTimeout(async () => {
    els.startBtn.disabled = false;
    await refresh();
  }, 800);
});

els.stopBtn.addEventListener('click', async () => {
  els.stopBtn.disabled = true;
  await sendNative({ cmd: 'stop' });
  els.stopBtn.disabled = false;
  await refresh();
});

refresh();
const poll = setInterval(refresh, 3000);
window.addEventListener('unload', () => clearInterval(poll));
