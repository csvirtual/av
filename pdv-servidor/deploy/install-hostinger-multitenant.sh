#!/usr/bin/env bash
# Instalação de 1 comando do PDV C&S Virtual (pdv-servidor) numa VPS
# Ubuntu 24.04 nova (ex: Hostinger KVM1) — modo MULTI-TENANT (várias
# lojas por subdomínio: seudominio.com = cadastro público,
# admin.seudominio.com = painel de Super Admin, qualquerloja.seudominio.com
# = cada loja). Precisa do DNS gerenciado na Cloudflare (certificado
# wildcard exige desafio DNS-01).
#
# Uso:
#   sudo DOMAIN=seudominio.com EMAIL=voce@email.com \
#        CLOUDFLARE_API_TOKEN=xxxx \
#        PLATFORM_ADMIN_USER=seunome PLATFORM_ADMIN_PASS=SenhaForte123 \
#        bash install-hostinger-multitenant.sh
# ou rode sem as variáveis e ele pergunta interativamente.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root (ou com sudo)." >&2
  exit 1
fi

if [ -z "${DOMAIN:-}" ]; then
  read -rp "Domínio base (ex: seudominio.com — as lojas ficam em <loja>.seudominio.com): " DOMAIN
fi
if [ -z "${EMAIL:-}" ]; then
  read -rp "Seu e-mail (aviso de vencimento do certificado): " EMAIL
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "Token de API da Cloudflare (Meu Perfil -> API Tokens -> Create Token -> Edit zone DNS, restrito a este domínio)."
  read -rsp "Cole o token (fica oculto ao digitar): " CLOUDFLARE_API_TOKEN
  echo ""
fi
if [ -z "${PLATFORM_ADMIN_USER:-}" ]; then
  read -rp "Nome de usuário pro SEU painel de Super Admin (admin.$DOMAIN): " PLATFORM_ADMIN_USER
fi
if [ -z "${PLATFORM_ADMIN_PASS:-}" ]; then
  read -rsp "Senha pro Super Admin (mín. 8 caracteres, fica oculta): " PLATFORM_ADMIN_PASS
  echo ""
fi
if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ] || [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$PLATFORM_ADMIN_USER" ] || [ -z "$PLATFORM_ADMIN_PASS" ]; then
  echo "Domínio, e-mail, token da Cloudflare e usuário/senha do Super Admin são obrigatórios." >&2
  exit 1
fi

APP_DIR=/opt/pdv-servidor
APP_USER=pdv
REPO_URL=https://github.com/csvirtual/av.git

echo "==> Checando DNS de $DOMAIN e de um subdomínio de teste..."
MY_IP=$(curl -s -4 https://api.ipify.org || true)
DNS_IP=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
WILDCARD_TEST_IP=$(getent hosts "checkwildcard-$$.$DOMAIN" | awk '{print $1}' | head -1 || true)
if [ -z "$DNS_IP" ] || [ "$MY_IP" != "$DNS_IP" ]; then
  echo "AVISO: $DOMAIN não resolve pro IP desta VPS ($MY_IP) ainda."
  echo "Confirme na Cloudflare os registros A: '@' -> $MY_IP e '*' -> $MY_IP (proxy DESLIGADO, nuvem cinza)."
  read -rp "Continuar mesmo assim? (s/N) " CONFIRM
  [ "$CONFIRM" = "s" ] || [ "$CONFIRM" = "S" ] || exit 1
elif [ -z "$WILDCARD_TEST_IP" ] || [ "$MY_IP" != "$WILDCARD_TEST_IP" ]; then
  echo "AVISO: o registro curinga (*.${DOMAIN}) não parece estar resolvendo pra esta VPS ainda."
  echo "Confirme o registro A '*' -> $MY_IP na Cloudflare (proxy DESLIGADO)."
  read -rp "Continuar mesmo assim? (s/N) " CONFIRM
  [ "$CONFIRM" = "s" ] || [ "$CONFIRM" = "S" ] || exit 1
fi

echo "==> Atualizando o sistema..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

echo "==> Instalando dependências (git, build tools, nginx, certbot + plugin Cloudflare, ufw)..."
apt-get install -y git curl build-essential nginx certbot python3-certbot-dns-cloudflare ufw

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
  rm -rf /tmp/av-clone
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi

echo "==> Instalando dependências do Node (só produção)..."
cd "$APP_DIR"
sudo -u "$APP_USER" npm install --omit=dev

echo "==> Guardando o token da Cloudflare (só root lê)..."
mkdir -p /root/.secrets
cat > /root/.secrets/cloudflare.ini <<EOF
dns_cloudflare_api_token = $CLOUDFLARE_API_TOKEN
EOF
chmod 600 /root/.secrets/cloudflare.ini

echo "==> Criando o serviço systemd (modo multi-tenant)..."
cat > /etc/systemd/system/pdv-servidor.service <<EOF
[Unit]
Description=PDV C&S Virtual (multi-tenant)
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=PORT=3131
Environment=MULTI_TENANT_DOMAIN=$DOMAIN
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
  if curl -sf http://127.0.0.1:3131/api/status -H "Host: $DOMAIN" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! curl -sf http://127.0.0.1:3131/api/status -H "Host: $DOMAIN" >/dev/null 2>&1; then
  echo "O servidor não respondeu a tempo. Veja o log com: journalctl -u pdv-servidor -e" >&2
  exit 1
fi
echo "Servidor rodando localmente."

echo "==> Emitindo certificado wildcard (Let's Encrypt via desafio DNS-01)..."
certbot certonly \
  --non-interactive --agree-tos -m "$EMAIL" \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d "$DOMAIN" -d "*.$DOMAIN"

echo "==> Configurando o nginx (domínio base + admin + qualquer subdomínio)..."
cat > /etc/nginx/sites-available/pdv-servidor <<EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name $DOMAIN *.$DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN *.$DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3131;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
EOF
ln -sf /etc/nginx/sites-available/pdv-servidor /etc/nginx/sites-enabled/pdv-servidor
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Criando seu usuário de Super Admin..."
cd "$APP_DIR"
node scripts/seedPlatformAdmin.js "$PLATFORM_ADMIN_USER" "$PLATFORM_ADMIN_PASS"

echo ""
echo "============================================================"
echo " Pronto!"
echo ""
echo " Painel de Super Admin (você): https://admin.$DOMAIN"
echo "   usuário: $PLATFORM_ADMIN_USER"
echo ""
echo " Cadastro de novas lojas (público): https://$DOMAIN"
echo "   depois de cadastrada, cada loja acessa https://<slug>.$DOMAIN"
echo "   primeiro login de cada loja: admin / admin123 (troca obrigatória)"
echo ""
echo " A renovação do certificado wildcard já é automática (certbot.timer)."
echo ""
echo " Comandos úteis:"
echo "   journalctl -u pdv-servidor -f     # ver o log ao vivo"
echo "   systemctl restart pdv-servidor    # reiniciar o app"
echo "   node scripts/createTenant.js --new <slug> \"Razão Social\" \"Nome Fantasia\"  # criar loja via CLI"
echo "============================================================"
