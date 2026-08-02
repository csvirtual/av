// Player de Vídeo: toca vídeos abertos direto do computador real (sem
// precisar importar pro sistema de arquivos virtual — arquivos de vídeo
// costumam ser grandes demais pra guardar como base64 no IndexedDB) ou
// vídeos já salvos no sistema de arquivos virtual (ex: importados pelo
// Explorador). Usa o elemento <video> nativo do navegador — só toca de
// verdade os formatos que o motor de mídia do próprio navegador sabe
// decodificar (MP4/H.264, WebM, Ogg na prática). Isso cobre a grande
// maioria dos vídeos reais, mas não é literalmente "qualquer formato"
// como o VLC de verdade (que traz seus próprios decodificadores para
// AVI, WMV, FLV, MKV com codecs antigos etc.) — quando o navegador não
// consegue tocar um arquivo, mostra um aviso real em vez de uma tela
// preta sem explicação.
export const VIDEO_MIME_PREFIX = 'video/';

// Ícone próprio (cone de trânsito), no espírito do símbolo clássico do VLC
// sem usar o logo proprietário do VideoLAN — mesmo cuidado já tomado com o
// ícone do Navegador (inspirado no Edge, mas desenho original).
export const VIDEO_GLYPH = `<svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true">
  <ellipse cx="16" cy="27.5" rx="12" ry="2.4" fill="#3a2410"/>
  <rect x="6" y="24.5" width="20" height="4" rx="1.2" fill="#e8641f"/>
  <rect x="6" y="24.5" width="20" height="4" rx="1.2" fill="none" stroke="#a8430e" stroke-width="0.6"/>
  <path d="M14.6 4.5c.5-1.3 2.3-1.3 2.8 0l7.6 19.5H7Z" fill="#f4802f"/>
  <path d="M12.2 12.5h7.6l1.7 4.4h-11Z" fill="#ffffff"/>
  <path d="M9.4 19.8h13.2l1.4 3.7H8Z" fill="#ffffff"/>
  <path d="M14.6 4.5c.5-1.3 2.3-1.3 2.8 0l1 2.6-4.8 0Z" fill="#fca35c"/>
</svg>`;

