#!/usr/bin/env bash
# A trusted certificate for Conduit's LAN name (docs/DEPLOYMENT.md, LAN https).
# Let's Encrypt DNS-01 through the signed-in `cf` CLI, so nothing has to be
# reachable from the internet. Safe to rerun: certbot renews only when due.
#   LAN_CERT_NAME   default lan.jask-aran.com
#   LAN_CERT_DIR    default ~/.conduit/tls
#   LAN_CERT_HUB    0 to skip the hub's own name and issue only the nodes' wildcard
#                   (a hub that is not on the LAN, such as a VPS: its own
#                   name there would point at another machine)
# certbot is the system's where installed, else uvx's.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
name="${LAN_CERT_NAME:-lan.jask-aran.com}"
dir="${LAN_CERT_DIR:-$HOME/.conduit/tls}"
mkdir -p "$dir"
issue() { # <domain> <lineage> <link prefix>
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
# And one for every name under it, which the hub hands its nodes so a browser on this network reads from them
# directly (docs/plans/distributed-nodes-and-execution.md, "files take the shortest way").
issue "*.$name" "nodes.$name" nodes
