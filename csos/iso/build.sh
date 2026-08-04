#!/bin/bash
# Gera o .iso instalável do C&S OS (Debian Live 12 "bookworm", leve —
# sem o Debian Installer oficial, usa o csos-install-to-disk próprio) a
# partir deste repositório. Ver README.md desta pasta antes de rodar.
#
# Precisa de uma máquina Debian/Ubuntu de verdade com privilégio de root
# de fato (chroot/mount/loopback) e o pacote live-build instalado — não
# roda dentro de containers sandboxed.
#
# Uso: sudo ./build.sh
#      sudo APP_USER=csos PORT=8973 ./build.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

APP_USER="${APP_USER:-csos}"
PORT="${PORT:-8973}"

log() { printf '[csos-iso] %s\n' "$1"; }
die() { printf '[csos-iso] ERRO: %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "precisa rodar como root (sudo) — live-build precisa montar/chroot."
command -v lb >/dev/null 2>&1 || die "live-build não encontrado. Instale com: apt install live-build"
command -v rsync >/dev/null 2>&1 || die "rsync não encontrado. Instale com: apt install rsync"

cd "$SCRIPT_DIR"

# ---------------------------------------------------------------------
# 1. Conteúdo do app dentro da imagem
# ---------------------------------------------------------------------
APP_TARGET="config/includes.chroot/opt/csos-app"
log "copiando o app do repositório pra $APP_TARGET..."
rm -rf "$APP_TARGET"
mkdir -p "$APP_TARGET"
rsync -a --delete \
  --exclude='.git' --exclude='.claude' --exclude='av-main.zip' --exclude='csos/iso' \
  "$REPO_ROOT/" "$APP_TARGET/"
chmod +x "$APP_TARGET/csos/kiosk/start-kiosk.sh" "$APP_TARGET/csos/kiosk/xinitrc"

# ---------------------------------------------------------------------
# 2. systemd unit com os placeholders preenchidos
# ---------------------------------------------------------------------
log "gerando csos-webserver.service (usuário=$APP_USER, porta=$PORT)..."
mkdir -p config/includes.chroot/etc/systemd/system
sed -e "s#__CSOS_APP_DIR__#/opt/csos-app#g" -e "s#__CSOS_PORT__#$PORT#g" -e "s#__CSOS_USER__#$APP_USER#g" \
  "$REPO_ROOT/csos/systemd/csos-webserver.service" > config/includes.chroot/etc/systemd/system/csos-webserver.service

# ---------------------------------------------------------------------
# 3. Hook de build (roda dentro do chroot, uma vez, durante lb build)
# ---------------------------------------------------------------------
log "gerando hook de setup (0100-csos-setup.hook.chroot)..."
mkdir -p config/hooks/live
sed -e "s#__CSOS_USER__#$APP_USER#g" \
  "$SCRIPT_DIR/hooks-src/0100-csos-setup.hook.chroot.in" > config/hooks/live/0100-csos-setup.hook.chroot
chmod +x config/hooks/live/0100-csos-setup.hook.chroot

# ---------------------------------------------------------------------
# 4. lb config — Debian 12 bookworm, amd64, iso híbrido, SEM o Debian
#    Installer oficial (--debian-installer não é passado; default é
#    "none"). Instalar no disco é feito depois, de dentro da própria
#    sessão live, com csos-install-to-disk — mais leve e mais rápido de
#    gerar do que embutir o instalador completo do Debian.
# ---------------------------------------------------------------------
log "rodando lb config (bookworm, amd64, live, sem debian-installer)..."
lb config \
  --distribution bookworm \
  --architectures amd64 \
  --binary-images iso-hybrid \
  --archive-areas "main contrib non-free non-free-firmware" \
  --iso-application "C&S OS" \
  --iso-publisher "csvirtual/av" \
  --iso-volume "C&S OS 1.0"

# ---------------------------------------------------------------------
# 5. Build de verdade — baixa e monta um Debian inteiro, demora.
# ---------------------------------------------------------------------
log "rodando lb build (baixa o repositório Debian inteiro na 1a vez — demora)..."
lb build

ISO="$(ls "$SCRIPT_DIR"/*.iso 2>/dev/null | head -1)"
if [ -n "$ISO" ]; then
  log "pronto: $ISO"
else
  die "lb build terminou mas nenhum .iso foi encontrado em $SCRIPT_DIR — confira o log acima."
fi
