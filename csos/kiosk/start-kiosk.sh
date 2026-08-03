#!/bin/sh
# Sobe o Chromium em modo kiosk apontado pro app local (servido por
# csos-webserver.service em 127.0.0.1) — chamado pelo .xinitrc do usuário
# de kiosk, dentro da sessão X que o startx (disparado no autologin da
# tty1) já deixou rodando. Sem gerenciador de janelas: --kiosk já cobre a
# tela inteira sozinho, então não precisamos de mais nenhuma peça no meio.
set -eu

PORT="${CSOS_PORT:-8973}"
URL="http://127.0.0.1:${PORT}/desktop/index.html"

# Nomes do binário variam entre distros (Debian/Ubuntu costuma empacotar
# como "chromium", outras como "chromium-browser"; entra "google-chrome"
# como alternativa caso a máquina já tenha o Chrome em vez do Chromium).
find_browser() {
  for bin in chromium chromium-browser google-chrome google-chrome-stable; do
    if command -v "$bin" >/dev/null 2>&1; then
      echo "$bin"
      return 0
    fi
  done
  return 1
}

BROWSER_BIN="$(find_browser)" || {
  echo "start-kiosk.sh: nenhum Chromium/Chrome encontrado no PATH." >&2
  exit 1
}

# Não abre em tela preta enquanto o serviço local ainda está subindo logo
# depois do boot — espera até 30s pelo servidor responder antes de abrir o
# navegador.
i=0
while ! curl -fsS -o /dev/null "$URL" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "start-kiosk.sh: csos-webserver não respondeu em ${URL} após 30s, abrindo mesmo assim." >&2
    break
  fi
  sleep 1
done

xset -dpms
xset s off
xset s noblank

exec "$BROWSER_BIN" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --incognito \
  --no-first-run \
  --disable-translate \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  "$URL"
