import { kv, setActiveAccount, getActiveAccount, hasLegacyAccountData, migrateLegacyDataToAccount } from './core/state/kv-store.js';
import { fs, ensureSeed } from './core/state/filesystem.js';
import {
  setPassword, verifyPassword, changePasswordKnowingOld, getEmail, setEmail, resetPasswordWithEmail,
  adminResetPassword,
} from './core/services/auth.js';
import { clearSessionDek } from './core/services/crypto.js';
import {
  listAccounts, addAccountRecord, updateAccountRecord, removeAccountRecord,
  setLastActiveAccountId, newAccountId, MAX_ACCOUNTS, recordLogon, recordLogoff,
} from './core/services/accounts.js';
import * as WM from './core/window-manager/window-manager.js';
import { playStartupChime, playShutdownChime, playLockChime, playNotifyChime, volumeControl } from './core/services/sounds.js';
import * as motion from './core/motion/motion.js';
import { init as initTaskSwitcher } from './core/window-manager/task-switcher.js';
import { openExplorer } from './apps/explorer.js';
import { openNotepad } from './apps/notepad.js';
import { openPhotos } from './apps/photos.js';
import { openWord, WORD_MIME } from './apps/word.js';
import { openSheet, SHEET_MIME } from './apps/sheet.js';
import { openVideoPlayer, VIDEO_GLYPH, VIDEO_MIME_PREFIX } from './apps/video-player.js';
import { openAudioPlayer, AUDIO_GLYPH, AUDIO_MIME_PREFIX } from './apps/audio-player.js';
import { openPresentation, PRESENTATION_MIME } from './apps/presentation.js';
import { openSettings, WALLPAPERS } from './apps/settings.js';
import { openBrowser, BROWSER_GLYPH } from './apps/browser.js';
import { openCalculator } from './apps/calculator.js';
import { openClock } from './apps/clock.js';
import { openTerminal } from './apps/terminal.js';
import { openTaskManager } from './apps/task-manager.js';
import { trashGlyph, USERS_GLYPH, PC_GLYPH, PHOTO_GLYPH } from './core/icons.js';
import { showSystemProperties } from './core/services/system-properties.js';
import { listRealEntryNames, isValidBackup, restoreBackup } from './core/services/backup.js';

const $ = (sel) => document.querySelector(sel);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

// Bloqueio geral do menu de contexto nativo do navegador: em nenhum lugar da
// página o clique direito deve abrir o menu de verdade do Chrome/Edge/etc.
// (Voltar, Recarregar, Inspecionar...) — só os menus próprios do "sistema
// operacional" simulado (ícones, arquivos, área de trabalho etc.), cada um já
// com seu próprio preventDefault(). Onde não existe menu próprio nenhum
// (telas de login, espaços vazios sem handler específico), o clique direito
// agora não mostra nada, em vez de cair pro menu nativo do navegador.
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Painéis flutuantes (menus, popups) animam com o motion compartilhado.
function showPanel(el) {
  show(el);
  motion.panelOpen(el);
}
function hidePanel(el) {
  if (el.classList.contains('hidden')) return;
  motion.panelClose(el).then(() => hide(el));
}

let seed = null;
let bootTime = Date.now();

// Apps que sabem abrir um arquivo (aparecem no menu "Abrir com" do
// Explorador e dos ícones da área de trabalho) — de propósito não inclui
// Calculadora nem Terminal, que não abrem arquivo nenhum.
const OPEN_WITH_APPS = [
  { id: 'notepad', label: 'Bloco de Notas', glyph: '📝', open: (node) => openNotepad(ctx, { fileId: node.id }) },
  { id: 'word', label: 'Documento', glyph: '📘', open: (node) => openWord(ctx, { fileId: node.id }) },
  { id: 'sheet', label: 'Planilha', glyph: '📗', open: (node) => openSheet(ctx, { fileId: node.id }) },
  { id: 'photos', label: 'Fotos', glyph: PHOTO_GLYPH, open: (node) => openPhotos(ctx, { fileId: node.id }) },
  { id: 'video-player', label: 'Player de Vídeo', glyph: '🎬', open: (node) => openVideoPlayer(ctx, { fileId: node.id }) },
  { id: 'audio-player', label: 'Player de Áudio', glyph: AUDIO_GLYPH, open: (node) => openAudioPlayer(ctx, { fileId: node.id }) },
  { id: 'presentation', label: 'Apresentação', glyph: '📙', open: (node) => openPresentation(ctx, { fileId: node.id }) },
];

const ctx = {
  fs,
  kv,
  windows: WM,
  get seed() { return seed; },
  openFile,
  get openWithApps() { return OPEN_WITH_APPS.filter((app) => !isAppDisabled(app.id)); },
  getAppCatalog: () => PINNED_APPS,
  isAppDisabled,
  setAppDisabled,
  refreshDesktop: () => refreshTrashState(),
  getTheme,
  setTheme,
  getWallpaper,
  setWallpaper,
  verifyPassword,
  // Preserva a mesma chave de criptografia dos arquivos (só re-embrulha com
  // a senha nova) — ao contrário de simplesmente chamar setPassword() de
  // novo, que geraria uma chave nova e tornaria ilegível tudo que já foi
  // salvo cifrado.
  changePassword: (oldP, newP) => changePasswordKnowingOld(oldP, newP),
  getAvatar: () => kv.get('user.avatar', null),
  setAvatar: async (dataUrl) => {
    await kv.set('user.avatar', dataUrl);
    await refreshAvatars();
    await updateAccountRecord(getActiveAccount(), { avatar: dataUrl });
  },
  getAccentColor,
  setAccentColor,
  getScale,
  setScale,
  getReduceMotion,
  setReduceMotion,
  getTimeFormat: () => timeFormat,
  setTimeFormat,
  getOrientation: () => kv.get('settings.orientation', 'landscape'),
  setOrientation: async (value) => {
    await kv.set('settings.orientation', value);
    if (value !== 'auto' && screen.orientation?.lock) {
      screen.orientation.lock(value).catch(() => {});
    } else if (screen.orientation?.unlock) {
      try { screen.orientation.unlock(); } catch {}
    }
  },
  getBootTime: () => bootTime,
  getAutoArrange,
  setAutoArrange,
  notify: (n) => pushNotification(n),
  getActiveAccountId: () => getActiveAccount(),
  listAccounts,
  getActiveAccountRole,
  maxAccounts: MAX_ACCOUNTS,
  addAccount: async () => {
    const accounts = await listAccounts();
    if (accounts.length >= MAX_ACCOUNTS) {
      alert(`Este dispositivo já tem o máximo de ${MAX_ACCOUNTS} contas.`);
      return;
    }
    if ((await getActiveAccountRole()) !== 'admin') {
      alert('Apenas um administrador pode adicionar contas.');
      return;
    }
    WM.closeAllWindows();
    WM.resetDesktops();
    hide($('#desktop'));
    startOobe();
  },
  switchToAccount: (id) => switchToSpecificAccount(id),
  removeAccount: (id) => removeAccountFlow(id),
  setAccountRole: (id, role) => setAccountRoleFlow(id, role),
  netUserSetPassword: (name, newPassword) => netUserSetPassword(name, newPassword),
  startWipeFlow: () => startWipeFlow(),
};

async function getActiveAccountRole() {
  const accounts = await listAccounts();
  return accounts.find((a) => a.id === getActiveAccount())?.role || 'standard';
}

