'use strict';

/**
 * Viewer 100% web: nenhuma instalação necessária, roda em qualquer
 * navegador com suporte a WebRTC (Chrome, Edge, Firefox...). Conecta ao
 * servidor de sinalização, troca SDP/ICE com o host e então recebe o vídeo
 * da tela remota + envia mouse/teclado por um DataChannel.
 */

const DEFAULT_SIGNALING_URL = window.CSRD_SIGNALING_URL || 'ws://localhost:8080';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

const els = {
  joinScreen: document.getElementById('join-screen'),
  callScreen: document.getElementById('call-screen'),
  joinForm: document.getElementById('join-form'),
  codeInput: document.getElementById('code-input'),
  joinBtn: document.getElementById('join-btn'),
  joinError: document.getElementById('join-error'),
  signalingInput: document.getElementById('signaling-input'),
  callStatus: document.getElementById('call-status'),
  disconnectBtn: document.getElementById('disconnect-btn'),
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  video: document.getElementById('remote-video'),
};

els.signalingInput.value = DEFAULT_SIGNALING_URL;
els.codeInput.addEventListener('input', () => {
  els.codeInput.value = els.codeInput.value.replace(/\D/g, '').slice(0, 6);
});

let ws = null;
let pc = null;
let inputChannel = null;
let pendingCandidates = [];

function setError(msg) {
  els.joinError.textContent = msg;
  els.joinError.classList.toggle('hidden', !msg);
}

function setStatus(msg) {
  els.callStatus.textContent = msg;
}

els.joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = els.codeInput.value.trim();
  if (code.length !== 6) return setError('Digite os 6 dígitos do código.');
  connect(code, els.signalingInput.value.trim() || DEFAULT_SIGNALING_URL);
});

function connect(code, signalingUrl) {
  setError('');
  els.joinBtn.disabled = true;
  ws = new WebSocket(signalingUrl);

  ws.onopen = () => ws.send(JSON.stringify({ type: 'viewer-join', code }));

  ws.onerror = () => {
    setError('Não foi possível conectar ao servidor de sinalização.');
    els.joinBtn.disabled = false;
  };

  ws.onmessage = (evt) => handleSignalingMessage(JSON.parse(evt.data));

  ws.onclose = () => {
    if (!els.callScreen.classList.contains('hidden')) {
      endCall('Conexão encerrada.');
    }
    els.joinBtn.disabled = false;
  };
}

function handleSignalingMessage(msg) {
  switch (msg.type) {
    case 'joined':
      showCallScreen();
      setStatus('Conectado à sinalização, aguardando vídeo…');
      break;

    case 'signal':
      handleSignal(msg);
      break;

    case 'host-left':
    case 'peer-left':
      endCall('O host encerrou o compartilhamento.');
      break;

    case 'error':
      setError(translateError(msg));
      els.joinBtn.disabled = false;
      if (ws) ws.close();
      break;

    default:
      break;
  }
}

function translateError(msg) {
  const map = {
    'invalid-code': 'Código inválido ou expirado.',
    'room-full': 'Essa sessão já está em uso.',
    'rate-limited': 'Muitas tentativas. Aguarde um minuto e tente de novo.',
  };
  return map[msg.code] || msg.message || 'Erro ao conectar.';
}

async function handleSignal(msg) {
  const { data } = msg;

  if (data.sdp) {
    if (!pc) createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    for (const c of pendingCandidates) await pc.addIceCandidate(c);
    pendingCandidates = [];

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'signal', data: { sdp: answer } }));
  } else if (data.candidate) {
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(data.candidate);
    } else {
      pendingCandidates.push(data.candidate);
    }
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.ontrack = (evt) => {
    els.video.srcObject = evt.streams[0];
    setStatus('Ao vivo');
  };

  pc.ondatachannel = (evt) => {
    if (evt.channel.label !== 'input') return;
    inputChannel = evt.channel;
    inputChannel.onopen = () => attachInputHandlers();
    inputChannel.onclose = () => detachInputHandlers();
  };

  pc.onicecandidate = (evt) => {
    if (evt.candidate) {
      ws.send(JSON.stringify({ type: 'signal', data: { candidate: evt.candidate } }));
    }
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected'].includes(pc.connectionState)) {
      endCall('Conexão perdida.');
    }
  };
}

