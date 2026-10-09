#!/usr/bin/env bash
# certbot manual-cleanup-hook: remove this challenge's TXT record.
set -euo pipefail
zone="${LAN_CERT_ZONE:-${CERTBOT_DOMAIN#*.}}"
record="_acme-challenge.$CERTBOT_DOMAIN"
cf dns records list -z "$zone" --type TXT --name "$record" 2>/dev/null \
  | python3 -c 'import json, sys
data = json.load(sys.stdin)
rows = data.get("result", data) if isinstance(data, dict) else data
for row in rows:
    if sys.argv[1] in row.get("content", ""): print(row["id"])' "$CERTBOT_VALIDATION" \
  | while read -r id; do cf dns records delete -q --force -z "$zone" "$id" >/dev/null; done
