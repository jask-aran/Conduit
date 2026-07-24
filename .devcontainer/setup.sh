#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sudo apt-get update
sudo apt-get install -y --no-install-recommends build-essential python3
sudo rm -rf /var/lib/apt/lists/*

"$ROOT/.devcontainer/start-conduit.sh" setup
cd "$ROOT/conduit-web"
npx playwright install --with-deps chromium
"$ROOT/.devcontainer/start-conduit.sh" build

mkdir -p "$HOME/.local/bin"
ln -sfn "$ROOT/scripts/conduit-pi.mjs" "$HOME/.local/bin/conduit-pi"
printf '%s\n' \
  'Conduit setup complete.' \
  'The pinned Isolated Pi runtime was installed with the web dependencies.' \
  'Set a Conduit password, sign in, then use Settings → Auth to sign in to Pi.'