function avatarHTML(name, avatarDataUrl) {
  if (avatarDataUrl) return `<img class="avatar-img" src="${escapeHtml(avatarDataUrl)}" alt="">`;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<div class="avatar-initial">${escapeHtml(initial)}</div>`;
}

async function refreshAvatars() {
  const name = await kv.get('user.name', 'Usuário');
  const avatar = await kv.get('user.avatar', null);
  const html = avatarHTML(name, avatar);
  document.querySelectorAll('#lock-avatar, #start-avatar').forEach((el) => (el.innerHTML = html));
}

function fileGlyph(node) {
  if (node.type === 'folder') {
    if (node.id === seed?.usersId) return USERS_GLYPH;
    if (node.id === seed?.trashId) return trashGlyph();
    if (node.id === seed?.desktopId) return PC_GLYPH;
    if (node.id === seed?.documentsId) return '📄';
    if (node.id === seed?.picturesId) return PHOTO_GLYPH;
    if (node.id === seed?.downloadsId) return '⬇️';
    return '📁';
  }
  const mime = node.mimeType || '';
  if (mime.startsWith('image/')) return PHOTO_GLYPH;
  if (mime === WORD_MIME) return '📘';
  if (mime === SHEET_MIME) return '📗';
  if (mime.startsWith(VIDEO_MIME_PREFIX)) return '🎬';
  if (mime.startsWith(AUDIO_MIME_PREFIX)) return AUDIO_GLYPH;
  if (mime === PRESENTATION_MIME) return '📙';
  return '📄';
}

function openFile(node) {
  if (!node) return;
  if (node.type === 'folder') openExplorer(ctx, { startFolderId: node.id });
  else if ((node.mimeType || '').startsWith('image/')) openPhotos(ctx, { fileId: node.id });
  else if (node.mimeType === WORD_MIME || /\.docx$/i.test(node.name)) openWord(ctx, { fileId: node.id });
  else if (node.mimeType === SHEET_MIME || /\.xlsx$/i.test(node.name)) openSheet(ctx, { fileId: node.id });
  else if ((node.mimeType || '').startsWith(VIDEO_MIME_PREFIX)) openVideoPlayer(ctx, { fileId: node.id });
  else if ((node.mimeType || '').startsWith(AUDIO_MIME_PREFIX)) openAudioPlayer(ctx, { fileId: node.id });
  else if (node.mimeType === PRESENTATION_MIME || /\.pptx$/i.test(node.name)) openPresentation(ctx, { fileId: node.id });
  else openNotepad(ctx, { fileId: node.id });
}

async function getTheme() {
  return kv.get('settings.theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
async function setTheme(theme) {
  await kv.set('settings.theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
}
async function getWallpaper() {
  return kv.get('settings.wallpaper', 'linear-gradient(135deg, #0f3057 0%, #1a5088 45%, #2c7fb8 100%)');
}
async function setWallpaper(value) {
  await kv.set('settings.wallpaper', value);
  applyWallpaper(value);
}
function applyWallpaper(value) {
  const isUrl = value.startsWith('data:') || value.startsWith('http');
  $('#wallpaper').style.background = isUrl ? `center/cover no-repeat url(${value})` : value;
}

async function getAccentColor() {
  return kv.get('settings.accentColor', '#0067c0');
}
async function setAccentColor(color) {
  await kv.set('settings.accentColor', color);
  document.documentElement.style.setProperty('--accent-2', color);
}

async function getScale() {
  return kv.get('settings.scale', 1);
}
async function setScale(scale) {
  await kv.set('settings.scale', scale);
  document.documentElement.style.zoom = scale;
}

async function getReduceMotion() {
  return kv.get('settings.reduceMotion', false);
}
async function setReduceMotion(value) {
  await kv.set('settings.reduceMotion', value);
  motion.setReducedMotionOverride(value);
}

let timeFormat = '24h';
async function setTimeFormat(value) {
  timeFormat = value;
  await kv.set('settings.timeFormat', value);
  updateClocks();
}

// ---------------- Apps desativados (Configurações > Aplicativos) ----------------
// "Desativar" nunca apaga nada de verdade — só tira o app do Menu Iniciar,
// da busca e do "Abrir com", e some da barra de tarefas se estava fixado
// lá. Janelas já abertas desse app continuam funcionando normalmente.
let disabledApps = [];
function isAppDisabled(id) {
  return disabledApps.includes(id);
}
async function setAppDisabled(id, disabled) {
  disabledApps = disabled ? [...new Set([...disabledApps, id])] : disabledApps.filter((a) => a !== id);
  await kv.set('apps.disabled', disabledApps);
  // Não mexe em taskbar.pinned nem em desktop.appShortcuts — desativar só
  // esconde (via filtro na hora de renderizar), nunca desfixa de verdade,
  // pra reativar trazer tudo de volta exatamente como estava antes, sem
  // precisar fixar/enviar pra área de trabalho de novo.
  renderTaskbarApps();
  renderStartMenu();
  renderDesktopIcons();
}

// ---------------- Ícone da Lixeira (muda com o conteúdo, como no Windows) ----------------
let trashHasItems = false;
async function refreshTrashState() {
  trashHasItems = (await fs.getChildren(seed.trashId)).length > 0;
  const rb = PINNED_APPS.find((a) => a.id === 'recycle-bin');
  if (rb) rb.glyph = trashGlyph(trashHasItems);
  renderDesktopIcons();
  renderTaskbarApps();
  renderStartMenu();
}

async function emptyTrashFromDesktop() {
  if (!confirm('Excluir permanentemente todos os itens da Lixeira?')) return;
  const items = await fs.getChildren(seed.trashId);
  for (const item of items) await fs.deleteNodePermanently(item.id);
  refreshTrashState();
  if (items.length) {
    ctx.notify?.({
      appId: 'explorer',
      icon: '🗑️',
      title: 'Lixeira esvaziada',
      body: `${items.length} ${items.length > 1 ? 'itens excluídos' : 'item excluído'} permanentemente.`,
    });
  }
}

// ---------------- Boot sequence ----------------
/** Aplica tudo que é específico da conta (tema, papel de parede, escala,
 * movimento reduzido, formato de hora) e semeia o sistema de arquivos DELA
 * — chamado sempre que uma conta passa a ser a ativa (login único
 * automático, escolha na tela de contas, ou troca de usuário). */
async function loadAccountEnvironment(accountId) {
  setActiveAccount(accountId);
  seed = await ensureSeed();
  const theme = await getTheme();
  document.documentElement.setAttribute('data-theme', theme);
  applyWallpaper(await getWallpaper());
  document.documentElement.style.setProperty('--accent-2', await getAccentColor());
  document.documentElement.style.zoom = await getScale();
  motion.setReducedMotionOverride(await getReduceMotion());
  timeFormat = await kv.get('settings.timeFormat', '24h');
  disabledApps = await kv.get('apps.disabled', []);
  await refreshTrashState();
}

/** Instalações de antes do suporte a múltiplas contas tinham tudo salvo em
 * chaves soltas (uma conta implícita única). Migra essa conta para o novo
 * formato — sem perder senha, arquivos ou configurações — e a registra na
 * lista de contas, para que o usuário existente não veja nada diferente. */
async function tryMigrateLegacyAccount() {
  if (!(await hasLegacyAccountData())) return null;
  const id = newAccountId();
  await migrateLegacyDataToAccount(id);
  setActiveAccount(id);
  const name = await kv.get('user.name', 'Usuário');
  const avatar = await kv.get('user.avatar', null);
  // Instalação de antes do sistema de contas: essa era a única conta do
  // dispositivo, então vira o Administrador Geral permanente, como a
  // primeira conta criada em qualquer instalação nova.
  await addAccountRecord({ id, name, avatar, role: 'admin', primary: true });
  await setLastActiveAccountId(id);
  return id;
}

async function boot() {
  setTimeout(async () => {
    hide($('#boot-screen'));
    playStartupChime();
    let accounts = await listAccounts();
    if (!accounts.length) {
      if (await tryMigrateLegacyAccount()) {
        accounts = await listAccounts();
      } else {
        // Nenhuma conta local ainda: primeira execução, mostra o assistente
        // de configuração inicial (OOBE).
        startOobe();
        return;
      }
    }
    if (accounts.length === 1) {
      // Único usuário do dispositivo: pula a tela de escolha e vai direto
      // para o login dele, como faz o Windows.
      await loadAccountEnvironment(accounts[0].id);
      await showLockScreenFor(accounts[0]);
      return;
    }
    renderAccountPicker(accounts);
    show($('#account-picker-screen'));
  }, 900);
}

async function showLockScreenFor(account) {
  $('#lock-username').textContent = await kv.get('user.name', account?.name || 'Usuário');
  await refreshAvatars();
  const lockUntil = await kv.get('auth.lockUntil', 0);
  if (lockUntil > Date.now()) startLockoutCountdown(lockUntil);
  // Sempre entra pelo formulário de senha normal, com o relógio visível —
  // nunca deve sobrar um estado de "esqueci minha senha" de uma sessão
  // anterior (ali o relógio fica escondido de propósito).
  hide($('#lock-recovery-form'));
  show($('#lock-form'));
  show($('.lock-clock'));
  // "Trocar de usuário" só faz sentido (e só aparece) quando existe outra
  // conta pra onde voltar — em um dispositivo de conta única não há pra
  // onde "trocar", então o botão fica escondido.
  const accounts = await listAccounts();
  $('#lock-switch-user-btn').classList.toggle('hidden', accounts.length <= 1);
  show($('#lock-screen'));
  $('#lock-pass').focus();
}

async function backToAccountPicker() {
  hide($('#lock-screen'));
  $('#lock-pass').value = '';
  $('#lock-error').classList.add('hidden');
  const accounts = await listAccounts();
  renderAccountPicker(accounts);
  show($('#account-picker-screen'));
}

async function selectAccount(accountId) {
  await loadAccountEnvironment(accountId);
  hide($('#account-picker-screen'));
  await showLockScreenFor({ name: await kv.get('user.name', 'Usuário') });
}

async function switchToSpecificAccount(id) {
  await recordLogoff(getActiveAccount());
  WM.closeAllWindows();
  WM.resetDesktops();
  hide($('#desktop'));
  playLockChime();
  await selectAccount(id);
}

async function removeAccountFlow(id) {
  const accounts = await listAccounts();
  const account = accounts.find((a) => a.id === id);
  if (!account) return false;
  if (account.primary) {
    alert('A conta do Administrador Geral não pode ser removida.');
    return false;
  }
  const activeAccount = accounts.find((a) => a.id === getActiveAccount());
  if (activeAccount?.role !== 'admin') {
    alert('Apenas um administrador pode remover contas.');
    return false;
  }
  if (!confirm(`Remover a conta "${account.name}" e todos os seus arquivos permanentemente? Isso não pode ser desfeito.`)) return false;
  const rootId = await kv.getFor(id, 'rootId');
  if (rootId) await fs.deleteNodePermanently(rootId);
  await kv.removeAllFor(id);
  await removeAccountRecord(id);
  return true;
}

async function setAccountRoleFlow(id, role) {
  const accounts = await listAccounts();
  const target = accounts.find((a) => a.id === id);
  if (!target || target.primary) return false;
  const activeAccount = accounts.find((a) => a.id === getActiveAccount());
  if (activeAccount?.role !== 'admin') {
    alert('Apenas um administrador pode alterar o tipo de outra conta.');
    return false;
  }
  await updateAccountRecord(id, { role });
  return true;
}

/** Usado pelo comando `net user <nome> <senha>` do Terminal (apps/terminal.js).
 * Devolve um motivo em vez de só true/false pra o Terminal poder mostrar a
 * mensagem de erro certa (a mesma distinção que o `net user` de verdade
 * do Windows faz: usuário não encontrado vs. acesso negado). */
async function netUserSetPassword(name, newPassword) {
  const accounts = await listAccounts();
  const target = accounts.find((a) => a.name.toLowerCase() === (name || '').toLowerCase());
  if (!target) return 'not-found';
  const activeAccount = accounts.find((a) => a.id === getActiveAccount());
  if (activeAccount?.role !== 'admin') return 'forbidden';
  await adminResetPassword(target.id, newPassword);
  return 'ok';
}

function accountAvatarTileHTML(account) {
  if (account.avatar) return `<img src="${escapeHtml(account.avatar)}" alt="">`;
  const initial = (account.name || '?').trim().charAt(0).toUpperCase() || '?';
  return escapeHtml(initial);
}

function accountRoleLabel(account) {
  if (account.primary) return 'Administrador Geral';
  return account.role === 'admin' ? 'Administrador' : 'Usuário comum';
}

function renderAccountPicker(accounts) {
  const grid = $('[data-role="account-picker-grid"]');
  grid.innerHTML = '';
  accounts.forEach((account) => {
    const tile = document.createElement('button');
    tile.className = 'account-tile';
    tile.innerHTML = `<span class="avatar-lg-tile">${accountAvatarTileHTML(account)}</span>`;
    const label = document.createElement('span');
    label.textContent = account.name;
    tile.appendChild(label);
    const roleLabel = document.createElement('span');
    roleLabel.className = 'account-tile-role';
    roleLabel.textContent = accountRoleLabel(account);
    tile.appendChild(roleLabel);
    tile.addEventListener('click', () => selectAccount(account.id));
    grid.appendChild(tile);
  });
  // Segue o limite de MAX_ACCOUNTS contas do dispositivo: some o "+" quando
  // já existem 3, em vez de deixar chegar no OOBE pra só então bloquear.
  if (accounts.length < MAX_ACCOUNTS) {
    const addTile = document.createElement('button');
    addTile.className = 'account-tile add-account';
    addTile.innerHTML = '<span>+</span>';
    const addLabel = document.createElement('span');
    addLabel.textContent = 'Adicionar conta';
    addTile.appendChild(addLabel);
    addTile.addEventListener('click', () => {
      hide($('#account-picker-screen'));
      startOobe();
    });
    grid.appendChild(addTile);
  } else {
    const limitNote = document.createElement('p');
    limitNote.className = 'account-picker-limit-note';
    limitNote.textContent = `Limite de ${MAX_ACCOUNTS} contas atingido neste dispositivo.`;
    grid.appendChild(limitNote);
  }
}

async function switchUser() {
  WM.closeAllWindows();
  WM.resetDesktops();
  hide($('#desktop'));
  playLockChime();
  const accounts = await listAccounts();
  renderAccountPicker(accounts);
  show($('#account-picker-screen'));
}

// ---------------- OOBE (configuração inicial em várias etapas) ----------------
// A etapa de ativação (chave de produto) só existe na primeíssima conta do
// dispositivo — como o Windows real, ativar acontece uma vez só; adicionar
// uma 2ª ou 3ª conta local depois não pede a chave de novo.
const OOBE_STEPS_BASE = ['theme', 'wallpaper', 'account', 'security', 'done'];
const OOBE_STEPS_FIRST_INSTALL = ['theme', 'wallpaper', 'account', 'activation', 'security', 'done'];
let OOBE_STEPS = OOBE_STEPS_BASE;
let oobeAccountId = null;
let oobeStepIndex = 0;
let oobeChoices = { theme: 'dark', wallpaper: WALLPAPERS[0].value, name: '', avatar: null };
let oobeSerialValidated = false;

// Chave alfanumérica fixa de 12 caracteres (A-Z/0-9, sem 0/O/1/I pra evitar
// confusão visual). Nunca fica em texto puro em lugar nenhum do código —
// só o resultado de PBKDF2-SHA256 com sal e 1 milhão de iterações. Não é
// segurança de servidor de verdade (é tudo client-side, sem como ser —
// quem tiver acesso ao JS sempre consegue contornar a checagem em si), mas
// pra quem tentasse quebrar por força bruta o hash gravado, cada tentativa
// custa de verdade essa 1 milhão de iterações (algumas centenas de
// milissegundos), não um hash simples que uma GPU calcula aos bilhões por
// segundo — mesmo espírito de proteção usado pra senha de conta de verdade
// (ver core/services/auth.js).
const ACTIVATION_SALT = 'a0ff1c326bb133d85d54233cfb92f540';
const ACTIVATION_HASH = 'f0c949de15220a5d0df0dabf27cd69deb2f7acc5af866dbed3745ce170cb08f7';
const ACTIVATION_ITERATIONS = 1000000;

async function verifySerial(rawInput) {
  const chars = (rawInput || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (chars.length !== 12) return false;
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(chars), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(ACTIVATION_SALT), iterations: ACTIVATION_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hex = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === ACTIVATION_HASH;
}

function renderOobeWallpaperOptions() {
  const grid = $('[data-role="oobe-wallpapers"]');
  grid.innerHTML = '';
  WALLPAPERS.forEach((wp) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'oobe-wallpaper-swatch' + (wp.value === oobeChoices.wallpaper ? ' selected' : '');
    swatch.style.background = wp.value;
    swatch.title = wp.id;
    swatch.addEventListener('click', async () => {
      grid.querySelectorAll('.oobe-wallpaper-swatch').forEach((s) => s.classList.remove('selected'));
      swatch.classList.add('selected');
      oobeChoices.wallpaper = wp.value;
      await setWallpaper(wp.value);
    });
    grid.appendChild(swatch);
  });
}

async function startOobe() {
  oobeAccountId = newAccountId();
  setActiveAccount(oobeAccountId);
  oobeChoices = { theme: 'dark', wallpaper: WALLPAPERS[0].value, name: '', avatar: null };
  oobeSerialValidated = false;
  $('#setup-name').value = '';
  $('#setup-email').value = '';
  $('#setup-pass').value = '';
  $('#setup-pass2').value = '';
  $('#setup-serial').value = '';
  $('#setup-serial').disabled = false;
  hide($('#setup-error'));
  hide($('#setup-serial-msg'));
  $('#setup-avatar').innerHTML = avatarHTML('', null);
  document.querySelectorAll('.oobe-theme-btn').forEach((b) => b.classList.toggle('selected', b.dataset.oobeTheme === oobeChoices.theme));
  renderOobeWallpaperOptions();
  const isFirstAccount = (await listAccounts()).length === 0;
  OOBE_STEPS = isFirstAccount ? OOBE_STEPS_FIRST_INSTALL : OOBE_STEPS_BASE;
  const roleNote = $('[data-role="oobe-role-note"]');
  if (roleNote) {
    roleNote.textContent = isFirstAccount
      ? 'Esta será a conta de Administrador Geral deste dispositivo.'
      : 'Esta conta nasce como usuário comum — o administrador pode torná-la administradora depois, nas Configurações.';
  }
  showOobeStep(0);
  show($('#setup-screen'));
}

function renderOobeProgress() {
  $('[data-role="oobe-progress"]').innerHTML = OOBE_STEPS
    .map((_, i) => `<span class="${i === oobeStepIndex ? 'active' : ''}"></span>`)
    .join('');
}

function showOobeStep(index) {
  oobeStepIndex = index;
  document.querySelectorAll('.oobe-step').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.step !== OOBE_STEPS[index]);
  });
  renderOobeProgress();
  $('[data-action="oobe-back"]').classList.toggle('hidden', index === 0);
  const nextBtn = $('[data-action="oobe-next"]');
  if (OOBE_STEPS[index] === 'done') {
    nextBtn.textContent = 'Ir para a área de trabalho →';
    $('[data-role="oobe-summary"]').textContent = `Tudo certo, ${oobeChoices.name || 'Usuário'}! Sua conta está pronta.`;
  } else {
    nextBtn.textContent = 'Avançar →';
  }
}

async function finalizeOobeAccount({ email, pass }) {
  await setPassword(pass);
  await kv.set('user.name', oobeChoices.name);
  await setEmail(email);
  await setTheme(oobeChoices.theme);
  await setWallpaper(oobeChoices.wallpaper);
  if (oobeChoices.avatar) await kv.set('user.avatar', oobeChoices.avatar);
  seed = await ensureSeed();
  if (seed?.userFolderId) await fs.rename(seed.userFolderId, oobeChoices.name);
  // A primeira conta do dispositivo nasce como Administrador Geral
  // permanente; as próximas nascem como usuário comum (o admin pode
  // promover depois, pelas Configurações).
  const isFirstAccount = (await listAccounts()).length === 0;
  await addAccountRecord({
    id: oobeAccountId,
    name: oobeChoices.name,
    avatar: oobeChoices.avatar,
    role: isFirstAccount ? 'admin' : 'standard',
    primary: isFirstAccount,
  });
  await setLastActiveAccountId(oobeAccountId);
  await recordLogon(oobeAccountId);
}

async function handleOobeNext() {
  const step = OOBE_STEPS[oobeStepIndex];
  if (step === 'account') {
    oobeChoices.name = $('#setup-name').value.trim() || 'Usuário';
  } else if (step === 'activation') {
    const msg = $('#setup-serial-msg');
    if (!oobeSerialValidated) {
      const ok = await verifySerial($('#setup-serial').value);
      if (!ok) {
        msg.textContent = 'Chave de produto inválida.';
        msg.className = 'auth-error';
        show(msg);
        return;
      }
      msg.textContent = 'Sistema ativado com êxito.';
      msg.className = 'auth-success';
      show(msg);
      oobeSerialValidated = true;
      $('#setup-serial').disabled = true;
      return; // mostra a confirmação primeiro; só avança no próximo clique
    }
  } else if (step === 'security') {
    const email = $('#setup-email').value.trim();
    const pass = $('#setup-pass').value;
    const pass2 = $('#setup-pass2').value;
    const err = $('#setup-error');
    if (!email) {
      err.textContent = 'Informe um e-mail para recuperação de senha.';
      show(err);
      return;
    }
    if (pass.length < 4) {
      err.textContent = 'A senha deve ter ao menos 4 caracteres.';
      show(err);
      return;
    }
    if (pass !== pass2) {
      err.textContent = 'As senhas não coincidem.';
      show(err);
      return;
    }
    hide(err);
    await finalizeOobeAccount({ email, pass });
  } else if (step === 'done') {
    // OOBE_STEPS só inclui 'activation' na instalação bem inicial (1ª conta
    // do dispositivo, a que vira Administrador Geral) — reaproveita esse
    // mesmo sinal pra decidir se é a hora de mostrar a tela de segurança
    // automaticamente, uma única vez, assim que a pessoa chega na área de
    // trabalho pela primeira vez.
    const wasFirstInstall = OOBE_STEPS.includes('activation');
    hide($('#setup-screen'));
    await enterDesktop();
    pushNotification({
      appId: 'system',
      icon: '🎉',
      title: `Bem-vindo, ${oobeChoices.name}!`,
      body: 'Sua conta foi criada. Explore o menu Iniciar para conhecer os aplicativos.',
    });
    if (wasFirstInstall) {
      setTimeout(() => openSettings(ctx, { tab: 'privacy' }), 900);
    }
    return;
  }
  if (oobeStepIndex < OOBE_STEPS.length - 1) showOobeStep(oobeStepIndex + 1);
}

function handleOobeBack() {
  if (oobeStepIndex > 0) showOobeStep(oobeStepIndex - 1);
}

$('[data-action="oobe-next"]').addEventListener('click', () => handleOobeNext());
$('[data-action="oobe-back"]').addEventListener('click', () => handleOobeBack());
$('#setup-screen').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
    e.preventDefault();
    handleOobeNext();
  }
});
document.querySelectorAll('.oobe-theme-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.oobe-theme-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    oobeChoices.theme = btn.dataset.oobeTheme;
    await setTheme(oobeChoices.theme);
  });
});
$('#setup-name').addEventListener('input', (e) => {
  $('#setup-avatar').innerHTML = avatarHTML(e.target.value, oobeChoices.avatar);
});
$('#setup-serial').addEventListener('input', (e) => {
  const chars = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  e.target.value = chars.match(/.{1,3}/g)?.join('-') || chars;
  oobeSerialValidated = false;
  hide($('#setup-serial-msg'));
});
$('#setup-photo-btn').addEventListener('click', () => $('#setup-photo').click());
$('#setup-photo').addEventListener('change', () => {
  const file = $('#setup-photo').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    oobeChoices.avatar = reader.result;
    $('#setup-avatar').innerHTML = avatarHTML($('#setup-name').value, oobeChoices.avatar);
  };
  reader.readAsDataURL(file);
});

// ---------------- Lock screen ----------------
// Trava progressiva contra tentativas repetidas de senha: as 3 primeiras
// tentativas erradas não têm custo nenhum (gente erra por engano), a partir
// da 4ª cada erro dobra o tempo de espera até um teto de 5 minutos. Isso é
// contornável por quem tem acesso ao devtools (é tudo client-side, sem
// backend pra aplicar isso de verdade) — mas barra tentativa repetida pela
// UI normal, que é o cenário real de alguém pegando o dispositivo destravado
// e tentando adivinhar a senha na tela de bloqueio.
const LOCKOUT_FREE_ATTEMPTS = 3;
const LOCKOUT_BASE_SECONDS = 5;
const LOCKOUT_MAX_SECONDS = 300;
let lockoutCountdownTimer = null;

function lockoutSecondsFor(failedCount) {
  const extra = failedCount - LOCKOUT_FREE_ATTEMPTS;
  if (extra <= 0) return 0;
  return Math.min(LOCKOUT_BASE_SECONDS * 2 ** (extra - 1), LOCKOUT_MAX_SECONDS);
}

function setLockFormDisabled(disabled) {
  $('#lock-pass').disabled = disabled;
  $('#lock-form button[type="submit"]').disabled = disabled;
}

function startLockoutCountdown(untilTs) {
  clearInterval(lockoutCountdownTimer);
  const err = $('#lock-error');
  setLockFormDisabled(true);
  function tick() {
    const remaining = Math.ceil((untilTs - Date.now()) / 1000);
    if (remaining <= 0) {
      clearInterval(lockoutCountdownTimer);
      setLockFormDisabled(false);
      hide(err);
      return;
    }
    err.textContent = `Muitas tentativas incorretas. Tente novamente em ${remaining}s.`;
    show(err);
  }
  tick();
  lockoutCountdownTimer = setInterval(tick, 1000);
}

$('#lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const lockUntil = await kv.get('auth.lockUntil', 0);
  if (lockUntil > Date.now()) {
    startLockoutCountdown(lockUntil);
    return;
  }
  const pass = $('#lock-pass').value;
  const ok = await verifyPassword(pass);
  const err = $('#lock-error');
  if (ok) {
    await kv.set('auth.failedAttempts', 0);
    await kv.remove('auth.lockUntil');
    hide($('#lock-screen'));
    $('#lock-pass').value = '';
    hide(err);
    await setLastActiveAccountId(getActiveAccount());
    await recordLogon(getActiveAccount());
    enterDesktop();
  } else {
    const failedCount = (await kv.get('auth.failedAttempts', 0)) + 1;
    await kv.set('auth.failedAttempts', failedCount);
    const seconds = lockoutSecondsFor(failedCount);
    if (seconds > 0) {
      const until = Date.now() + seconds * 1000;
      await kv.set('auth.lockUntil', until);
      startLockoutCountdown(until);
    } else {
      show(err);
    }
  }
});

// Recuperação de senha: só quem souber o e-mail cadastrado no momento do
// cadastro consegue definir uma nova senha. Não há envio real de e-mail
// (não existe backend) — é uma verificação local, deixada clara na tela.
$('#lock-hint-btn').addEventListener('click', () => {
  hide($('#lock-form'));
  hide($('.lock-clock'));
  $('#recovery-email').value = '';
  $('#recovery-pass').value = '';
  $('#recovery-pass2').value = '';
  hide($('#recovery-error'));
  show($('#lock-recovery-form'));
});
$('#recovery-back-btn').addEventListener('click', () => {
  hide($('#lock-recovery-form'));
  show($('#lock-form'));
  show($('.lock-clock'));
});
$('#lock-switch-user-btn').addEventListener('click', () => backToAccountPicker());
$('#lock-recovery-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#recovery-email').value.trim();
  const pass = $('#recovery-pass').value;
  const pass2 = $('#recovery-pass2').value;
  const err = $('#recovery-error');
  if (pass !== pass2) {
    err.textContent = 'As senhas não coincidem.';
    show(err);
    return;
  }
  const registeredEmail = await getEmail();
  if (!registeredEmail) {
    err.textContent = 'Nenhum e-mail foi cadastrado nesta conta — não é possível recuperar a senha.';
    show(err);
    return;
  }
  const ok = await resetPasswordWithEmail(email, pass);
  if (!ok) {
    err.textContent = 'O e-mail informado não corresponde ao cadastrado.';
    show(err);
    return;
  }
  hide($('#lock-recovery-form'));
  show($('#lock-form'));
  show($('.lock-clock'));
  $('#lock-pass').value = '';
  hide($('#lock-error'));
  alert('Senha redefinida com sucesso. Faça login com a nova senha.');
});

// ---------------- Facilidade de Acesso (telas de configuração/bloqueio) ----------------
// Reaproveita as mesmas configurações reais de acessibilidade já usadas no
// app (alto contraste, reduzir animações, escala de texto), disponíveis
// também antes de entrar na área de trabalho — como no Windows.
$('#ease-of-access-btn').addEventListener('click', async (e) => {
  e.stopPropagation();
  const menu = $('#ease-of-access-menu');
  if (!menu.classList.contains('hidden')) {
    hidePanel(menu);
    return;
  }
  const theme = await getTheme();
  const reduceMotion = await getReduceMotion();
  const scale = await getScale();
  $('#eoa-contrast').checked = theme === 'contrast';
  $('#eoa-motion').checked = reduceMotion;
  document.querySelectorAll('.eoa-scale-btn').forEach((btn) => {
    btn.classList.toggle('active', parseFloat(btn.dataset.scale) === scale);
  });
  positionPanelNearButton(menu, $('#ease-of-access-btn'));
});
$('#eoa-contrast').addEventListener('change', async (e) => {
  if (e.target.checked) {
    const current = await getTheme();
    await kv.set('settings.themeBeforeContrast', current === 'contrast' ? 'light' : current);
    await setTheme('contrast');
  } else {
    const previous = await kv.get('settings.themeBeforeContrast', 'light');
    await setTheme(previous);
  }
});
$('#eoa-motion').addEventListener('change', (e) => setReduceMotion(e.target.checked));
document.querySelectorAll('.eoa-scale-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await setScale(parseFloat(btn.dataset.scale));
    document.querySelectorAll('.eoa-scale-btn').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

function updateClocks() {
  const now = new Date();
  const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' });
  const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const lockTime = $('#lock-time');
  if (lockTime) lockTime.textContent = time;
  const lockDate = $('#lock-date');
  if (lockDate) lockDate.textContent = date;
  const tray = $('#tray-clock');
  if (tray) tray.textContent = `${time}\n${date.split(',')[0]}`;
}
setInterval(updateClocks, 1000);
updateClocks();

function lockNow() {
  recordLogoff(getActiveAccount());
  WM.closeAllWindows();
  hide($('#desktop'));
  playLockChime();
  // A chave que decifra os arquivos só existe em memória durante a sessão —
  // some daqui até a senha ser digitada de novo com sucesso.
  clearSessionDek();
  showLockScreenFor({});
}

function sleepNow() {
  document.body.classList.add('sleeping');
  setTimeout(() => {
    lockNow();
    document.body.classList.remove('sleeping');
  }, 420);
}

function restartNow() {
  WM.closeAllWindows();
  hide($('#start-menu'));
  hide($('#power-menu'));
  hide($('#desktop'));
  playShutdownChime();
  show($('#restart-screen'));
  setTimeout(() => location.reload(), 1700);
}

function shutdownNow() {
  WM.closeAllWindows();
  hide($('#start-menu'));
  hide($('#power-menu'));
  hide($('#desktop'));
  playShutdownChime();
  show($('#shutdown-screen'));
  setTimeout(() => {
    hide($('#shutdown-spinner'));
    show($('#shutdown-message'));
    show($('#power-on-btn'));
    try { window.close(); } catch {}
  }, 1600);
}

$('#power-on-btn').addEventListener('click', () => location.reload());

// ---------------- UAC + formatação/redefinição do dispositivo ----------------
// Compartilhado entre Configurações > Privacidade ("Apagar dados") e
// Configurações > Backup ("Redefinir este dispositivo") — mesmo modal de
// autorização, mesma tela de formatação, chamados via ctx.startWipeFlow().
let uacResolve = null;

async function showUacPrompt() {
  if ((await getActiveAccountRole()) !== 'admin') {
    alert('Só um administrador pode redefinir este dispositivo.');
    return false;
  }
  const accounts = await listAccounts();
  const me = accounts.find((a) => a.id === getActiveAccount());
  $('[data-role="uac-avatar"]').innerHTML = accountAvatarTileHTML(me || {});
  $('[data-role="uac-account-name"]').textContent = me?.name || '';
  $('#uac-pass').value = '';
  hide($('#uac-error'));
  show($('#uac-screen'));
  $('#uac-pass').focus();
  return new Promise((resolve) => { uacResolve = resolve; });
}

function resolveUac(value) {
  hide($('#uac-screen'));
  uacResolve?.(value);
  uacResolve = null;
}

$('[data-action="uac-cancel"]').addEventListener('click', () => resolveUac(false));
$('[data-action="uac-confirm"]').addEventListener('click', async () => {
  const pass = $('#uac-pass').value;
  const ok = await verifyPassword(pass);
  if (!ok) {
    show($('#uac-error'));
    $('#uac-pass').value = '';
    $('#uac-pass').focus();
    return;
  }
  resolveUac(true);
});
$('#uac-pass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('[data-action="uac-confirm"]').click();
});

/** Roda a animação da tela de formatação usando nomes REAIS de arquivos,
 * pastas e chaves de configuração já existentes no dispositivo (nunca nomes
 * inventados) — dura 1 minuto ao todo, espalhado entre as entradas
 * encontradas. Só libera o botão Finalizar no fim. */
let wipeAborted = false;

async function runWipeFormatScreen() {
  wipeAborted = false;
  const fill = $('#wipe-fill');
  const pctEl = $('#wipe-pct');
  const log = $('#wipe-log');
  const finishBtn = $('#wipe-finish-btn');
  log.innerHTML = '';
  fill.style.transition = 'none';
  fill.style.width = '0%';
  pctEl.textContent = '0% concluído';
  finishBtn.disabled = true;
  show($('#wipe-screen'));

  const entries = await listRealEntryNames();
  const totalMs = 60000;
  const steps = Math.max(entries.length, 1);
  const stepMs = totalMs / steps;

  for (let i = 0; i < entries.length; i++) {
    if (wipeAborted) return;
    const entry = entries[i];
    const verb = entry.kind === 'config' ? 'Removendo configuração'
      : entry.kind === 'folder' ? 'Removendo pasta'
      : 'Apagando arquivo';
    const line = document.createElement('div');
    line.textContent = `${verb} "${entry.name}"...`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    const donePct = Math.round(((i + 1) / entries.length) * 100);
    fill.style.transition = `width ${stepMs}ms linear`;
    fill.style.width = `${donePct}%`;
    pctEl.textContent = `${donePct}% concluído`;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  if (wipeAborted) return;
  if (!entries.length) {
    fill.style.transition = `width ${totalMs}ms linear`;
    fill.style.width = '100%';
    await new Promise((r) => setTimeout(r, totalMs));
  }
  if (wipeAborted) return;
  pctEl.textContent = 'Formatação concluída.';
  finishBtn.disabled = false;
}

$('#wipe-finish-btn').addEventListener('click', async () => {
  if ($('#wipe-finish-btn').disabled) return;
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  indexedDB.deleteDatabase('win11-web-os');
  location.reload();
});

// Na tela de formatação, dá pra usar um backup já feito em vez de continuar
// formatando do zero — interrompe a animação em andamento e restaura o
// conteúdo do arquivo escolhido no lugar.
$('#wipe-use-backup-btn').addEventListener('click', () => $('#wipe-backup-input').click());
$('#wipe-backup-input').addEventListener('change', async () => {
  const input = $('#wipe-backup-input');
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    alert('Não foi possível ler esse arquivo como um backup válido.');
    return;
  }
  if (!isValidBackup(data)) {
    alert('Não foi possível ler esse arquivo como um backup válido.');
    return;
  }
  if (!confirm('Restaurar este backup em vez de formatar? Isso substitui tudo o que existe agora neste dispositivo.')) return;
  wipeAborted = true;
  $('#wipe-title').textContent = 'Restaurando backup...';
  $('#wipe-pct').textContent = 'Restaurando...';
  $('#wipe-log').innerHTML = '';
  $('#wipe-finish-btn').disabled = true;
  await restoreBackup(data);
  location.reload();
});

async function startWipeFlow() {
  const authorized = await showUacPrompt();
  if (!authorized) return;
  await runWipeFormatScreen();
}

// ---------------- Desktop ----------------
async function enterDesktop() {
  show($('#desktop'));
  $('#start-username').textContent = await kv.get('user.name', 'Usuário');
  await refreshAvatars();
  await refreshVolumeUI();
  await renderDesktopIcons();
  renderStartMenu();
  renderTaskbarApps();
  await updateNotifBadge();
  checkSystemNotifications();
}

/** Avisos reais de sistema (nunca inventados): bateria fraca via Battery
 * Status API e armazenamento quase cheio via Storage API, quando o
 * navegador expõe esses dados. Cada aviso só repete depois de 30 minutos,
 * pra não spammar a cada bloqueio/login dentro da mesma sessão. */
async function checkSystemNotifications() {
  if (navigator.getBattery) {
    try {
      const battery = await navigator.getBattery();
      if (!battery.charging && battery.level <= 0.2) {
        const lastShown = await kv.get('notif.batteryLowAt', 0);
        if (Date.now() - lastShown > 30 * 60 * 1000) {
          await kv.set('notif.batteryLowAt', Date.now());
          pushNotification({
            appId: 'system',
            icon: '🔋',
            title: 'Bateria fraca',
            body: `${Math.round(battery.level * 100)}% restante. Considere conectar o carregador.`,
          });
        }
      }
    } catch {}
  }
  const estimate = (await navigator.storage?.estimate?.()) || null;
  if (estimate?.quota) {
    const ratio = estimate.usage / estimate.quota;
    if (ratio > 0.9) {
      const lastShown = await kv.get('notif.storageFullAt', 0);
      if (Date.now() - lastShown > 30 * 60 * 1000) {
        await kv.set('notif.storageFullAt', Date.now());
        pushNotification({
          appId: 'system',
          icon: '💾',
          title: 'Armazenamento quase cheio',
          body: `${Math.round(ratio * 100)}% do espaço disponível neste navegador já foi usado.`,
        });
      }
    }
  }
}

// Atalhos de apps enviados pro desktop a partir do Menu Iniciar — não são
// arquivo/pasta nenhum no sistema de arquivos virtual, só um appId
// lembrado aqui. Filtrados pelos mesmos apps desativados (some da área de
// trabalho junto com o Menu Iniciar/busca/Abrir com, volta ao reativar).
async function getDesktopAppShortcuts() {
  return kv.get('desktop.appShortcuts', []);
}
async function setDesktopAppShortcuts(list) {
  await kv.set('desktop.appShortcuts', list);
}
async function sendAppToDesktop(appId) {
  const list = await getDesktopAppShortcuts();
  if (!list.includes(appId)) await setDesktopAppShortcuts([...list, appId]);
  renderDesktopIcons();
}
async function removeDesktopAppShortcut(appId) {
  const list = await getDesktopAppShortcuts();
  await setDesktopAppShortcuts(list.filter((id) => id !== appId));
  renderDesktopIcons();
}

function fixedIcons() {
  return [
    { id: 'this-pc', label: 'Este Computador', glyph: PC_GLYPH, fixed: true, onOpen: () => openExplorer(ctx, { startFolderId: seed.rootId }) },
    { id: 'recycle-bin', label: 'Lixeira', glyph: trashGlyph(trashHasItems), fixed: true, onOpen: () => openExplorer(ctx, { startFolderId: seed.trashId, isTrash: true }) },
  ];
}

// Preenche em colunas (de cima pra baixo, depois pra direita — igual ao
// Windows real) mas limitando o número de colunas ao que cabe de verdade
// na largura da tela, senão em telas estreitas (celular) as colunas depois
// da 3ª/4ª ficam fora da área visível e os ícones "somem".
function gridPosition(idx) {
  const colWidth = 100;
  const rowHeight = 100;
  const container = $('#desktop-icons');
  const availW = (container?.clientWidth || window.innerWidth) - 16;
  const availH = (container?.clientHeight || window.innerHeight) - 16;
  const maxRows = Math.max(3, Math.floor(availH / rowHeight));
  const maxCols = Math.max(1, Math.floor(availW / colWidth));
  const col = Math.floor(idx / maxRows) % maxCols;
  const band = Math.floor(idx / (maxRows * maxCols));
  const row = idx % maxRows;
  return { x: 16 + col * colWidth, y: 16 + row * rowHeight + band * (maxRows * rowHeight) };
}

// Garante que um ícone (posição salva de um arraste anterior, possivelmente
// numa tela bem maior) sempre fique dentro da área visível atual — sem
// isso, um ícone reposicionado num monitor grande simplesmente some ao
// abrir a mesma conta num celular.
function clampIconPosition(pos) {
  const container = $('#desktop-icons');
  const maxX = Math.max(16, (container?.clientWidth || window.innerWidth) - 88 - 8);
  const maxY = Math.max(16, (container?.clientHeight || window.innerHeight) - 88 - 8);
  return { x: Math.min(Math.max(pos.x, 8), maxX), y: Math.min(Math.max(pos.y, 8), maxY) };
}

async function getAutoArrange() {
  return kv.get('desktop.autoArrange', false);
}
async function setAutoArrange(value) {
  await kv.set('desktop.autoArrange', value);
  renderDesktopIcons();
}

// Estado do ícone sendo arrastado no momento. Os listeners de ponteiro do
// arraste são registrados uma única vez (fora de renderDesktopIcons) e
// reaproveitados a cada renderização — anexá-los de novo a cada chamada
// (como uma versão anterior fazia) vazava um listener em `window` por
// ícone, a cada atualização da área de trabalho, para sempre.
let draggedIcon = null; // { id, el }
let draggedMoved = false;
let dragOffX = 0, dragOffY = 0;

document.addEventListener('pointermove', (e) => {
  if (!draggedIcon) return;
  draggedMoved = true;
  draggedIcon.el.style.left = `${Math.max(0, e.clientX - dragOffX)}px`;
  draggedIcon.el.style.top = `${Math.max(0, e.clientY - dragOffY)}px`;
});
document.addEventListener('pointerup', async () => {
  if (draggedIcon && draggedMoved) {
    const all = await kv.get('desktop.positions', {});
    all[draggedIcon.id] = { x: draggedIcon.el.offsetLeft, y: draggedIcon.el.offsetTop };
    await kv.set('desktop.positions', all);
  }
  draggedIcon = null;
});

async function renderDesktopIcons() {
  const container = $('#desktop-icons');
  container.innerHTML = '';
  const children = await fs.getChildren(seed.desktopId);
  const appShortcuts = await getDesktopAppShortcuts();
  const icons = [
    ...fixedIcons(),
    ...appShortcuts
      .filter((appId) => !isAppDisabled(appId))
      .map((appId) => PINNED_APPS.find((a) => a.id === appId))
      .filter(Boolean)
      .map((app) => ({
        id: `shortcut-${app.id}`,
        label: app.label,
        glyph: app.glyph,
        isShortcut: true,
        appId: app.id,
        onOpen: app.onOpen,
      })),
    ...children.map((node) => ({
      id: node.id,
      label: node.name,
      glyph: fileGlyph(node),
      node,
      onOpen: () => openFile(node),
    })),
  ];
  const autoArrange = await getAutoArrange();
  const positions = autoArrange ? {} : await kv.get('desktop.positions', {});

  icons.forEach((icon, idx) => {
    const el = document.createElement('div');
    el.className = 'desktop-icon';
    el.innerHTML = `<div class="icon-glyph${icon.isShortcut ? ' is-shortcut' : ''}">${icon.glyph}</div><div class="icon-label">${escapeHtml(icon.label)}</div>`;
    const pos = clampIconPosition(positions[icon.id] || gridPosition(idx));
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;

    el.addEventListener('dblclick', () => icon.onOpen());

    if (!autoArrange) {
      el.addEventListener('pointerdown', (e) => {
        draggedIcon = { id: icon.id, el };
        draggedMoved = false;
        dragOffX = e.clientX - el.offsetLeft;
        dragOffY = e.clientY - el.offsetTop;
        document.querySelectorAll('.desktop-icon.selected').forEach((n) => n.classList.remove('selected'));
        el.classList.add('selected');
      });
    }

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const items = [{ label: 'Abrir', onClick: () => icon.onOpen() }];
      if (icon.isShortcut) {
        items.push({ label: '✕ Remover da área de trabalho', onClick: () => removeDesktopAppShortcut(icon.appId) });
      } else if (!icon.fixed) {
        items.push(
          { label: 'Renomear', onClick: () => renameIcon(icon.node) },
          { label: 'Excluir', onClick: () => deleteIcon(icon.node) }
        );
      }
      if (icon.node?.type === 'file') {
        items.push({
          label: '🗂️ Abrir com',
          onClick: () => showContextMenu(e.clientX, e.clientY, ctx.openWithApps.map((app) => ({
            label: `${app.glyph} ${app.label}`,
            onClick: () => app.open(icon.node),
          }))),
        });
      }
      if (icon.id === 'this-pc') {
        items.push({ label: 'ℹ️ Propriedades', onClick: () => showSystemProperties(ctx, document.body) });
      }
      if (icon.id === 'recycle-bin') {
        items.push({ label: '🧹 Esvaziar Lixeira', onClick: () => emptyTrashFromDesktop() });
      }
      showContextMenu(e.clientX, e.clientY, items);
    });

    container.appendChild(el);
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function renameIcon(node) {
  const name = prompt('Novo nome:', node.name);
  if (!name || !name.trim()) return;
  await fs.rename(node.id, name.trim());
  renderDesktopIcons();
}
async function deleteIcon(node) {
  if (!confirm(`Mover "${node.name}" para a Lixeira?`)) return;
  await fs.trash(node.id, seed.trashId);
  renderDesktopIcons();
}

$('#desktop-icons').addEventListener('contextmenu', async (e) => {
  if (e.target.closest('.desktop-icon')) return;
  e.preventDefault();
  const autoArrange = await getAutoArrange();
  showContextMenu(e.clientX, e.clientY, [
    {
      label: '📁 Nova pasta',
      onClick: async () => {
        await fs.createNode({ parentId: seed.desktopId, name: 'Nova pasta', type: 'folder' });
        renderDesktopIcons();
      },
    },
    {
      label: '📄 Novo documento de texto',
      onClick: async () => {
        await fs.createNode({ parentId: seed.desktopId, name: 'Novo Documento de Texto.txt', type: 'file', content: '' });
        renderDesktopIcons();
      },
    },
    { label: `${autoArrange ? '✓ ' : ''}Organizar ícones automaticamente`, onClick: () => setAutoArrange(!autoArrange) },
    { label: '↻ Atualizar', onClick: () => renderDesktopIcons() },
    { label: '🎨 Personalizar', onClick: () => openSettings(ctx, { tab: 'personalization' }) },
  ]);
});

// ---------------- Context menu ----------------
function showContextMenu(x, y, items) {
  const menu = $('#context-menu');
  menu.innerHTML = '';
  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.setAttribute('role', 'menuitem');
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      hidePanel(menu);
      item.onClick();
    });
    menu.appendChild(btn);
  });
  menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - items.length * 36 - 60)}px`;
  showPanel(menu);
}

