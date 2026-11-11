#!/usr/bin/env bash
# Make another Conduit server feel identical to this one, over ssh, then restart it there.
# OAuth sign-ins are never copied: a refresh token used from two machines is rotated by one and dies on the other.
# jbot's mailbox can be polled by one server only: `--move-email` hands it over.
set -euo pipefail

move_email=0
args=()
for arg in "$@"; do [[ "$arg" == --move-email ]] && move_email=1 || args+=("$arg"); done
HOST="${args[0]:-jask-vps}"
REMOTE_STATE="${args[1]:-/root/.conduit-dev}"
REMOTE_CLI="${args[2]:-conduit-server-dev}"
DATA="${CONDUIT_DATA_ROOT:-$HOME/.conduit/data}"
AGENT=chat/files/conduit-agent

FILES=(preferences.json keybindings.json runtime.json account voice.json
  pi/settings.json pi/models.json pi/models-store.json pi/web-search.json
  prompt-overrides
  chatgpt-web/cookies.json)
(( move_email )) && FILES+=(agent/email.json)
present=()
for file in "${FILES[@]}"; do [[ -e "$DATA/$file" ]] && present+=("$file"); done

stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
python3 - "$DATA/pi/auth.json" "$stage/api-keys.json" <<'EOF'
import json, sys
try: auth = json.load(open(sys.argv[1]))
except FileNotFoundError: auth = {}
json.dump({k: v for k, v in auth.items() if isinstance(v, dict) and v.get("type") == "api_key"}, open(sys.argv[2], "w"))
EOF
cat >"$stage/merge-keys.py" <<'EOF'
import json, os, sys
keys = json.load(open(sys.argv[1]))
try: auth = json.load(open(sys.argv[2]))
except FileNotFoundError: auth = {}
auth.update(keys)
os.makedirs(os.path.dirname(sys.argv[2]), exist_ok=True)
with open(sys.argv[2], "w") as out: json.dump(auth, out, indent=2)
EOF
cat >"$stage/merge-agent.py" <<'EOF'
import json, sys
local = json.load(open(sys.argv[1]))
try: remote = json.load(open(sys.argv[2]))
except FileNotFoundError: remote = {}
# The switches stay the remote's; within them, the schedule (times, intervals) follows this server.
for key in ("heartbeat", "brief"):
    if key in local and isinstance(remote.get(key), dict) and "enabled" in remote[key]:
        local[key] = {**local[key], "enabled": remote[key]["enabled"]}
if "on" in remote: local["on"] = remote["on"]
with open(sys.argv[2], "w") as out: json.dump(local, out, indent=2)
EOF
cp "$DATA/$AGENT/agent.json" "$stage/agent.json" 2>/dev/null || echo '{}' >"$stage/agent.json"
tar -C "$DATA" -cf "$stage/send.tar" "${present[@]}"
tar -C "$stage" -rf "$stage/send.tar" api-keys.json merge-keys.py merge-agent.py agent.json

echo "Copying to $HOST:$REMOTE_STATE/data: ${present[*]} and the API keys in pi/auth.json"
ssh "$HOST" "set -e; d='$REMOTE_STATE/data'; umask 077; mkdir -p \"\$d\"; t=\$(mktemp -d)
  tar -C \"\$t\" --no-same-owner -xf -
  python3 \"\$t/merge-keys.py\" \"\$t/api-keys.json\" \"\$d/pi/auth.json\"
  mkdir -p \"\$d/$AGENT\"; python3 \"\$t/merge-agent.py\" \"\$t/agent.json\" \"\$d/$AGENT/agent.json\"
  rm \"\$t/merge-keys.py\" \"\$t/api-keys.json\" \"\$t/merge-agent.py\" \"\$t/agent.json\"; cp -a \"\$t\"/. \"\$d\"/; rm -rf \"\$t\"
  # The CLI needs the Node its server runs on, which a non-interactive ssh shell may not have on PATH.
  node=\$(sed -n 's/^ExecStart=\\([^ ]*\\) .*/\\1/p' ~/.config/systemd/user/$REMOTE_CLI.service 2>/dev/null)
  [ -n \"\$node\" ] && PATH=\$(dirname \"\$node\"):\$PATH
  ~/.local/bin/$REMOTE_CLI restart" <"$stage/send.tar"

if (( move_email )); then
  # Kept beside, not deleted: moving it back is copying it back.
  mv "$DATA/agent/email.json" "$DATA/agent/email.json.moved-to-$HOST"
  echo "jbot's mailbox now belongs to $HOST; restart this server so it stops polling it."
fi
