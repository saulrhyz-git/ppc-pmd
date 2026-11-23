#!/usr/bin/env bash
# Pull the latest code from GitHub and restart the app on the local server.
# Run from the repository folder on the server, e.g.:  ./deploy/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."
BRANCH="${1:-main}"

echo "==> Fetching $BRANCH from GitHub"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Installing dependencies"
npm ci --include=dev

echo "==> Applying database migrations"
npm run db:deploy

echo "==> Building the web app"
npm run build

echo "==> Restarting the service"
if systemctl list-unit-files | grep -q '^pmd.service'; then
  sudo systemctl restart pmd
  sleep 2
  systemctl --no-pager --lines=5 status pmd || true
else
  echo "pmd.service is not installed. Start the app with: npm start"
fi

PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
curl -fsS "http://localhost:${PORT:-3000}/api/health" && echo "  <- health check OK"