function positionPanelNearButton(panel, btn) {
  panel.style.left = '-9999px';
  panel.style.top = '-9999px';
  panel.style.bottom = 'auto';
  panel.style.right = 'auto';
  panel.style.transform = 'none';
  show(panel);
  const btnRect = btn.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  let left = btnRect.right - panelRect.width;
  left = Math.min(left, window.innerWidth - panelRect.width - 8);
  left = Math.max(8, left);
  const top = Math.max(8, btnRect.top - panelRect.height - 8);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  motion.panelOpen(panel);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#context-menu')) hidePanel($('#context-menu'));
  if (!e.target.closest('#start-menu') && !e.target.closest('#start-btn')) hidePanel($('#start-menu'));
  if (!e.target.closest('#power-menu') && !e.target.closest('#start-power')) hidePanel($('#power-menu'));
  if (!e.target.closest('#account-menu') && !e.target.closest('#start-user-btn')) hidePanel($('#account-menu'));
  if (!e.target.closest('#volume-menu') && !e.target.closest('#tray-volume-btn')) hidePanel($('#volume-menu'));
  if (!e.target.closest('#calendar-flyout') && !e.target.closest('#tray-clock')) hidePanel($('#calendar-flyout'));
  if (!e.target.closest('#ease-of-access-menu') && !e.target.closest('#ease-of-access-btn')) hidePanel($('#ease-of-access-menu'));
  if (!e.target.closest('#notification-center') && !e.target.closest('#tray-notif-btn')) hidePanel($('#notification-center'));
  if (!e.target.closest('#task-view') && !e.target.closest('#task-view-btn')) hidePanel($('#task-view'));
});

