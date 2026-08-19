#!/bin/sh
# Registra o native messaging host no Chrome/Chromium (Linux).
#
# Uso: ./install-linux.sh <EXTENSION_ID>
# O EXTENSION_ID aparece em chrome://extensions com o "Modo do desenvolvedor"
# ligado, depois de carregar a pasta chrome-extension/ como "extensão
# descompactada".

set -e

EXTENSION_ID="$1"
if [ -z "$EXTENSION_ID" ]; then
  echo "Uso: $0 <EXTENSION_ID>" >&2
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
chmod +x "$DIR/host.sh" "$DIR/host.js"

MANIFEST_NAME="com.csvirtual.remotedesktop.host.json"

write_manifest() {
  target_dir="$1"
  mkdir -p "$target_dir"
  sed -e "s#__HOST_PATH__#$DIR/host.sh#" \
      -e "s#__EXTENSION_ID__#$EXTENSION_ID#" \
      "$DIR/manifest.template.json" > "$target_dir/$MANIFEST_NAME"
  echo "Manifest escrito em: $target_dir/$MANIFEST_NAME"
}

# Chrome e Chromium (só grava se o diretório de config existir OU sempre cria —
# não tem problema criar mesmo que o navegador não esteja instalado).
write_manifest "$HOME/.config/google-chrome/NativeMessagingHosts"
write_manifest "$HOME/.config/chromium/NativeMessagingHosts"

# Configuração padrão de como iniciar o host-agent (modo desenvolvimento:
# roda via `npx electron .`). Se você empacotou o app com electron-builder,
# edite ~/.cs-remote-desktop/launch-config.json apontando pro binário gerado.
STATE_DIR="$HOME/.cs-remote-desktop"
mkdir -p "$STATE_DIR"
HOST_AGENT_DIR="$(cd "$DIR/../../host-agent" && pwd)"
cat > "$STATE_DIR/launch-config.json" <<EOF
{
  "command": "npx",
  "args": ["electron", "."],
  "cwd": "$HOST_AGENT_DIR"
}
EOF

echo "Instalação concluída."
