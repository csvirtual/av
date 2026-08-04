#!/bin/bash
# Desfaz tudo que install.sh fez, restaurando os backups criados por ele.
# Não apaga $APP_DIR por padrão (pode conter dados que a pessoa queira
# manter) — passe REMOVE_APP_DIR=1 se quiser apagar também.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-/opt/csos-app}"
BACKUP_ROOT="/var/lib/csos-backup"

log() { printf '[csos-uninstall] %s\n' "$1"; }
die() { printf '[csos-uninstall] ERRO: %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "precisa rodar como root (sudo)."

# Sem APP_USER explícito, usa o usuário que o install.sh registrou da
# última vez — assim "sudo ./uninstall.sh" sem variável nenhuma já desfaz
# a instalação certa na maioria dos casos.
if [ -z "${APP_USER:-}" ] && [ -e "$BACKUP_ROOT/app_user" ]; then
  APP_USER="$(cat "$BACKUP_ROOT/app_user")"
fi
APP_USER="${APP_USER:-${SUDO_USER:-}}"
[ -n "$APP_USER" ] || die "defina APP_USER=usuario (o mesmo usado no install.sh)."

APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6 || true)"

# ---------------------------------------------------------------------
# 1. Serviço do servidor local
# ---------------------------------------------------------------------
if systemctl list-unit-files csos-webserver.service >/dev/null 2>&1; then
  log "removendo csos-webserver.service..."
  systemctl disable --now csos-webserver.service 2>/dev/null || true
  rm -f /etc/systemd/system/csos-webserver.service
  systemctl daemon-reload
fi

# ---------------------------------------------------------------------
# 2. Autologin
# ---------------------------------------------------------------------
if [ -e /etc/systemd/system/getty@tty1.service.d/csos-autologin.conf ]; then
  log "removendo autologin da tty1..."
  rm -f /etc/systemd/system/getty@tty1.service.d/csos-autologin.conf
  systemctl daemon-reload
fi

# ---------------------------------------------------------------------
# 3. /etc/os-release original
# ---------------------------------------------------------------------
if [ -e "$BACKUP_ROOT/os-release.orig" ]; then
  log "restaurando /etc/os-release original..."
  cp -a "$BACKUP_ROOT/os-release.orig" /etc/os-release
fi

# ---------------------------------------------------------------------
# 4. .xinitrc do usuário
# ---------------------------------------------------------------------
if [ -n "$APP_HOME" ] && [ -d "$APP_HOME" ]; then
  if [ -e "$BACKUP_ROOT/xinitrc.orig" ]; then
    log "restaurando .xinitrc original de '$APP_USER'..."
    cp -a "$BACKUP_ROOT/xinitrc.orig" "$APP_HOME/.xinitrc"
    chown "$APP_USER":"$APP_USER" "$APP_HOME/.xinitrc"
  elif [ -e "$APP_HOME/.xinitrc" ]; then
    log "removendo .xinitrc do C&S OS (não havia um original antes)..."
    rm -f "$APP_HOME/.xinitrc"
  fi

  # ---------------------------------------------------------------------
  # 5. Bloco de autostart no .bash_profile
  # ---------------------------------------------------------------------
  PROFILE="$APP_HOME/.bash_profile"
  MARK_BEGIN="# >>> C&S OS kiosk autostart >>>"
  MARK_END="# <<< C&S OS kiosk autostart <<<"
  if [ -e "$PROFILE" ] && grep -qF "$MARK_BEGIN" "$PROFILE"; then
    log "removendo bloco de autostart de $PROFILE..."
    sed -i "/^${MARK_BEGIN}\$/,/^${MARK_END}\$/d" "$PROFILE"
  fi
fi

# ---------------------------------------------------------------------
# 6. App copiado (opcional)
# ---------------------------------------------------------------------
if [ "${REMOVE_APP_DIR:-0}" = "1" ] && [ -d "$APP_DIR" ]; then
  log "removendo $APP_DIR (REMOVE_APP_DIR=1)..."
  rm -rf "$APP_DIR"
else
  log "mantendo $APP_DIR (passe REMOVE_APP_DIR=1 pra remover também)."
fi

rm -f "$BACKUP_ROOT/app_user"

log "Pronto. Reinicie a máquina pra voltar ao login normal."