// Esc fecha o painel flutuante aberto no momento — um por vez, o mais
// recente primeiro — mesmo comportamento de teclado do Windows.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const panelSelectors = [
    '#context-menu', '#notification-center', '#calendar-flyout',
    '#volume-menu', '#ease-of-access-menu', '#account-menu', '#power-menu', '#start-menu', '#task-view',
  ];
  for (const sel of panelSelectors) {
    const el = $(sel);
    if (el && !el.classList.contains('hidden')) {
      hidePanel(el);
      return;
    }
  }
});

// ---------------- Taskbar / Start menu ----------------
const PINNED_APPS = [
  { id: 'explorer', label: 'Explorador', glyph: '📁', core: true, onOpen: () => openExplorer(ctx) },
  { id: 'browser', label: 'Navegador', glyph: BROWSER_GLYPH, onOpen: () => openBrowser(ctx) },
  { id: 'notepad', label: 'Bloco de Notas', glyph: '📝', onOpen: () => openNotepad(ctx) },
  { id: 'photos', label: 'Fotos', glyph: PHOTO_GLYPH, onOpen: () => openPhotos(ctx) },
  { id: 'word', label: 'Documento', glyph: '📘', onOpen: () => openWord(ctx) },
  { id: 'sheet', label: 'Planilha', glyph: '📗', onOpen: () => openSheet(ctx) },
  { id: 'video-player', label: 'Player de Vídeo', glyph: VIDEO_GLYPH, onOpen: () => openVideoPlayer(ctx) },
  { id: 'audio-player', label: 'Player de Áudio', glyph: AUDIO_GLYPH, onOpen: () => openAudioPlayer(ctx) },
  { id: 'presentation', label: 'Apresentação', glyph: '📙', onOpen: () => openPresentation(ctx) },
  { id: 'calculator', label: 'Calculadora', glyph: '🧮', onOpen: () => openCalculator(ctx) },
  { id: 'clock', label: 'Relógio e Calendário', glyph: '🕒', onOpen: () => openClock(ctx) },
  { id: 'terminal', label: 'Terminal', glyph: '💻', onOpen: () => openTerminal(ctx) },
  { id: 'taskmanager', label: 'Gerenciador de Tarefas', glyph: '📊', onOpen: () => openTaskManager(ctx) },
  { id: 'settings', label: 'Configurações', glyph: '⚙️', core: true, onOpen: () => openSettings(ctx) },
  { id: 'recycle-bin', label: 'Lixeira', glyph: trashGlyph(trashHasItems), core: true, hideFromPrograms: true, onOpen: () => openExplorer(ctx, { startFolderId: seed.trashId, isTrash: true }) },
];

