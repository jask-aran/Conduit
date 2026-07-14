#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

sudo apt-get update
sudo apt-get install -y --no-install-recommends build-essential python3
sudo rm -rf /var/lib/apt/lists/*

# Pin the evaluated Pi version. Pi's official npm instructions recommend
# --ignore-scripts for normal CLI installs.
sudo npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.6

cd "$ROOT/phase-0-pi-web"
npm ci

mkdir -p "$HOME/.conduit"
printf '%s\n' \
  'Conduit setup complete.' \
  'Authenticate Pi in this terminal with: pi' \
  'Then enter: /login' \
  'PI WEB will be available on the forwarded port named Conduit · PI WEB.'

