#!/bin/bash
#
# BotCraft VPS Deployment Script
# Run this on your Hostinger VPS as root:
#
#   curl -sSL https://raw.githubusercontent.com/StanAlt/MoltMine/claude/moltmine-world-exploration-1RO6O/deploy/setup-vps.sh | bash
#
# Or copy-paste the contents into your VPS terminal.
#
# Prerequisites: Ubuntu 24.04 LTS (Hostinger KVM 2)
#

set -euo pipefail

echo ""
echo "  =================================================="
echo "  BotCraft Deployment"
echo "  botcraft.app — Where AI agents build worlds"
echo "  =================================================="
echo ""

# ── 1. System updates & essentials ─────────────────────

echo "[1/8] Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq git curl nginx certbot python3-certbot-nginx ufw

# ── 2. Install Node.js 22 LTS ──────────────────────────

echo "[2/8] Installing Node.js 22 LTS..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "  Node.js $(node -v), npm $(npm -v)"

# ── 3. Install PM2 ─────────────────────────────────────

echo "[3/8] Installing PM2 process manager..."
npm install -g pm2 --silent 2>/dev/null
pm2 startup systemd -u root --hp /root --silent 2>/dev/null || true

# ── 4. Clone the repo ──────────────────────────────────

echo "[4/8] Cloning BotCraft..."
DEPLOY_DIR="/opt/botcraft"

if [ -d "$DEPLOY_DIR" ]; then
  echo "  Updating existing installation..."
  cd "$DEPLOY_DIR"
  git fetch origin claude/moltmine-world-exploration-1RO6O
  git checkout claude/moltmine-world-exploration-1RO6O
  git pull origin claude/moltmine-world-exploration-1RO6O
else
  git clone https://github.com/StanAlt/MoltMine.git "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
  git checkout claude/moltmine-world-exploration-1RO6O
fi

# ── 5. Install dependencies ────────────────────────────

echo "[5/8] Installing dependencies..."
cd "$DEPLOY_DIR/server" && npm install --production --silent
cd "$DEPLOY_DIR/packages/agent-sdk" && npm install --production --silent
cd "$DEPLOY_DIR/packages/molty-mind" && npm install --production --silent

# ── 6. Build the web client ────────────────────────────

echo "[6/8] Building web client..."
cd "$DEPLOY_DIR/client-web"
npm install --silent
npx vite build

echo "  Client built to $DEPLOY_DIR/client-web/dist/"

# ── 7. Configure nginx ─────────────────────────────────

echo "[7/8] Configuring nginx..."
cp "$DEPLOY_DIR/deploy/nginx-botcraft.conf" /etc/nginx/sites-available/botcraft
ln -sf /etc/nginx/sites-available/botcraft /etc/nginx/sites-enabled/botcraft
rm -f /etc/nginx/sites-enabled/default

# Test and reload
nginx -t
systemctl enable nginx
systemctl restart nginx

# ── 8. Configure firewall ──────────────────────────────

echo "[8/8] Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# ── Create log directory ────────────────────────────────

mkdir -p /var/log/botcraft

# ── Done! ───────────────────────────────────────────────

echo ""
echo "  =================================================="
echo "  BotCraft installed!"
echo "  =================================================="
echo ""
echo "  Next steps:"
echo ""
echo "  1. Set your Anthropic API key in the PM2 config:"
echo "     nano /opt/botcraft/deploy/ecosystem.config.cjs"
echo "     (change REPLACE_WITH_YOUR_KEY to your actual key)"
echo ""
echo "  2. Start the server + Victorio:"
echo "     cd /opt/botcraft && pm2 start deploy/ecosystem.config.cjs"
echo "     pm2 save"
echo ""
echo "  3. Point botcraft.app DNS to this server's IP:"
echo "     A record: botcraft.app → $(curl -4s ifconfig.me 2>/dev/null || echo 'YOUR_IP')"
echo ""
echo "  4. After DNS propagates, enable HTTPS:"
echo "     certbot --nginx -d botcraft.app -d www.botcraft.app"
echo ""
echo "  5. Verify:"
echo "     curl http://localhost:3000/health"
echo "     pm2 logs"
echo ""
echo "  Useful commands:"
echo "     pm2 status              — check if processes are running"
echo "     pm2 logs botcraft-server — server logs"
echo "     pm2 logs victorio       — Victorio's brain logs"
echo "     pm2 restart all         — restart everything"
echo ""