function renderStartMenu() {
  const grid = $('#start-pinned');
  grid.innerHTML = '';
  PINNED_APPS.filter((app) => !isAppDisabled(app.id)).forEach((app) => {
    const btn = document.createElement('button');
    btn.className = 'start-app';
    btn.innerHTML = `<span class="glyph">${app.glyph}</span><span>${app.label}</span>`;
    btn.addEventListener('click', () => {
      hidePanel($('#start-menu'));
      app.onOpen();
    });
    btn.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pinned = await getPinnedTaskbarApps();
      const isPinned = pinned.includes(app.id);
      const shortcuts = await getDesktopAppShortcuts();
      const onDesktop = shortcuts.includes(app.id);
      showContextMenu(e.clientX, e.clientY, [
        { label: '📂 Abrir', onClick: () => { hidePanel($('#start-menu')); app.onOpen(); } },
        {
          label: isPinned ? '📌 Desafixar da barra de tarefas' : '📌 Fixar na barra de tarefas',
          onClick: async () => {
            const next = isPinned ? pinned.filter((id) => id !== app.id) : [...pinned, app.id];
            await setPinnedTaskbarApps(next);
            renderTaskbarApps();
          },
        },
        {
          label: onDesktop ? '🖥️ Remover da área de trabalho' : '🖥️ Enviar para a área de trabalho',
          onClick: () => (onDesktop ? removeDesktopAppShortcut(app.id) : sendAppToDesktop(app.id)),
        },
      ]);
    });
    grid.appendChild(btn);
  });
}

