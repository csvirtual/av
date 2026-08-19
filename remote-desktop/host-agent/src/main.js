'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer, screen, nativeImage } = require('electron');
const path = require('path');
const inputController = require('./input-controller');
const config = require('./config');
const statusStore = require('./status-store');

// Só uma instância do host por vez.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let isSharing = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    title: 'CS Remote Desktop — Host',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload usa require() de módulos locais (config); mantém IPC como única ponte de privilégio
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide(); // fecha pro tray em vez de encerrar o compartilhamento
    }
  });
}

function createTray() {
  const icon = nativeImage.createEmpty(); // substitua por um ícone real em produção (ver README)
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('CS Remote Desktop — Host');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Abrir painel',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => mainWindow.show());
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  statusStore.writePid();
  statusStore.writeStatus({ running: true, code: null, connected: false });

  const primary = screen.getPrimaryDisplay();
  inputController.setScreenSize(primary.size.width, primary.size.height);

  // Se a resolução mudar (ex: monitor externo conectado), atualiza o mapeamento.
  screen.on('display-metrics-changed', () => {
    const d = screen.getPrimaryDisplay();
    inputController.setScreenSize(d.size.width, d.size.height);
  });
});

app.on('window-all-closed', () => {
  // Mantém rodando em background (tray) mesmo com a janela fechada,
  // como um serviço de acesso remoto de verdade.
});

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// --- IPC: ponte controlada entre a renderer (sandboxed) e o SO ---

ipcMain.handle('get-config', () => ({
  signalingUrl: config.SIGNALING_URL,
  iceServers: config.ICE_SERVERS,
}));

ipcMain.handle('get-screen-source', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const primaryId = screen.getPrimaryDisplay().id;
  const match = sources.find((s) => String(s.display_id) === String(primaryId)) || sources[0];
  if (!match) throw new Error('Nenhuma tela disponível para captura.');
  return { id: match.id, name: match.name };
});

ipcMain.handle('inject-input', async (_evt, inputEvent) => {
  if (!isSharing) return; // só injeta input enquanto há sessão ativa de propósito
  await inputController.inject(inputEvent);
});

ipcMain.handle('set-sharing-state', (_evt, sharing) => {
  isSharing = !!sharing;
  if (tray) tray.setToolTip(isSharing ? 'CS Remote Desktop — Compartilhando' : 'CS Remote Desktop — Host');
  statusStore.writeStatus({ connected: isSharing });
});

ipcMain.handle('update-status', (_evt, partial) => {
  statusStore.writeStatus(partial);
});

app.on('before-quit', () => {
  statusStore.clearPid();
  statusStore.writeStatus({ running: false, code: null, connected: false });
});
