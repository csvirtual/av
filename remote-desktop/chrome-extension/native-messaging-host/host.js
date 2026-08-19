#!/usr/bin/env node
'use strict';

/**
 * Native Messaging Host do cs-remote-desktop.
 *
 * O Chrome inicia este processo (via stdio) quando a extensão chama
 * chrome.runtime.connectNative(). É a ÚNICA forma de uma extensão Chrome
 * abrir/gerenciar um programa de verdade no sistema operacional — o
 * protocolo é: cada mensagem JSON é precedida por 4 bytes (uint32 little
 * endian) com o tamanho em bytes da mensagem.
 *
 * Comandos aceitos (vindos da extensão):
 *   { cmd: 'status' } -> devolve o status atual do host-agent (lido de
 *                        ~/.cs-remote-desktop/status.json)
 *   { cmd: 'start' }  -> inicia o host-agent (Electron app) se não estiver
 *                        rodando
 *   { cmd: 'stop' }   -> encerra o host-agent
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIR = path.join(os.homedir(), '.cs-remote-desktop');
const STATUS_FILE = path.join(DIR, 'status.json');
const PID_FILE = path.join(DIR, 'host.pid');
const LAUNCH_CONFIG_FILE = path.join(DIR, 'launch-config.json');

function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getStatus() {
  const status = readJsonSafe(STATUS_FILE, { running: false, code: null, connected: false });
  let pid = null;
  try {
    pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim() || 0) || null;
  } catch {
    pid = null; // host-agent nunca rodou nesta máquina ainda
  }
  const alive = isPidAlive(pid);
  return { ...status, running: alive, pid: alive ? pid : null };
}

function getLaunchConfig() {
  // Escrito pelo instalador (install-*.sh/.ps1). Em dev, cai no fallback
  // abaixo (assume que host-agent/ está ao lado deste diretório).
  return readJsonSafe(LAUNCH_CONFIG_FILE, {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['electron', '.'],
    cwd: path.resolve(__dirname, '..', '..', 'host-agent'),
  });
}

function startHost() {
  const status = getStatus();
  if (status.running) return { ok: true, alreadyRunning: true };

  const { command, args, cwd } = getLaunchConfig();
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return { ok: true, alreadyRunning: false, pid: child.pid };
}

function stopHost() {
  const status = getStatus();
  if (!status.running || !status.pid) return { ok: true, wasRunning: false };
  try {
    process.kill(status.pid, process.platform === 'win32' ? undefined : 'SIGTERM');
  } catch {
    /* processo já pode ter morrido entre a checagem e o kill */
  }
  return { ok: true, wasRunning: true };
}

// --- protocolo stdio do Native Messaging ---

function sendMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (buffer.length < 4 + len) break;
    const payload = buffer.subarray(4, 4 + len);
    buffer = buffer.subarray(4 + len);
    handleMessage(payload);
  }
});

function handleMessage(payload) {
  let msg;
  try {
    msg = JSON.parse(payload.toString('utf8'));
  } catch {
    return sendMessage({ ok: false, error: 'bad-json' });
  }
  switch (msg.cmd) {
    case 'status':
      return sendMessage({ ok: true, status: getStatus() });
    case 'start':
      return sendMessage({ ok: true, result: startHost() });
    case 'stop':
      return sendMessage({ ok: true, result: stopHost() });
    default:
      return sendMessage({ ok: false, error: 'unknown-cmd' });
  }
}

process.stdin.on('end', () => process.exit(0));
