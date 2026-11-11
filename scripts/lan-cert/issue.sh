#!/usr/bin/env bash
# A trusted certificate for Conduit's LAN name, by Let's Encrypt DNS-01 so nothing has to be reachable from the
# internet. LAN_CERT_HUB=0 skips the hub's own name, for a hub not on the LAN (its name would point elsewhere).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
name="${LAN_CERT_NAME:-lan.jask-aran.com}"
dir="${LAN_CERT_DIR:-$HOME/.conduit/tls}"
mkdir -p "$dir"
issue() {
  $certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
    --config-dir "$dir/letsencrypt" --work-dir "$dir/work" --logs-dir "$dir/logs" \
    --manual --preferred-challenges dns \
    --manual-auth-hook "$here/dns-auth.sh" --manual-cleanup-hook "$here/dns-cleanup.sh" \
    --keep-until-expiring --cert-name "$2" -d "$1"
  local live="$dir/letsencrypt/live/$2"
  ln -sf "$live/fullchain.pem" "$dir/$3-cert.pem"
  ln -sf "$live/privkey.pem" "$dir/$3-key.pem"
  echo "Certificate for $1: $dir/$3-cert.pem (key $dir/$3-key.pem)"
}
certbot="certbot"
command -v certbot >/dev/null 2>&1 || certbot="uvx certbot"
[[ "${LAN_CERT_HUB:-1}" == 0 ]] || issue "$name" "$name" lan
# The hub hands this wildcard to its nodes so a browser on this network reads from them directly.
issue "*.$name" "nodes.$name" nodes
