#!/usr/bin/env bash
# A trusted certificate for Conduit's LAN name (docs/DEPLOYMENT.md, LAN https).
# Let's Encrypt DNS-01 through the signed-in `cf` CLI, so nothing has to be
# reachable from the internet. Safe to rerun: certbot renews only when due.
#   LAN_CERT_NAME   default lan.jask-aran.com
#   LAN_CERT_DIR    default ~/.conduit/tls
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
name="${LAN_CERT_NAME:-lan.jask-aran.com}"
dir="${LAN_CERT_DIR:-$HOME/.conduit/tls}"
mkdir -p "$dir"
uvx certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --config-dir "$dir/letsencrypt" --work-dir "$dir/work" --logs-dir "$dir/logs" \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$here/dns-auth.sh" --manual-cleanup-hook "$here/dns-cleanup.sh" \
  --keep-until-expiring -d "$name"
live="$dir/letsencrypt/live/$name"
ln -sf "$live/fullchain.pem" "$dir/lan-cert.pem"
ln -sf "$live/privkey.pem" "$dir/lan-key.pem"
echo "LAN certificate: $dir/lan-cert.pem (key $dir/lan-key.pem)"
