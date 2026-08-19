'use strict';

/**
 * Fonte única de status do host, persistida em disco. Existe para que o
 * host nativo (native-messaging-host, chamado pela extensão do Chrome)
 * consiga saber "tem sessão rodando? qual o código?" sem duplicar a lógica
 * de WebRTC/sinalização — ele só lê este arquivo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.cs-remote-desktop');
const STATUS_FILE = path.join(DIR, 'status.json');
const PID_FILE = path.join(DIR, 'host.pid');

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

function writeStatus(partial) {
  ensureDir();
  const current = readStatus();
  const next = { ...current, ...partial, updatedAt: Date.now() };
  // escrita atômica (tmp + rename) pra evitar leitura de arquivo truncado
  const tmp = `${STATUS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, STATUS_FILE);
  return next;
}

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch {
    return { running: false, code: null, connected: false };
  }
}

function writePid() {
  ensureDir();
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function clearPid() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* já não existe, tudo bem */
  }
}

module.exports = { writeStatus, readStatus, writePid, clearPid, STATUS_FILE, PID_FILE, DIR };