$('#start-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  hidePanel($('#power-menu'));
  hidePanel($('#task-view'));
  const menu = $('#start-menu');
  if (menu.classList.contains('hidden')) {
    showPanel(menu);
  } else {
    hidePanel(menu);
    return;
  }
  // Toda vez que o menu Iniciar abre, a pesquisa começa limpa — como no
  // Windows, nunca reabre já filtrado de uma busca anterior.
  $('#start-search').value = '';
  showPinnedApps();
});

// ---------------- Pesquisa global (menu Iniciar) ----------------
// Índice estático das telas de Configurações, para a busca também
// encontrar preferências (não só apps/arquivos), com atalho direto pra aba.
const SETTINGS_SEARCH_INDEX = [
  { label: 'Papel de parede', tab: 'personalization' },
  { label: 'Tema claro e escuro', tab: 'personalization' },
  { label: 'Cor de destaque', tab: 'personalization' },
  { label: 'Escala do texto', tab: 'personalization' },
  { label: 'Hora e idioma', tab: 'time' },
  { label: 'Formato de hora', tab: 'time' },
  { label: 'Acessibilidade', tab: 'accessibility' },
  { label: 'Alto contraste', tab: 'accessibility' },
  { label: 'Reduzir animações', tab: 'accessibility' },
  { label: 'Contas', tab: 'account' },
  { label: 'Alterar senha', tab: 'account' },
  { label: 'E-mail de recuperação', tab: 'account' },
  { label: 'Foto de perfil', tab: 'account' },
  { label: 'Privacidade', tab: 'privacy' },
  { label: 'Notificações', tab: 'system' },
  { label: 'Armazenamento', tab: 'system' },
  { label: 'Bateria', tab: 'system' },
  { label: 'Sobre este sistema', tab: 'about' },
];

function showPinnedApps() {
  $('#start-fixed-label').classList.remove('hidden');
  $('#start-pinned').classList.remove('hidden');
  const results = $('#start-results');
  results.classList.add('hidden');
  results.innerHTML = '';
}

/** Busca arquivos/pastas pelo nome, recursivamente, pulando a Lixeira —
 * assim como a pesquisa do Windows não traz itens já excluídos. */
async function searchFiles(query, limit = 8) {
  const results = [];
  async function walk(nodeId) {
    if (results.length >= limit) return;
    const children = await fs.getChildren(nodeId);
    for (const child of children) {
      if (results.length >= limit) return;
      if (child.id === seed.trashId) continue;
      if (child.name.toLowerCase().includes(query)) results.push(child);
      if (child.type === 'folder') await walk(child.id);
    }
  }
  await walk(seed.rootId);
  return results;
}

function searchResultRow(glyph, title, subtitle, onClick) {
  const btn = document.createElement('button');
  btn.className = 'search-result-row';
  btn.innerHTML = `<span class="glyph">${glyph}</span>`;
  const text = document.createElement('span');
  text.className = 'search-result-text';
  const strong = document.createElement('strong');
  strong.textContent = title;
  text.appendChild(strong);
  if (subtitle) {
    const small = document.createElement('small');
    small.textContent = subtitle;
    text.appendChild(small);
  }
  btn.appendChild(text);
  btn.addEventListener('click', () => {
    hidePanel($('#start-menu'));
    onClick();
  });
  return btn;
}

function renderSearchResults({ appMatches, settingMatches, fileMatches }, query) {
  const container = $('#start-results');
  container.innerHTML = '';

  function addSection(title, items, buildRow) {
    if (!items.length) return;
    const label = document.createElement('div');
    label.className = 'start-section-label';
    label.textContent = title;
    container.appendChild(label);
    items.forEach((item) => container.appendChild(buildRow(item)));
  }

  addSection('Aplicativos', appMatches, (app) => searchResultRow(app.glyph, app.label, 'Aplicativo', () => app.onOpen()));
  addSection('Configurações', settingMatches, (s) => searchResultRow('⚙️', s.label, 'Configuração', () => openSettings(ctx, { tab: s.tab })));
  addSection('Arquivos e pastas', fileMatches, (node) =>
    searchResultRow(fileGlyph(node), node.name, 'Arquivo/pasta', () => openFile(node))
  );

  if (!appMatches.length && !settingMatches.length && !fileMatches.length) {
    const empty = document.createElement('div');
    empty.className = 'start-search-empty';
    empty.textContent = `Nenhum resultado para "${query}"`;
    container.appendChild(empty);
  }
}

