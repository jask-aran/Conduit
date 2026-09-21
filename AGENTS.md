# Repository Guidelines
- `CONTRIBUTING.md` — GitHub issue taxonomy, readiness and lifecycle rules,
  plus commit/history and performance-observation conventions.
- `docs/testing.md` — test selection, commands, seams, local/VPS
  boundaries and evidence requirements for every testing approach.
- `conduit-web/README.md` — runtime model, HTTP API, auth mechanism, process
  residency and caps, and the live-session WebSocket protocol.
- `DESIGN.md` — in-app visual language for user-facing UI, read this before building or modifying any UI.
- `docs/desktop-client.md` — how the Windows desktop and Android clients are
  built, released, updated and run as a development client beside the released
  one.

## Contribution guidance

Before creating, restructuring or closing GitHub issues, or committing project
work, read `CONTRIBUTING.md`. It is the single reference for issue type,
readiness, Roadmap/Feature decomposition, and commit/history and
performance-observation conventions.

## Testing guidance

Before testing or reviewing the server, web UI, local server, candidate build,
release artifact or VPS deployment, read `docs/testing.md`. It is
the single reference for approach selection, commands, safety boundaries and
evidence, what tools are available and how to use them.

Do not waste tokens on broad test sweeps, writing new tests, or waiting around for fixtures. Pick only the single most surgical, token-efficient validation seam in docs/testing.md for the touched code. Make concise code changes and defer to me to confirm behaviour. If its reasonably low blast radius, skip testing and provide direct to me. Dont reload/ re-read skills constantly, and run bash .devcontainer/start-conduit.sh restart to get the server ready for me to test, after each bounded change set. Do not start backgrounded long running test tasks.