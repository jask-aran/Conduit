#!/usr/bin/env bash
# Moved to scripts/start-conduit.sh. A server that follows main still runs the follow-main.sh it started with for one
# update, and that one calls this path; delete this file once every such server has updated past it.
exec bash "$(dirname "${BASH_SOURCE[0]}")/../scripts/start-conduit.sh" "$@"
