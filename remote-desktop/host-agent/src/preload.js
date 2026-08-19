'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Única superfície exposta à renderer (que roda a UI + WebRTC). Tudo que
// toca o SO (input, captura de tela, config) passa por aqui, nunca por
// acesso direto a módulos Node na renderer.
contextBridge.exposeInMainWorld('hostAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getScreenSource: () => ipcRenderer.invoke('get-screen-source'),
  injectInput: (event) => ipcRenderer.invoke('inject-input', event),
  setSharingState: (sharing) => ipcRenderer.invoke('set-sharing-state', sharing),
  updateStatus: (partial) => ipcRenderer.invoke('update-status', partial),
});
