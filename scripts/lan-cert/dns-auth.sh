#!/usr/bin/env bash
# certbot manual-auth-hook: publish the challenge, then wait until a public
# resolver sees it.
set -euo pipefail
zone="${LAN_CERT_ZONE:-${CERTBOT_DOMAIN#*.}}"
record="_acme-challenge.$CERTBOT_DOMAIN"
cf dns records create -q -z "$zone" --body "{\"type\":\"TXT\",\"name\":\"$record\",\"content\":\"\\\"$CERTBOT_VALIDATION\\\"\",\"ttl\":60}" >/dev/null
for _ in $(seq 1 30); do
  if curl -s -H "accept: application/dns-json" "https://cloudflare-dns.com/dns-query?name=$record&type=TXT" | grep -q -- "$CERTBOT_VALIDATION"; then sleep 5; exit 0; fi
  sleep 4
done
echo "challenge record did not appear in public DNS" >&2
exit 1
