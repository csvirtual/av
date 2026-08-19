#!/bin/sh
# Wrapper exigido pelo Native Messaging do Chrome no Linux/macOS: o "path"
# do manifest precisa ser um executável, não um .js direto.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/host.js"
