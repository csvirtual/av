#!/usr/bin/env bash
# Instalação de 1 comando do PDV C&S Virtual (pdv-servidor) numa VPS
# Ubuntu 24.04 nova (ex: Hostinger KVM1) — modo de LOJA ÚNICA, sem
# multi-tenant. Idempotente o suficiente pra rodar de novo se algo
# falhar no meio (não duplica usuário, não reclona se já existir etc.)
#
# Uso:
#   sudo DOMAIN=minhaloja.com.br EMAIL=voce@email.com bash install-hostinger.sh
# ou rode sem as variáveis e ele pergunta interativamente.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root (ou com sudo)." >&2
  exit 1
fi

if [ -z "${DOMAIN:-}" ]; then
  read -rp "Domínio que vai apontar pra essa VPS (ex: minhaloja.com.br): " DOMAIN
fi
if [ -z "${EMAIL:-}" ]; then
  read -rp "Seu e-mail (só pra aviso de vencimento do certificado): " EMAIL
fi
if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Domínio e e-mail são obrigatórios." >&2
  exit 1
fi

APP_DIR=/opt/pdv-servidor
APP_USER=pdv
REPO_URL=https://github.com/csvirtual/av.git

echo "==> Checando DNS de $DOMAIN antes de mexer em qualquer coisa..."
MY_IP=$(curl -s -4 https://api.ipify.org || true)
DNS_IP=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
if [ -n "$MY_IP" ] && [ -n "$DNS_IP" ] && [ "$MY_IP" != "$DNS_IP" ]; then
  echo "AVISO: $DOMAIN resolve pra $DNS_IP, mas esta VPS é $MY_IP."
  echo "Confirme o registro A na sua provedora de DNS antes de continuar (o certificado vai falhar sem isso)."
  read -rp "Continuar mesmo assim? (s/N) " CONFIRM
  [ "$CONFIRM" = "s" ] || [ "$CONFIRM" = "S" ] || exit 1
fi

echo "==> Atualizando o sistema..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

echo "==> Instalando dependências (git, build tools, nginx, certbot, ufw)..."
apt-get install -y git curl build-essential nginx certbot python3-certbot-nginx ufw

echo "==> Firewall (SSH + HTTP + HTTPS)..."
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 24 ]; then
  echo "==> Instalando Node.js 24..."
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
echo "Node instalado: $(node -v)"

if ! id "$APP_USER" >/dev/null 2>&1; then
  echo "==> Criando usuário de sistema '$APP_USER' (sem login, só roda o app)..."
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

if [ -d "$APP_DIR/.git" ]; then
  echo "==> Código já existe em $APP_DIR, atualizando..."
  cd "$APP_DIR"
  sudo -u "$APP_USER" git fetch origin main
  sudo -u "$APP_USER" git reset --hard origin/main
else
  echo "==> Baixando o código..."
  rm -rf /tmp/av-clone
  git clone --depth 1 "$REPO_URL" /tmp/av-clone
  mkdir -p "$APP_DIR"
  cp -r /tmp/av-clone/pdv-servidor/. "$APP_DIR"/
  # A cópia acima não leva a pasta .git (fica um nível acima, em
  # /tmp/av-clone/.git) — sem ela, lib/buildVersion.js não acha o hash
  # via `git rev-parse` e cai no fallback "dev". Grava o hash real aqui,
  # igual ao que `git archive` faria num deploy por zip.
  git -C /tmp/av-clone rev-parse --short HEAD > "$APP_DIR/BUILD_VERSION"
  rm -rf /tmp/av-clone
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi

echo "==> Instalando dependências do Node (só produção)..."
cd "$APP_DIR"
sudo -u "$APP_USER" npm install --omit=dev

echo "==> Criando o serviço systemd..."
cat > /etc/systemd/system/pdv-servidor.service <<EOF
[Unit]
Description=PDV C&S Virtual
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=PORT=3131
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pdv-servidor >/dev/null
systemctl restart pdv-servidor

echo "==> Aguardando o servidor subir..."
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:3131/api/status >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! curl -sf http://127.0.0.1:3131/api/status >/dev/null 2>&1; then
  echo "O servidor não respondeu a tempo. Veja o log com: journalctl -u pdv-servidor -e" >&2
  exit 1
fi
echo "Servidor rodando localmente."

echo "==> Configurando o nginx (HTTP primeiro, HTTPS vem no próximo passo)..."
cat > /etc/nginx/sites-available/pdv-servidor <<EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3131;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/pdv-servidor /etc/nginx/sites-enabled/pdv-servidor
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Emitindo certificado HTTPS (Let's Encrypt)..."
certbot --nginx --non-interactive --agree-tos -m "$EMAIL" -d "$DOMAIN" --redirect

echo ""
echo "============================================================"
echo " Pronto! Seu PDV está em: https://$DOMAIN"
echo ""
echo " Primeiro login: usuário 'admin', senha 'admin123'"
echo " (o sistema vai obrigar a trocar a senha no primeiro acesso)"
echo ""
echo " Comandos úteis:"
echo "   journalctl -u pdv-servidor -f     # ver o log ao vivo"
echo "   systemctl restart pdv-servidor    # reiniciar o app"
echo "   systemctl status pdv-servidor     # ver se está no ar"
echo "============================================================"
