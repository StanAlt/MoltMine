#!/bin/bash
# Quick deploy script for BotCraft VPS
# Usage: bash /opt/botcraft/deploy/update.sh

set -e
cd /opt/botcraft

echo "==> Pulling latest code..."
git stash --quiet 2>/dev/null || true
git pull origin claude/moltmine-world-exploration-1RO6O
git stash pop --quiet 2>/dev/null || true

echo "==> Rebuilding client..."
cd client-web && npx vite build --logLevel error && cd ..

echo "==> Updating nginx config..."
cp deploy/nginx-botcraft.conf /etc/nginx/sites-available/botcraft
nginx -t 2>&1 && systemctl restart nginx

echo "==> Restarting services..."
pm2 restart botcraft-server --update-env
pm2 restart victorio --update-env

echo ""
echo "==> Deploy complete! Waiting 5s for startup..."
sleep 5
pm2 logs --lines 3 --nostream