const UNSUPPORTED_HINT_EXT = /\.(avi|wmv|flv|rm|rmvb|3gp|mpg|mpeg|vob)$/i;

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`;
}

export function openVideoPlayer(ctx, { fileId = null } = {}) {
  const { fs, windows } = ctx;
  const playlist = []; // { name, url, revoke }
  let currentIndex = -1;
  let isScrubbing = false;

  const root = document.createElement('div');
  root.className = 'video-app';
  root.innerHTML = `
    <div class="video-toolbar">
      <button data-action="open" title="Abrir vídeo do computador">📂 Abrir vídeo</button>
      <span class="video-title" data-role="title">Nenhum vídeo aberto</span>
      <input type="file" data-role="file-input" accept="video/*" multiple class="hidden">
    </div>
    <div class="video-body">
      <div class="video-viewport" data-role="viewport">
        <video data-role="video" playsinline></video>
        <div class="video-empty" data-role="empty">
          <div class="video-empty-glyph">🎬</div>
          <p>Nenhum vídeo aberto. Clique em "Abrir vídeo" pra tocar um arquivo do seu computador.</p>
        </div>
        <div class="video-error hidden" data-role="error">
          <p data-role="error-text"></p>
        </div>
      </div>
      <div class="video-playlist hidden" data-role="playlist"></div>
    </div>
    <div class="video-controls">
      <button data-action="play" title="Reproduzir/Pausar (Espaço)" aria-label="Reproduzir/Pausar">▶</button>
      <button data-action="back" title="Voltar 10s (←)" aria-label="Voltar 10 segundos">⏪</button>
      <button data-action="forward" title="Avançar 10s (→)" aria-label="Avançar 10 segundos">⏩</button>
      <span class="video-time" data-role="current-time">0:00</span>
      <input type="range" class="video-seek" data-role="seek" min="0" max="1000" value="0" aria-label="Progresso do vídeo">
      <span class="video-time" data-role="duration">0:00</span>
      <button data-action="mute" title="Mudo (M)" aria-label="Mudo">🔊</button>
      <input type="range" class="video-volume" data-role="volume" min="0" max="100" value="100" aria-label="Volume">
      <select data-role="speed" title="Velocidade de reprodução" aria-label="Velocidade de reprodução">
        <option value="0.5">0.5x</option>
        <option value="1" selected>1x</option>
        <option value="1.25">1.25x</option>
        <option value="1.5">1.5x</option>
        <option value="2">2x</option>
      </select>
      <button data-action="pip" title="Picture-in-Picture" aria-label="Picture-in-Picture">🗗</button>
      <button data-action="fullscreen" title="Tela cheia (F)" aria-label="Tela cheia">⛶</button>
    </div>
  `;

  const win = windows.createWindow({
    appId: 'video-player',
    title: 'Player de Vídeo',
    icon: VIDEO_GLYPH,
    width: 820,
    height: 560,
    content: root,
  });

  const video = root.querySelector('[data-role="video"]');
  const viewport = root.querySelector('[data-role="viewport"]');
  const titleEl = root.querySelector('[data-role="title"]');
  const emptyEl = root.querySelector('[data-role="empty"]');
  const errorEl = root.querySelector('[data-role="error"]');
  const errorTextEl = root.querySelector('[data-role="error-text"]');
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
      row.className = 'video-playlist-item' + (i === currentIndex ? ' active' : '');
      row.textContent = item.name;
      row.addEventListener('click', () => playIndex(i));
      playlistEl.appendChild(row);
    });
  }

  function showState(state) {
    emptyEl.classList.toggle('hidden', state !== 'empty');
    errorEl.classList.toggle('hidden', state !== 'error');
    video.classList.toggle('hidden', state !== 'playing');
  }

  function playIndex(i) {
    const item = playlist[i];
    if (!item) return;
    currentIndex = i;
    titleEl.textContent = item.name;
    win.setTitle(`${item.name} - Player de Vídeo`);
    video.src = item.url;
    video.load();
    video.play().catch(() => {});
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

  video.addEventListener('loadedmetadata', () => {
    showState('playing');
    durationEl.textContent = formatTime(video.duration);
  });
  video.addEventListener('error', () => {
    showState('error');
    const name = playlist[currentIndex]?.name || '';
    const likelyExotic = UNSUPPORTED_HINT_EXT.test(name);
    errorTextEl.textContent = likelyExotic
      ? `Este navegador não consegue tocar "${name}" — formatos como .avi/.wmv/.flv/.mkv com codecs antigos não são suportados nativamente. Abra este arquivo num player como o VLC de verdade no seu computador.`
      : `Este navegador não consegue tocar "${name}" (formato ou codec não suportado). Tente converter para .mp4 ou abra num player externo.`;
  });
  video.addEventListener('play', () => { playBtn.textContent = '⏸'; });
  video.addEventListener('pause', () => { playBtn.textContent = '▶'; });
  video.addEventListener('ended', () => {
    if (currentIndex + 1 < playlist.length) playIndex(currentIndex + 1);
  });
  video.addEventListener('timeupdate', () => {
    if (isScrubbing || !video.duration) return;
    seekEl.value = String((video.currentTime / video.duration) * 1000);
    currentTimeEl.textContent = formatTime(video.currentTime);
  });

  playBtn.addEventListener('click', () => { video.paused ? video.play().catch(() => {}) : video.pause(); });
  root.querySelector('[data-action="back"]').addEventListener('click', () => { video.currentTime = Math.max(0, video.currentTime - 10); });
  root.querySelector('[data-action="forward"]').addEventListener('click', () => { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10); });

  seekEl.addEventListener('input', () => {
    isScrubbing = true;
    if (video.duration) currentTimeEl.textContent = formatTime((seekEl.value / 1000) * video.duration);
  });
  seekEl.addEventListener('change', () => {
    if (video.duration) video.currentTime = (seekEl.value / 1000) * video.duration;
    isScrubbing = false;
  });

  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    muteBtn.textContent = video.muted ? '🔇' : '🔊';
  });
  volumeEl.addEventListener('input', () => {
    video.volume = volumeEl.value / 100;
    if (video.volume === 0) { video.muted = true; muteBtn.textContent = '🔇'; }
    else if (video.muted) { video.muted = false; muteBtn.textContent = '🔊'; }
  });
  speedEl.addEventListener('change', () => { video.playbackRate = parseFloat(speedEl.value); });

  root.querySelector('[data-action="pip"]').addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
    } catch { /* PiP indisponível pra este vídeo/navegador */ }
  });
  root.querySelector('[data-action="fullscreen"]').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else viewport.requestFullscreen().catch(() => {});
  });

  function onKeydown(e) {
    if (!win.el.classList.contains('focused')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
    else if (e.key === 'ArrowLeft') { video.currentTime = Math.max(0, video.currentTime - 5); }
    else if (e.key === 'ArrowRight') { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); volumeEl.value = Math.min(100, Number(volumeEl.value) + 5); volumeEl.dispatchEvent(new Event('input')); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); volumeEl.value = Math.max(0, Number(volumeEl.value) - 5); volumeEl.dispatchEvent(new Event('input')); }
    else if (e.key.toLowerCase() === 'f') { root.querySelector('[data-action="fullscreen"]').click(); }
    else if (e.key.toLowerCase() === 'm') { muteBtn.click(); }
  }
  window.addEventListener('keydown', onKeydown);
  win.onClose(() => {
    window.removeEventListener('keydown', onKeydown);
    video.pause();
    video.src = '';
    playlist.forEach((item) => item.revoke?.());
  });

  showState('empty');
  if (fileId) loadFromFs(fileId);

  return win;
}
