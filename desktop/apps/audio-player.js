// Player de Áudio: toca arquivos de áudio abertos direto do computador real
// ou já salvos no sistema de arquivos virtual. Usa o elemento <audio> nativo
// do navegador, que cobre bem os formatos de áudio mais conhecidos de
// verdade — MP3, WAV, OGG/Vorbis, AAC/M4A e FLAC tocam nativamente em
// qualquer navegador atual, sem precisar de nenhuma conversão.
export const AUDIO_MIME_PREFIX = 'audio/';
export const AUDIO_GLYPH = '🎧';

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function openAudioPlayer(ctx, { fileId = null } = {}) {
  const { fs, windows } = ctx;
  const playlist = []; // { name, url, revoke }
  let currentIndex = -1;
  let isScrubbing = false;

  const root = document.createElement('div');
  root.className = 'audio-app';
  root.innerHTML = `
    <div class="audio-toolbar">
      <button data-action="open" title="Abrir áudio do computador">📂 Abrir áudio</button>
      <input type="file" data-role="file-input" accept="audio/*" multiple class="hidden">
    </div>
    <div class="audio-body">
      <div class="audio-nowplaying" data-role="viewport">
        <div class="audio-art">🎧</div>
        <div class="audio-track-name" data-role="track-name">Nenhum áudio aberto</div>
        <div class="audio-error hidden" data-role="error"></div>
        <audio data-role="audio"></audio>
      </div>
      <div class="audio-playlist hidden" data-role="playlist"></div>
    </div>
    <div class="audio-controls">
      <button data-action="prev" title="Faixa anterior" aria-label="Faixa anterior">⏮</button>
      <button data-action="play" title="Reproduzir/Pausar (Espaço)" aria-label="Reproduzir/Pausar">▶</button>
      <button data-action="next" title="Próxima faixa" aria-label="Próxima faixa">⏭</button>
      <span class="audio-time" data-role="current-time">0:00</span>
      <input type="range" class="audio-seek" data-role="seek" min="0" max="1000" value="0" aria-label="Progresso do áudio">
      <span class="audio-time" data-role="duration">0:00</span>
      <button data-action="mute" title="Mudo (M)" aria-label="Mudo">🔊</button>
      <input type="range" class="audio-volume" data-role="volume" min="0" max="100" value="100" aria-label="Volume">
      <select data-role="speed" title="Velocidade de reprodução" aria-label="Velocidade de reprodução">
        <option value="0.5">0.5x</option>
        <option value="1" selected>1x</option>
        <option value="1.25">1.25x</option>
        <option value="1.5">1.5x</option>
        <option value="2">2x</option>
      </select>
    </div>
  `;

  const win = windows.createWindow({
    appId: 'audio-player',
    title: 'Player de Áudio',
    icon: AUDIO_GLYPH,
    width: 480,
    height: 420,
    content: root,
  });

  const audio = root.querySelector('[data-role="audio"]');
  const trackNameEl = root.querySelector('[data-role="track-name"]');
  const errorEl = root.querySelector('[data-role="error"]');
  const playlistEl = root.querySelector('[data-role="playlist"]');
  const fileInput = root.querySelector('[data-role="file-input"]');
  const playBtn = root.querySelector('[data-action="play"]');
  const seekEl = root.querySelector('[data-role="seek"]');
  const currentTimeEl = root.querySelector('[data-role="current-time"]');
  const durationEl = root.querySelector('[data-role="duration"]');
  const muteBtn = root.querySelector('[data-action="mute"]');
  const volumeEl = root.querySelector('[data-role="volume"]');
  const speedEl = root.querySelector('[data-role="speed"]');

  function renderPlaylist() {
    playlistEl.classList.toggle('hidden', playlist.length < 2);
    playlistEl.innerHTML = '';
    playlist.forEach((item, i) => {
      const row = document.createElement('button');
      row.className = 'audio-playlist-item' + (i === currentIndex ? ' active' : '');
      row.textContent = item.name;
      row.addEventListener('click', () => playIndex(i));
      playlistEl.appendChild(row);
    });
  }

  function playIndex(i) {
    const item = playlist[i];
    if (!item) return;
    currentIndex = i;
    trackNameEl.textContent = item.name;
    win.setTitle(`${item.name} - Player de Áudio`);
    errorEl.classList.add('hidden');
    audio.src = item.url;
    audio.load();
    audio.play().catch(() => {});
    renderPlaylist();
  }

  function addFiles(files) {
    Array.from(files).forEach((file) => {
      const url = URL.createObjectURL(file);
      playlist.push({ name: file.name, url, revoke: () => URL.revokeObjectURL(url) });
    });
    if (files.length) playIndex(playlist.length - files.length);
  }

  async function loadFromFs(id) {
    const node = await fs.getNode(id);
    if (!node || !node.content) return;
    playlist.push({ name: node.name, url: node.content, revoke: null });
    playIndex(playlist.length - 1);
  }

  root.querySelector('[data-action="open"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

  audio.addEventListener('loadedmetadata', () => { durationEl.textContent = formatTime(audio.duration); });
  audio.addEventListener('error', () => {
    const name = playlist[currentIndex]?.name || '';
    errorEl.textContent = `Este navegador não consegue tocar "${name}" (formato ou codec não suportado).`;
    errorEl.classList.remove('hidden');
  });
  audio.addEventListener('play', () => { playBtn.textContent = '⏸'; });
  audio.addEventListener('pause', () => { playBtn.textContent = '▶'; });
  audio.addEventListener('ended', () => {
    if (currentIndex + 1 < playlist.length) playIndex(currentIndex + 1);
  });
  audio.addEventListener('timeupdate', () => {
    if (isScrubbing || !audio.duration) return;
    seekEl.value = String((audio.currentTime / audio.duration) * 1000);
    currentTimeEl.textContent = formatTime(audio.currentTime);
  });

  playBtn.addEventListener('click', () => { audio.paused ? audio.play().catch(() => {}) : audio.pause(); });
  root.querySelector('[data-action="prev"]').addEventListener('click', () => { if (currentIndex > 0) playIndex(currentIndex - 1); });
  root.querySelector('[data-action="next"]').addEventListener('click', () => { if (currentIndex + 1 < playlist.length) playIndex(currentIndex + 1); });

  seekEl.addEventListener('input', () => {
    isScrubbing = true;
    if (audio.duration) currentTimeEl.textContent = formatTime((seekEl.value / 1000) * audio.duration);
  });
  seekEl.addEventListener('change', () => {
    if (audio.duration) audio.currentTime = (seekEl.value / 1000) * audio.duration;
    isScrubbing = false;
  });

  muteBtn.addEventListener('click', () => {
    audio.muted = !audio.muted;
    muteBtn.textContent = audio.muted ? '🔇' : '🔊';
  });
  volumeEl.addEventListener('input', () => {
    audio.volume = volumeEl.value / 100;
    if (audio.volume === 0) { audio.muted = true; muteBtn.textContent = '🔇'; }
    else if (audio.muted) { audio.muted = false; muteBtn.textContent = '🔊'; }
  });
  speedEl.addEventListener('change', () => { audio.playbackRate = parseFloat(speedEl.value); });

  function onKeydown(e) {
    if (!win.el.classList.contains('focused')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
    else if (e.key === 'ArrowLeft') { audio.currentTime = Math.max(0, audio.currentTime - 5); }
    else if (e.key === 'ArrowRight') { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 5); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); volumeEl.value = Math.min(100, Number(volumeEl.value) + 5); volumeEl.dispatchEvent(new Event('input')); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); volumeEl.value = Math.max(0, Number(volumeEl.value) - 5); volumeEl.dispatchEvent(new Event('input')); }
    else if (e.key.toLowerCase() === 'm') { muteBtn.click(); }
  }
  window.addEventListener('keydown', onKeydown);
  win.onClose(() => {
    window.removeEventListener('keydown', onKeydown);
    audio.pause();
    audio.src = '';
    playlist.forEach((item) => item.revoke?.());
  });

  if (fileId) loadFromFs(fileId);

  return win;
}
