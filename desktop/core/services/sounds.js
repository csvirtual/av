// Sons de sistema sintetizados (Web Audio API) — melodias originais, não são
// os sons reais do Windows (protegidos por direitos autorais). Respeitam o
// volume/mudo configurados nas Configurações. Navegadores só tocam áudio após
// alguma interação do usuário na página; se ainda não houve nenhuma, o som
// pode simplesmente não tocar — isso é uma política do próprio navegador.
import { kv } from '../state/kv-store.js';

let audioCtx = null;
function getCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

['pointerdown', 'keydown'].forEach((evt) => {
  window.addEventListener(evt, () => { try { getCtx(); } catch {} }, { once: true, passive: true });
});

export async function getVolume() {
  const muted = await kv.get('settings.muted', false);
  if (muted) return 0;
  const vol = await kv.get('settings.volume', 70);
  return Math.max(0, Math.min(100, vol)) / 100;
}

export const volumeControl = {
  get: () => kv.get('settings.volume', 70),
  set: (v) => kv.set('settings.volume', Math.max(0, Math.min(100, v))),
  getMuted: () => kv.get('settings.muted', false),
  setMuted: (m) => kv.set('settings.muted', m),
};

function playNote(ctx, startTime, freq, duration, peakGain) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

async function playSequence(notes) {
  const vol = await getVolume();
  if (vol <= 0) return;
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime + 0.02;
    notes.forEach(([freq, offset, duration]) => playNote(ctx, now + offset, freq, duration, vol * 0.22));
  } catch {}
}

export function playStartupChime() {
  return playSequence([
    [523.25, 0, 0.55],
    [659.25, 0.16, 0.55],
    [783.99, 0.32, 0.8],
  ]);
}

export function playShutdownChime() {
  return playSequence([
    [783.99, 0, 0.4],
    [659.25, 0.16, 0.4],
    [392.0, 0.32, 0.7],
  ]);
}

export function playLockChime() {
  return playSequence([[880, 0, 0.18]]);
}

export function playErrorChime() {
  return playSequence([[220, 0, 0.22], [196, 0.1, 0.28]]);
}

export function playNotifyChime() {
  return playSequence([[660, 0, 0.14], [880, 0.1, 0.18]]);
}
