#!/bin/sh
# Registra o native messaging host no Chrome/Chromium (macOS).
#
# Uso: ./install-mac.sh <EXTENSION_ID>

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

write_manifest "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
write_manifest "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"

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