function showCallScreen() {
  els.joinScreen.classList.add('hidden');
  els.callScreen.classList.remove('hidden');
}

function endCall(reason) {
  detachInputHandlers();
  if (inputChannel) { inputChannel.close(); inputChannel = null; }
  if (pc) { pc.close(); pc = null; }
  if (ws) { ws.close(); ws = null; }
  els.video.srcObject = null;
  els.callScreen.classList.add('hidden');
  els.joinScreen.classList.remove('hidden');
  els.joinBtn.disabled = false;
  pendingCandidates = [];
  if (reason) setError(reason);
}

els.disconnectBtn.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'leave' }));
  endCall(null);
});

els.fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else els.callScreen.requestFullscreen();
});

// --- Captura de input do viewer, mapeada em coordenadas normalizadas ---
// (leva em conta letterboxing do <video> com object-fit: contain, pra
// clicar exatamente onde a pessoa vê na tela, não na área toda do elemento)

function sendInput(event) {
  if (inputChannel && inputChannel.readyState === 'open') {
    inputChannel.send(JSON.stringify(event));
  }
}

function videoToNormalized(clientX, clientY) {
  const rect = els.video.getBoundingClientRect();
  const vw = els.video.videoWidth;
  const vh = els.video.videoHeight;
  if (!vw || !vh) return null;

  const scale = Math.min(rect.width / vw, rect.height / vh);
  const contentW = vw * scale;
  const contentH = vh * scale;
  const offsetX = (rect.width - contentW) / 2;
  const offsetY = (rect.height - contentH) / 2;

  const x = (clientX - rect.left - offsetX) / contentW;
  const y = (clientY - rect.top - offsetY) / contentH;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

let onMouseMove, onMouseDown, onMouseUp, onWheel, onContextMenu, onKeyDown, onKeyUp;

function attachInputHandlers() {
  onMouseMove = (e) => {
    const p = videoToNormalized(e.clientX, e.clientY);
    if (p) sendInput({ type: 'mousemove', x: p.x, y: p.y });
  };
  onMouseDown = (e) => {
    const p = videoToNormalized(e.clientX, e.clientY);
    if (p) sendInput({ type: 'mousedown', button: e.button, x: p.x, y: p.y });
  };
  onMouseUp = (e) => {
    const p = videoToNormalized(e.clientX, e.clientY);
    if (p) sendInput({ type: 'mouseup', button: e.button, x: p.x, y: p.y });
  };
  onWheel = (e) => {
    e.preventDefault();
    sendInput({ type: 'wheel', deltaX: e.deltaX, deltaY: e.deltaY });
  };
  onContextMenu = (e) => e.preventDefault();
  onKeyDown = (e) => {
    e.preventDefault();
    sendInput({ type: 'keydown', code: e.code, key: e.key });
  };
  onKeyUp = (e) => {
    e.preventDefault();
    sendInput({ type: 'keyup', code: e.code, key: e.key });
  };

  els.video.addEventListener('mousemove', onMouseMove);
  els.video.addEventListener('mousedown', onMouseDown);
  els.video.addEventListener('mouseup', onMouseUp);
  els.video.addEventListener('wheel', onWheel, { passive: false });
  els.video.addEventListener('contextmenu', onContextMenu);
  els.video.tabIndex = 0;
  els.video.focus();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
}

function detachInputHandlers() {
  if (!onMouseMove) return;
  els.video.removeEventListener('mousemove', onMouseMove);
  els.video.removeEventListener('mousedown', onMouseDown);
  els.video.removeEventListener('mouseup', onMouseUp);
  els.video.removeEventListener('wheel', onWheel);
  els.video.removeEventListener('contextmenu', onContextMenu);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  onMouseMove = onMouseDown = onMouseUp = onWheel = onContextMenu = onKeyDown = onKeyUp = undefined;
}
