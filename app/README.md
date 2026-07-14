# Conduit application state

This root is stable across the Phase 0 implementations and the eventual
top-level Conduit webapp:

- `files/` contains Conduit projects and their Pi JSONL sessions;
- `state/` contains webapp registries and the isolated `pi-agent/` runtime home.

Both runtime directories are ignored. Repository-owned Pi experience resources
belong in `../.pi/`, not in a phase implementation folder or runtime state.
