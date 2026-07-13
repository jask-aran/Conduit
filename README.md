# Conduit

![architecture](interface_first_platform_architecture.svg)

Conduit is an interface-first personal agent platform. This repository currently
keeps two Phase 0 implementations side-by-side so the product can move forward
without losing the earlier architectural experiment.

## Phase 0 implementations

| Folder | Purpose | Status |
| --- | --- | --- |
| [`phase-0-custom`](phase-0-custom) | The original Conduit-owned Pi RPC runtime and lightweight web chat | Reference implementation |
| [`phase-0-pi-web`](phase-0-pi-web) | The recommended Phase 0, using PI WEB as the complete application | Default |

Start with [`phase-0-pi-web/README.md`](phase-0-pi-web/README.md). It runs on
WSL2 with either systemd user services or two supervised manual processes.

## Architectural boundary

PI WEB is the Phase 0 product, not Conduit's permanent platform contract. Pi and
PI WEB remain authoritative for Pi session history and process state. Future
Conduit identity, lineage, normalized events, approvals, portable state, and
harness adapters must live outside PI WEB's internal database and protocol.

