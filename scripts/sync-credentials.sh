#!/usr/bin/env bash
# sync-credentials.sh — copy this server's sign-ins to another Conduit server over ssh, then restart it there.
#
# For a second server that should use the same accounts without being set up by hand: the VPS's dev server, which
# takes only what a user would sign in to, never this machine's chats, context or customisation. New integrations are
# tried here first; run this again after signing in to something new.
#
#   scripts/sync-credentials.sh [ssh-host] [remote state dir] [remote server CLI]
#   defaults: jask-vps  /root/.conduit-dev  conduit-server-dev
#
# Copied (when present here): model provider keys and logins (pi/auth.json), custom providers (pi/models.json), web
# search keys (pi/web-search.json), voice credentials (voice.json), connector sign-ins (agent-connectors/), the
# ChatGPT web session (chatgpt-web/cookies.json). Not copied: the login password and sessions, push keys, server
# identity, and jbot's mailbox (agent/email.json), which only one server may poll: `--move-email` hands it over, and
# this server stops reading jbot's mail.
set -euo pipefail

move_email=0
args=()
for arg in "$@"; do [[ "$arg" == --move-email ]] && move_email=1 || args+=("$arg"); done
HOST="${args[0]:-jask-vps}"
REMOTE_STATE="${args[1]:-/root/.conduit-dev}"
REMOTE_CLI="${args[2]:-conduit-server-dev}"
DATA="${CONDUIT_DATA_ROOT:-$HOME/.conduit/data}"

FILES=(pi/auth.json pi/models.json pi/web-search.json voice.json agent-connectors chatgpt-web/cookies.json)
(( move_email )) && FILES+=(agent/email.json)
present=()
for file in "${FILES[@]}"; do [[ -e "$DATA/$file" ]] && present+=("$file"); done
(( ${#present[@]} )) || { echo "Nothing to copy in $DATA" >&2; exit 1; }

echo "Copying to $HOST:$REMOTE_STATE/data: ${present[*]}"
tar -C "$DATA" -cf - "${present[@]}" \
  | ssh "$HOST" "set -e; mkdir -p '$REMOTE_STATE/data'; umask 077; tar -C '$REMOTE_STATE/data' --no-same-owner -xf -
    # The CLI needs the Node its server runs on, which a non-interactive ssh shell may not have on PATH.
    node=\$(sed -n 's/^ExecStart=\\([^ ]*\\) .*/\\1/p' ~/.config/systemd/user/$REMOTE_CLI.service 2>/dev/null)
    [ -n \"\$node\" ] && PATH=\$(dirname \"\$node\"):\$PATH
    ~/.local/bin/$REMOTE_CLI restart"

if (( move_email )); then
  # Kept beside, not deleted: moving it back is copying it back.
  mv "$DATA/agent/email.json" "$DATA/agent/email.json.moved-to-$HOST"
  echo "jbot's mailbox now belongs to $HOST; restart this server so it stops polling it."
fi
