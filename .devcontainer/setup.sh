#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sudo apt-get update
sudo apt-get install -y --no-install-recommends build-essential python3
sudo rm -rf /var/lib/apt/lists/*

# Pin the evaluated Pi version. Pi's official npm instructions recommend
# --ignore-scripts for normal CLI installs.
sudo npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.6

cd "$ROOT/conduit-web"
npm ci
npm run build

mkdir -p "$HOME/.conduit" "$ROOT/data/chat/files" "$ROOT/data/pi"
mkdir -p "$HOME/.local/bin"
ln -sfn "$ROOT/scripts/conduit-pi.mjs" "$HOME/.local/bin/conduit-pi"
printf '%s\n' \
  'Conduit setup complete.' \
  'Authenticate the isolated Conduit runtime with: conduit-pi' \
  'Then enter: /login' \
  'The web app opens on the forwarded Conduit port.'