let searchToken = 0;
async function runGlobalSearch(rawQuery) {
  const myToken = ++searchToken;
  const q = rawQuery.trim().toLowerCase();
  const appMatches = PINNED_APPS.filter((a) => !isAppDisabled(a.id) && a.label.toLowerCase().includes(q));
  const settingMatches = SETTINGS_SEARCH_INDEX.filter((s) => s.label.toLowerCase().includes(q));
  const fileMatches = await searchFiles(q);
  if (myToken !== searchToken) return; // busca mais recente já chegou primeiro
  renderSearchResults({ appMatches, settingMatches, fileMatches }, rawQuery.trim());
}

let searchDebounceTimer = null;
$('#start-search').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(searchDebounceTimer);
  if (!q) {
    showPinnedApps();
    return;
  }
  $('#start-fixed-label').classList.add('hidden');
  $('#start-pinned').classList.add('hidden');
  $('#start-results').classList.remove('hidden');
  searchDebounceTimer = setTimeout(() => runGlobalSearch(q), 120);
});
$('#start-search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  $('#start-results').querySelector('.search-result-row')?.click();
});

$('#start-user-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  hidePanel($('#power-menu'));
  const menu = $('#account-menu');
  if (menu.classList.contains('hidden')) positionPanelNearButton(menu, e.currentTarget);
  else hidePanel(menu);
});
$('#account-menu').addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.action;
  if (!action) return;
  hidePanel($('#start-menu'));
  if (action === 'lock' || action === 'signout') lockNow();
  if (action === 'switch-user') switchUser();
});

$('#start-power').addEventListener('click', (e) => {
  e.stopPropagation();
  hidePanel($('#account-menu'));
  const menu = $('#power-menu');
  if (menu.classList.contains('hidden')) positionPanelNearButton(menu, e.currentTarget);
  else hidePanel(menu);
});
$('#power-menu').addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.action;
  if (!action) return;
  hidePanel($('#start-menu'));
  if (action === 'sleep') sleepNow();
  if (action === 'restart') restartNow();
  if (action === 'shutdown') shutdownNow();
});

// ---------------- Volume ----------------
function volumeGlyph(vol, muted) {
  if (muted || vol === 0) return '🔇';
  if (vol < 34) return '🔈';
  if (vol < 67) return '🔉';
  return '🔊';
}
async function refreshVolumeUI() {
  const vol = await volumeControl.get();
  const muted = await volumeControl.getMuted();
  $('#volume-slider').value = vol;
  $('#volume-value').textContent = vol;
  const glyph = volumeGlyph(vol, muted);
  $('#tray-volume-btn').textContent = glyph;
  $('#volume-mute-btn').textContent = muted ? '🔇' : '🔊';
}
$('#tray-volume-btn').addEventListener('click', async (e) => {
  e.stopPropagation();
  const btn = e.currentTarget;
  hidePanel($('#account-menu'));
  hidePanel($('#power-menu'));
  await refreshVolumeUI();
  const menu = $('#volume-menu');
  if (menu.classList.contains('hidden')) positionPanelNearButton(menu, btn);
  else hidePanel(menu);
});
$('#volume-slider').addEventListener('input', async (e) => {
  const v = Number(e.target.value);
  await volumeControl.set(v);
  if (v > 0) await volumeControl.setMuted(false);
  await refreshVolumeUI();
});
$('#volume-mute-btn').addEventListener('click', async () => {
  const muted = await volumeControl.getMuted();
  await volumeControl.setMuted(!muted);
  await refreshVolumeUI();
});

// ---------------- Calendário da bandeja ----------------
const CAL_WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const CAL_MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
let calFlyoutMonth = new Date().getMonth();
let calFlyoutYear = new Date().getFullYear();

function renderCalendarFlyout() {
  const today = new Date();
  const panel = $('#calendar-flyout');
  panel.querySelector('[data-role="full-date"]').textContent = today.toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  panel.querySelector('[data-role="month-label"]').textContent = `${CAL_MONTHS[calFlyoutMonth]} ${calFlyoutYear}`;

  const weekdaysEl = panel.querySelector('[data-role="weekdays"]');
  weekdaysEl.innerHTML = CAL_WEEKDAYS.map((w) => `<div class="calendar-weekday">${w}</div>`).join('');

  const daysEl = panel.querySelector('[data-role="days"]');
  daysEl.innerHTML = '';
  const firstDay = new Date(calFlyoutYear, calFlyoutMonth, 1);
  const daysInMonth = new Date(calFlyoutYear, calFlyoutMonth + 1, 0).getDate();
  for (let i = 0; i < firstDay.getDay(); i++) daysEl.appendChild(document.createElement('div'));
  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(calFlyoutYear, calFlyoutMonth, day);
    const cell = document.createElement('div');
    cell.className = 'calendar-day' + (cellDate.toDateString() === today.toDateString() ? ' today' : '');
    cell.textContent = day;
    daysEl.appendChild(cell);
  }
}

$('#tray-clock').addEventListener('click', (e) => {
  e.stopPropagation();
  hidePanel($('#account-menu'));
  hidePanel($('#power-menu'));
  hidePanel($('#volume-menu'));
  const panel = $('#calendar-flyout');
  if (panel.classList.contains('hidden')) {
    calFlyoutMonth = new Date().getMonth();
    calFlyoutYear = new Date().getFullYear();
    renderCalendarFlyout();
    positionPanelNearButton(panel, $('#tray'));
  } else {
    hidePanel(panel);
  }
});
$('#calendar-flyout [data-action="prev-month"]').addEventListener('click', () => {
  calFlyoutMonth--;
  if (calFlyoutMonth < 0) { calFlyoutMonth = 11; calFlyoutYear--; }
  renderCalendarFlyout();
});
$('#calendar-flyout [data-action="next-month"]').addEventListener('click', () => {
  calFlyoutMonth++;
  if (calFlyoutMonth > 11) { calFlyoutMonth = 0; calFlyoutYear++; }
  renderCalendarFlyout();
});
$('#calendar-flyout [data-action="open-clock"]').addEventListener('click', () => {
  hidePanel($('#calendar-flyout'));
  openClock(ctx);
});

// ---------------- Central de notificações ----------------
async function getNotifications() {
  return kv.get('notifications.list', []);
}

/** Registra uma notificação real (nunca decorativa): dispara um toast,
 * soma no histórico da Central de Notificações e toca o som configurado —
 * respeitando o interruptor de Configurações > Sistema. Usado tanto por
 * eventos internos (bateria, armazenamento) quanto por outros apps via
 * ctx.notify(). */
async function pushNotification({ appId = 'system', icon = '🔔', title, body = '' }) {
  const enabled = await kv.get('settings.notificationsEnabled', true);
  if (!enabled || !title) return;
  const list = await getNotifications();
  const item = {
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    appId, icon, title, body,
    time: Date.now(),
  };
  list.unshift(item);
  if (list.length > 50) list.length = 50;
  await kv.set('notifications.list', list);
  showToast(item);
  playNotifyChime();
  await updateNotifBadge();
  if (!$('#notification-center').classList.contains('hidden')) renderNotificationCenter();
}

async function dismissNotification(id) {
  const list = (await getNotifications()).filter((n) => n.id !== id);
  await kv.set('notifications.list', list);
  renderNotificationCenter();
  await updateNotifBadge();
}

async function clearAllNotifications() {
  await kv.set('notifications.list', []);
  renderNotificationCenter();
  await updateNotifBadge();
}

async function updateNotifBadge() {
  const list = await getNotifications();
  $('#tray-notif-btn').classList.toggle('has-unread', list.length > 0);
}

function formatNotifTime(ts) {
  const diffMin = Math.round((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH} h`;
  return new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
}

async function renderNotificationCenter() {
  const list = await getNotifications();
  const holder = $('#notification-center [data-role="notif-list"]');
  holder.innerHTML = '';
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'notification-empty';
    empty.textContent = 'Sem novidades no momento.';
    holder.appendChild(empty);
    return;
  }
  list.forEach((n) => {
    const item = document.createElement('div');
    item.className = 'notification-item';
    item.innerHTML = `<span class="glyph">${n.icon}</span>`;
    const text = document.createElement('div');
    text.className = 'notification-item-text';
    const strong = document.createElement('strong');
    strong.textContent = n.title;
    text.appendChild(strong);
    if (n.body) {
      const p = document.createElement('p');
      p.textContent = n.body;
      text.appendChild(p);
    }
    const time = document.createElement('time');
    time.textContent = formatNotifTime(n.time);
    text.appendChild(time);
    item.appendChild(text);
    const dismiss = document.createElement('button');
    dismiss.className = 'notification-dismiss';
    dismiss.textContent = '✕';
    dismiss.title = 'Dispensar';
    dismiss.setAttribute('aria-label', 'Dispensar notificação');
    dismiss.addEventListener('click', () => dismissNotification(n.id));
    item.appendChild(dismiss);
    holder.appendChild(item);
  });
}

function showToast(item) {
  const stack = $('#toast-stack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-icon">${item.icon}</span>`;
  const text = document.createElement('div');
  text.className = 'toast-text';
  const strong = document.createElement('strong');
  strong.textContent = item.title;
  text.appendChild(strong);
  if (item.body) {
    const span = document.createElement('span');
    span.textContent = item.body;
    text.appendChild(span);
  }
  el.appendChild(text);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Fechar';
  closeBtn.setAttribute('aria-label', 'Fechar notificação');
  el.appendChild(closeBtn);
  stack.appendChild(el);
  motion.panelOpen(el);
  let dismissed = false;
  const remove = () => {
    if (dismissed) return;
    dismissed = true;
    motion.panelClose(el).then(() => el.remove());
  };
  closeBtn.addEventListener('click', remove);
  setTimeout(remove, 6000);
}

$('#tray-notif-btn').addEventListener('click', async (e) => {
  e.stopPropagation();
  hidePanel($('#account-menu'));
  hidePanel($('#power-menu'));
  hidePanel($('#volume-menu'));
  hidePanel($('#calendar-flyout'));
  const panel = $('#notification-center');
  if (panel.classList.contains('hidden')) {
    await renderNotificationCenter();
    positionPanelNearButton(panel, $('#tray-notif-btn'));
    // Ao abrir a Central, as notificações são consideradas vistas — o
    // indicador some, como no Windows.
    $('#tray-notif-btn').classList.remove('has-unread');
  } else {
    hidePanel(panel);
  }
});
$('#notification-center [data-action="clear-all"]').addEventListener('click', () => clearAllNotifications());

// ---------------- Task View (áreas de trabalho virtuais) ----------------
function renderTaskView() {
  const container = $('#task-view-desktops');
  container.innerHTML = '';
  const desktops = WM.listDesktops();
  desktops.forEach((d) => {
    const card = document.createElement('div');
    card.className = 'task-view-card' + (d.active ? ' active' : '');

    const thumb = document.createElement('button');
    thumb.className = 'task-view-thumb';
    thumb.setAttribute('aria-label', `Ir para ${d.name}`);
    thumb.textContent = d.windowCount
      ? `${d.windowCount} janela${d.windowCount > 1 ? 's' : ''} aberta${d.windowCount > 1 ? 's' : ''}`
      : 'Nenhuma janela aberta';
    thumb.addEventListener('click', (e) => {
      e.stopPropagation();
      WM.setActiveDesktop(d.id);
      hidePanel($('#task-view'));
      renderTaskbarApps();
    });

    const label = document.createElement('button');
    label.className = 'task-view-label';
    label.textContent = d.name;
    label.title = 'Clique para renomear';
    label.setAttribute('aria-label', `Renomear ${d.name}`);
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = prompt('Nome da área de trabalho:', d.name);
      if (name && name.trim()) {
        WM.renameDesktop(d.id, name.trim());
        renderTaskView();
      }
    });

    card.appendChild(thumb);
    card.appendChild(label);

    if (desktops.length > 1) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'task-view-close';
      closeBtn.setAttribute('aria-label', `Fechar ${d.name}`);
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        WM.removeDesktop(d.id);
        renderTaskView();
        renderTaskbarApps();
      });
      card.appendChild(closeBtn);
    }

    container.appendChild(card);
  });

  const addCard = document.createElement('button');
  addCard.className = 'task-view-add';
  addCard.textContent = '+ Nova área de trabalho';
  addCard.addEventListener('click', (e) => {
    e.stopPropagation();
    WM.addDesktop();
    renderTaskView();
  });
  container.appendChild(addCard);
}

