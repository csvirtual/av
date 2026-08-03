#!/bin/bash
# C&S OS — provisiona uma máquina Debian/Ubuntu já instalada como um
# aparelho de único propósito que liga direto em tela cheia no Chromium,
# mostrando o "Windows 11 Web Desktop" deste repositório. Ver README.md
# desta pasta pra entender o que isto é (e o que NÃO é — não gera .iso).
#
# Uso: sudo APP_USER=usuario ./install.sh
# Se APP_USER não for informado, usa $SUDO_USER.
#
# Idempotente: rodar de novo não duplica configuração nem perde backups já
# feitos. Reversível: uninstall.sh desfaz tudo usando os backups criados
# aqui.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_USER="${APP_USER:-${SUDO_USER:-}}"
APP_DIR="${APP_DIR:-/opt/csos-app}"
PORT="${PORT:-8973}"
BACKUP_ROOT="/var/lib/csos-backup"

log() { printf '[csos-install] %s\n' "$1"; }
die() { printf '[csos-install] ERRO: %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "precisa rodar como root (sudo)."
[ -n "$APP_USER" ] || die "defina APP_USER=usuario (ou rode via sudo a partir desse usuário)."
id "$APP_USER" >/dev/null 2>&1 || die "usuário '$APP_USER' não existe nesta máquina."
command -v systemctl >/dev/null 2>&1 || die "este script espera systemd (systemctl não encontrado)."

APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
[ -n "$APP_HOME" ] && [ -d "$APP_HOME" ] || die "não encontrei o diretório home de '$APP_USER'."

mkdir -p "$BACKUP_ROOT"

log "usuário do kiosk: $APP_USER (home: $APP_HOME)"
log "diretório do app: $APP_DIR"
log "porta local: $PORT"

# ---------------------------------------------------------------------
# 1. Pacotes
# ---------------------------------------------------------------------
if command -v apt-get >/dev/null 2>&1; then
  log "instalando pacotes (xserver-xorg, xinit, chromium, python3, curl)..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  # "chromium" é o pacote certo em quase todo Debian/Ubuntu moderno; se não
  # existir, cai pro nome antigo usado por versões mais velhas do Ubuntu.
  if apt-cache show chromium >/dev/null 2>&1; then
    CHROMIUM_PKG=chromium
  else
    CHROMIUM_PKG=chromium-browser
  fi
  apt-get install -y -qq xserver-xorg xinit "$CHROMIUM_PKG" python3 curl x11-xserver-utils
else
  log "aviso: apt-get não encontrado — pulando instalação de pacotes (garanta que xserver-xorg, xinit, chromium, python3 e curl já estejam instalados)."
fi

# ---------------------------------------------------------------------
# 2. Copia o app pra $APP_DIR (tudo do repo, exceto .git)
# ---------------------------------------------------------------------
log "copiando o app pra $APP_DIR..."
mkdir -p "$APP_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude='.git' --exclude='.claude' --exclude='av-main.zip' "$REPO_ROOT/" "$APP_DIR/"
else
  find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
  cp -a "$REPO_ROOT/." "$APP_DIR/"
  rm -rf "${APP_DIR:?}/.git" "$APP_DIR/.claude" "$APP_DIR/av-main.zip"
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod +x "$APP_DIR/csos/kiosk/start-kiosk.sh" "$APP_DIR/csos/kiosk/xinitrc"

# ---------------------------------------------------------------------
# 3. systemd: servidor estático local
# ---------------------------------------------------------------------
log "instalando csos-webserver.service..."
sed -e "s#__CSOS_APP_DIR__#$APP_DIR#g" -e "s#__CSOS_PORT__#$PORT#g" -e "s#__CSOS_USER__#$APP_USER#g" \
  "$SCRIPT_DIR/systemd/csos-webserver.service" > /etc/systemd/system/csos-webserver.service
systemctl daemon-reload
systemctl enable --now csos-webserver.service

# ---------------------------------------------------------------------
# 4. /etc/os-release — backup só na primeira vez
# ---------------------------------------------------------------------
if [ ! -e "$BACKUP_ROOT/os-release.orig" ]; then
  log "fazendo backup de /etc/os-release original..."
  cp -a /etc/os-release "$BACKUP_ROOT/os-release.orig"
fi
log "aplicando branding do C&S OS em /etc/os-release..."
cp "$SCRIPT_DIR/branding/os-release" /etc/os-release

# ---------------------------------------------------------------------
# 5. Autologin na tty1
# ---------------------------------------------------------------------
log "configurando autologin de '$APP_USER' na tty1..."
mkdir -p /etc/systemd/system/getty@tty1.service.d
sed -e "s#__CSOS_USER__#$APP_USER#g" \
  "$SCRIPT_DIR/config/autologin.conf.template" > /etc/systemd/system/getty@tty1.service.d/csos-autologin.conf
systemctl daemon-reload

# ---------------------------------------------------------------------
# 6. .xinitrc do usuário — backup só na primeira vez, se já existia algo
# ---------------------------------------------------------------------
XINITRC="$APP_HOME/.xinitrc"
if [ -e "$XINITRC" ] && [ ! -e "$BACKUP_ROOT/xinitrc.orig" ]; then
  log "fazendo backup do .xinitrc existente de '$APP_USER'..."
  cp -a "$XINITRC" "$BACKUP_ROOT/xinitrc.orig"
fi
sed -e "s#__CSOS_APP_DIR__#$APP_DIR#g" "$SCRIPT_DIR/kiosk/xinitrc" > "$XINITRC"
chmod +x "$XINITRC"
chown "$APP_USER":"$APP_USER" "$XINITRC"

# ---------------------------------------------------------------------
# 7. Autostart do X ao logar na tty1 — bloco marcado (sem precisar de
#    backup do arquivo inteiro: basta remover o bloco na desinstalação).
# ---------------------------------------------------------------------
PROFILE="$APP_HOME/.bash_profile"
MARK_BEGIN="# >>> C&S OS kiosk autostart >>>"
MARK_END="# <<< C&S OS kiosk autostart <<<"
touch "$PROFILE"
if ! grep -qF "$MARK_BEGIN" "$PROFILE"; then
  log "adicionando autostart do X ao $PROFILE..."
  {
    echo "$MARK_BEGIN"
    echo '# Sobe o Chromium em modo kiosk automaticamente ao logar na tty1 —'
    echo '# não faz nada em outras ttys nem numa sessão SSH, pra não travar'
    echo '# quem entrar remotamente.'
    echo 'if [ -z "${DISPLAY:-}" ] && [ "$(tty)" = "/dev/tty1" ]; then'
    echo '  exec startx -- -nocursor'
    echo 'fi'
    echo "$MARK_END"
  } >> "$PROFILE"
else
  log "autostart do X já presente em $PROFILE — nada a fazer."
fi
chown "$APP_USER":"$APP_USER" "$PROFILE"

log ""
log "Pronto. Reinicie a máquina (systemctl reboot) — ela deve logar sozinha"
log "na tty1 como '$APP_USER' e abrir o C&S OS em tela cheia."
log "Pra desfazer tudo: sudo ./uninstall.sh"
