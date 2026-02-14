#!/bin/bash
# Quick deploy script for BotCraft VPS
# Usage: bash /opt/botcraft/deploy/update.sh
#
# API key is stored in /opt/botcraft/.env (not in git).
# Create it once:  echo "OPENAI_API_KEY=sk-..." > /opt/botcraft/.env

set -e
cd /opt/botcraft

echo "==> Pulling latest code..."
git reset --hard HEAD
git pull origin claude/moltmine-world-exploration-1RO6O

echo "==> Rebuilding client..."
cd client-web && npx vite build --logLevel error && cd ..

echo "==> Updating nginx config..."
cp deploy/nginx-botcraft.conf /etc/nginx/sites-available/botcraft
nginx -t 2>&1 && systemctl restart nginx

echo "==> Restarting services..."
pm2 restart botcraft-server
pm2 restart victorio

echo ""
echo "==> Deploy complete! Waiting 5s for startup..."
sleep 5
pm2 logs --lines 5 --nostream