$('#task-view-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  hidePanel($('#start-menu'));
  hidePanel($('#power-menu'));
  hidePanel($('#account-menu'));
  hidePanel($('#notification-center'));
  const panel = $('#task-view');
  if (panel.classList.contains('hidden')) {
    renderTaskView();
    showPanel(panel);
  } else {
    hidePanel(panel);
  }
});
$('#task-view').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hidePanel($('#task-view'));
});

// Traz para frente (ou minimiza, se já estiver em foco) a janela mais
// recente de um app — usado tanto pelos ícones fixos da barra de tarefas
// quanto pelos temporários, para que um app aberto NUNCA ganhe um ícone
// duplicado ao lado do seu: o mesmo ícone é reutilizado, só muda de estado.
function focusOrToggleApp(appId) {
  const windows = WM.listProcesses().filter((w) => w.appId === appId && w.desktopId === WM.getActiveDesktopId());
  if (!windows.length) return false;
  const focused = windows.find((w) => w.focused);
  if (focused) {
    WM.toggleMinimize(focused.id);
  } else {
    // Nenhuma janela deste app está em foco (pode estar minimizada ou só
    // atrás de outra) — toggleMinimize já sabe restaurar com a animação
    // correta e focar em seguida, então reaproveita essa lógica em vez de
    // chamar focusById direto (que pularia a animação e deixaria a janela
    // com opacidade travada em 0 quando ela estava minimizada).
    const mostRecent = windows.reduce((a, b) => (b.openedAt > a.openedAt ? b : a));
    WM.toggleMinimize(mostRecent.id);
  }
  return true;
}

const DEFAULT_PINNED_TASKBAR = ['explorer', 'browser', 'notepad', 'settings'];
async function getPinnedTaskbarApps() {
  return kv.get('taskbar.pinned', DEFAULT_PINNED_TASKBAR);
}
async function setPinnedTaskbarApps(list) {
  await kv.set('taskbar.pinned', list);
}

// Menu de contexto (botão direito) de um ícone da barra de tarefas: nunca
// abre outra coisa além de opções reais para manipular aquele ícone — fixar/
// desafixar da barra de tarefas e fechar a(s) janela(s) do app, como no
// Windows 11.
function showTaskbarItemMenu(x, y, appId, appWindows, isPinned) {
  const items = [];
  if (appWindows.length) {
    items.push({
      label: appWindows.length > 1 ? `✕ Fechar todas as janelas (${appWindows.length})` : '✕ Fechar janela',
      onClick: () => appWindows.forEach((w) => WM.closeWindow(w.id)),
    });
  }
  items.push({
    label: isPinned ? '📌 Desafixar da barra de tarefas' : '📌 Fixar na barra de tarefas',
    onClick: async () => {
      const pinned = await getPinnedTaskbarApps();
      const next = isPinned ? pinned.filter((id) => id !== appId) : [...pinned, appId];
      await setPinnedTaskbarApps(next);
      renderTaskbarApps();
    },
  });
  showContextMenu(x, y, items);
}

function buildTaskbarAppButton(app, appWindows, isPinned) {
  const btn = document.createElement('button');
  btn.className = 'taskbar-btn' + (appWindows.length ? ' running' : '') + (appWindows.some((w) => w.focused) ? ' active' : '');
  btn.dataset.app = app.id;
  btn.title = appWindows.length > 1 ? `${app.label} (+${appWindows.length - 1})` : app.label;
  btn.setAttribute('aria-label', app.label);
  WM.setGlyph(btn, app.glyph);
  btn.addEventListener('click', () => {
    if (focusOrToggleApp(app.id)) return;
    app.onOpen?.();
  });
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showTaskbarItemMenu(e.clientX, e.clientY, app.id, appWindows, isPinned);
  });
  return btn;
}

async function renderTaskbarApps() {
  const pinned = await getPinnedTaskbarApps();
  const byApp = new Map();
  const activeDesktopId = WM.getActiveDesktopId();
  WM.listProcesses().filter((w) => w.desktopId === activeDesktopId).forEach((w) => {
    if (!byApp.has(w.appId)) byApp.set(w.appId, []);
    byApp.get(w.appId).push(w);
  });

  const holder = $('#taskbar-apps');
  holder.innerHTML = '';

  pinned.forEach((appId) => {
    const app = PINNED_APPS.find((a) => a.id === appId);
    if (!app || isAppDisabled(appId)) return;
    holder.appendChild(buildTaskbarAppButton(app, byApp.get(appId) || [], true));
    byApp.delete(appId);
  });

  // Apps sem ícone fixo (Calculadora, Relógio, Terminal, Gerenciador de
  // Tarefas...) ganham um ícone temporário só enquanto estiverem abertos —
  // um por app, mesmo que existam várias janelas dele — e some ao fechar.
  byApp.forEach((appWindows, appId) => {
    const app = PINNED_APPS.find((a) => a.id === appId);
    if (!app) return;
    holder.appendChild(buildTaskbarAppButton(app, appWindows, false));
  });
}

WM.onWindowsChange(() => renderTaskbarApps());

function isStandaloneDisplay() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  );
}

async function applyDisplayPreferences() {
  if (!isStandaloneDisplay()) return;
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Alguns navegadores só permitem tela cheia após um gesto do usuário —
      // por isso tentamos de novo no primeiro toque, logo abaixo.
    }
  }
  const orientation = await kv.get('settings.orientation', 'landscape');
  if (orientation !== 'auto' && screen.orientation?.lock) {
    screen.orientation.lock(orientation).catch(() => {});
  }
}

applyDisplayPreferences();
window.addEventListener('pointerdown', () => applyDisplayPreferences(), { once: true });

// Reflui os ícones da área de trabalho quando a tela muda de tamanho ou
// gira (ex.: celular na horizontal) — sem isso, um layout calculado pra um
// tamanho de tela fica desalinhado ou com ícones fora da área visível
// depois de uma rotação/redimensionamento.
let resizeReflowTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeReflowTimer);
  resizeReflowTimer = setTimeout(() => renderDesktopIcons(), 200);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

// ---------------- Bloqueio de abas duplicadas ----------------
// Só uma aba deste "sistema operacional" pode ficar ativa por vez — evita
// duas sessões brigando pela mesma chave de criptografia em memória,
// notificações duplicadas etc. Usa BroadcastChannel (mensageria ao vivo
// entre abas da mesma origem) em vez de localStorage com heartbeat: se a
// aba primária fechar, ela simplesmente para de responder — sem precisar
// expirar nada.
const TAB_LOCK_CHANNEL = 'win11-web-tab-lock';
const myTabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let isPrimaryTab = false;
const tabChannel = ('BroadcastChannel' in window) ? new BroadcastChannel(TAB_LOCK_CHANNEL) : null;

function initTabLock() {
  return new Promise((resolve) => {
    if (!tabChannel) { isPrimaryTab = true; resolve(true); return; }
    let settled = false;
    let sawCompetingClaim = false;
    tabChannel.addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'ping' && isPrimaryTab) tabChannel.postMessage({ type: 'pong' });
      if (msg.type === 'pong' && !settled) { settled = true; resolve(false); }
      // Empate: outra aba também não viu ninguém e está se anunciando como
      // primária ao mesmo tempo (duas abas abertas juntas, ex.: "Duplicar
      // aba") — quem tiver o id "menor" nessa comparação (arbitrária, mas
      // determinística e igual nas duas pontas) vence, a outra recua.
      if (msg.type === 'claim' && !isPrimaryTab && msg.id !== myTabId && msg.id < myTabId) {
        sawCompetingClaim = true;
      }
    });
    tabChannel.postMessage({ type: 'ping' });
    // Mensagens entre abas da mesma origem via BroadcastChannel chegam em
    // poucos milissegundos — essa espera só existe pra dar tempo de uma
    // resposta chegar, não precisa ser longa (e ela atrasa o boot de TODA
    // abertura do app, mesmo quando não há nenhuma outra aba).
    setTimeout(() => {
      if (settled) return;
      tabChannel.postMessage({ type: 'claim', id: myTabId });
      setTimeout(() => {
        if (settled) return;
        settled = true;
        if (sawCompetingClaim) { resolve(false); return; }
        isPrimaryTab = true;
        resolve(true);
      }, 60);
    }, 120);
  });
}

function showDuplicateTabScreen() {
  hide($('#boot-screen'));
  show($('#duplicate-tab-screen'));
  let seconds = 5;
  const countEl = $('#duplicate-tab-count');
  const timer = setInterval(() => {
    seconds -= 1;
    if (seconds <= 0) {
      clearInterval(timer);
      countEl.textContent = '0';
      window.close();
      // Navegadores só deixam um script fechar abas abertas por ele mesmo
      // (via window.open) — uma aba digitada/duplicada/em link normal não
      // fecha assim, e window.close() falha em silêncio. Se depois de um
      // instante a aba continuar aqui, avisa em vez de deixar a contagem
      // zerada sem explicação nenhuma.
      setTimeout(() => show($('#duplicate-tab-fallback')), 400);
      return;
    }
    countEl.textContent = String(seconds);
  }, 1000);
}

initTabLock().then((primary) => {
  if (primary) {
    initTaskSwitcher();
    boot();
  } else {
    showDuplicateTabScreen();
  }
});
