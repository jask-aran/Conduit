# Repository Guidelines
- `CONTRIBUTING.md` — GitHub issue taxonomy, readiness and lifecycle rules,
  plus commit/history and performance-observation conventions.
- `docs/TESTING.md` — test selection, commands, seams, local/VPS
  boundaries and evidence requirements for every testing approach.
- `conduit-web/README.md` — runtime model, HTTP API, auth mechanism, process
  residency and caps, and the live-session WebSocket protocol.
- `DESIGN.md` — in-app visual language for user-facing UI, read this before building or modifying any UI.
- `docs/DEPLOYMENT.md` — installation, data recovery, client builds, several
  servers and release constraints.

## Contribution guidance

Read `CONTRIBUTING.md` before `git commit`.

Before creating, restructuring or closing GitHub issues, or committing project
work, read `CONTRIBUTING.md`. It is the single reference for issue type,
readiness, Roadmap/Feature decomposition, and commit/history and
performance-observation conventions.

## Testing guidance

Read `docs/TESTING.md` before `npm run typecheck`, `npm run build`, or test commands.

Before testing or reviewing the server, web UI, local server, candidate build,
release artifact or VPS deployment, read `docs/TESTING.md`. It is
the single reference for approach selection, commands, safety boundaries and
evidence, what tools are available and how to use them.

- Dont reload/ re-read skills constantly, and run bash .devcontainer/start-conduit.sh restart to get the server ready for me to test, after each bounded change set.
- Do not waste tokens on broad test sweeps, writing new tests, or waiting around for fixtures.
- Pick only the single most surgical, token-efficient validation seam in docs/TESTING.md for the touched code.
- Make concise code changes and defer to me to confirm behaviour.
- If its reasonably low blast radius, skip testing and provide direct to me.
- Do not start backgrounded long running test tasks.
