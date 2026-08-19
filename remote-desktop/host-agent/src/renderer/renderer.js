'use strict';

/**
 * UI + WebRTC do lado HOST. Roda na renderer do Electron (tem as APIs de
 * navegador completas: getUserMedia com captura de tela via
 * chromeMediaSourceId, RTCPeerConnection, WebSocket). Tudo que precisa
 * tocar o SO (injetar input, listar tela) passa por window.hostAPI
 * (exposto via preload/contextBridge — ver preload.js).
 */

const els = {
  idle: document.getElementById('idle-view'),
  code: document.getElementById('code-view'),
  connected: document.getElementById('connected-view'),
  codeDisplay: document.getElementById('code-display'),
  codeStatus: document.getElementById('code-status'),
  startBtn: document.getElementById('start-btn'),
  cancelBtn: document.getElementById('cancel-btn'),
  stopBtn: document.getElementById('stop-btn'),
  errorBox: document.getElementById('error-box'),
};

let ws = null;
let pc = null;
let localStream = null;
let inputChannel = null;
let pendingCandidates = [];

function showView(name) {
  for (const v of [els.idle, els.code, els.connected]) v.classList.add('hidden');
  ({ idle: els.idle, code: els.code, connected: els.connected })[name].classList.remove('hidden');
}

function showError(message) {
  els.errorBox.textContent = message;
  els.errorBox.classList.remove('hidden');
  setTimeout(() => els.errorBox.classList.add('hidden'), 6000);
}

async function startSharing() {
  try {
    const config = await window.hostAPI.getConfig();
    const source = await window.hostAPI.getScreenSource();

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 30,
        },
      },
    });

    ws = new WebSocket(config.signalingUrl);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'host-register' }));
    ws.onerror = () => showError('Não foi possível conectar ao servidor de sinalização.');
    ws.onmessage = (evt) => handleSignalingMessage(JSON.parse(evt.data), config);
    ws.onclose = () => {
      if (!els.connected.classList.contains('hidden') || !els.code.classList.contains('hidden')) {
        resetToIdle('Conexão com o servidor perdida.');
      }
    };

    showView('code');
    els.codeDisplay.textContent = '------';
    els.codeStatus.textContent = 'Gerando código…';
  } catch (err) {
    console.error(err);
    showError('Não foi possível iniciar o compartilhamento de tela.');
  }
}

function handleSignalingMessage(msg, config) {
  switch (msg.type) {
    case 'host-registered':
      els.codeDisplay.textContent = msg.code;
      els.codeStatus.textContent = 'Aguardando conexão… (código expira em 5 min)';
      window.hostAPI.updateStatus({ code: msg.code, connected: false });
      break;

    case 'viewer-joined':
      startPeerConnection(config);
      break;

    case 'signal':
      handleSignal(msg);
      break;

    case 'code-expired':
      resetToIdle('Código expirou sem uso. Gere um novo.');
      break;

    case 'viewer-left':
    case 'peer-left':
      resetToIdle('A pessoa remota encerrou a sessão.');
      break;

    case 'error':
      showError(msg.message || 'Erro de sinalização.');
      break;

    default:
      break;
  }
}

async function startPeerConnection(config) {
  pc = new RTCPeerConnection({ iceServers: config.iceServers });
  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

  inputChannel = pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 });
  inputChannel.onmessage = (evt) => {
    let inputEvent;
    try {
      inputEvent = JSON.parse(evt.data);
    } catch {
      return;
    }
    window.hostAPI.injectInput(inputEvent);
  };
  inputChannel.onopen = () => {
    window.hostAPI.setSharingState(true);
    showView('connected');
  };
  inputChannel.onclose = () => window.hostAPI.setSharingState(false);

  pc.onicecandidate = (evt) => {
    if (evt.candidate) {
      ws.send(JSON.stringify({ type: 'signal', data: { candidate: evt.candidate } }));
    }
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      resetToIdle('Conexão encerrada.');
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'signal', data: { sdp: offer } }));
}

async function handleSignal(msg) {
  const { data } = msg;
  if (!pc) return;
  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    for (const c of pendingCandidates) await pc.addIceCandidate(c);
    pendingCandidates = [];
  } else if (data.candidate) {
    if (pc.remoteDescription) {
      await pc.addIceCandidate(data.candidate);
    } else {
      pendingCandidates.push(data.candidate);
    }
  }
}

function stopSharing(reason) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'leave' }));
  }
  cleanup();
  resetToIdle(reason);
}

function cleanup() {
  if (inputChannel) { inputChannel.close(); inputChannel = null; }
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  if (ws) { ws.close(); ws = null; }
  pendingCandidates = [];
  window.hostAPI.setSharingState(false);
}

function resetToIdle(message) {
  cleanup();
  window.hostAPI.updateStatus({ code: null, connected: false });
  showView('idle');
  if (message) showError(message);
}

els.startBtn.addEventListener('click', startSharing);
els.cancelBtn.addEventListener('click', () => stopSharing());
els.stopBtn.addEventListener('click', () => stopSharing());
