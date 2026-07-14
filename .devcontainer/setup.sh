#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_TAU_DIR="$HOME/.conduit/upstream/pi-tau-web-server"
PI_TAU_REF="af1f3dee7784e50c58176f3932efbda9601b4ff6"

sudo apt-get update
sudo apt-get install -y --no-install-recommends build-essential python3
sudo rm -rf /var/lib/apt/lists/*

# Pin the evaluated Pi version. Pi's official npm instructions recommend
# --ignore-scripts for normal CLI installs.
sudo npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.6

mkdir -p "$(dirname "$PI_TAU_DIR")"
if [[ ! -d "$PI_TAU_DIR/.git" ]]; then
  git clone --filter=blob:none --no-checkout \
    https://github.com/milanglacier/pi-tau-web-server.git "$PI_TAU_DIR"
fi
git -C "$PI_TAU_DIR" fetch --depth 1 origin "$PI_TAU_REF"
git -C "$PI_TAU_DIR" checkout --detach "$PI_TAU_REF"
npm ci --prefix "$PI_TAU_DIR" --no-audit --no-fund

cd "$ROOT/phase-0-pi-web"
npm ci

cd "$ROOT/phase-0-custom"
npm ci
npm run build

mkdir -p "$HOME/.conduit" "$ROOT/app/files" "$ROOT/app/state"
printf '%s\n' \
  'Conduit setup complete.' \
  'Authenticate Pi in this terminal with: pi' \
  'Then enter: /login' \
  'The custom chat opens on Conduit · Custom.' \
  'Pi Tau and PI WEB remain available as comparison surfaces.'
