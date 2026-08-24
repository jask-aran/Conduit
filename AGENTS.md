# Repository Guidelines
- `CONTRIBUTING.md` — GitHub issue taxonomy, readiness and lifecycle rules,
  plus commit/history and performance-observation conventions.
- `docs/testing.md` — test selection, commands, seams, local/VPS
  boundaries and evidence requirements for every testing approach.
- `conduit-web/README.md` — runtime model, HTTP API, auth mechanism, process
  residency and caps, and the live-session WebSocket protocol.
- `docs/references/distillations.md` — concise project-specific invariants and
  heuristics. ALWAYS read it once before starting a sprint or series of planned
  commits/ work, and reread it when repeatedly stuck on an issue; update it
  only through `$tacit-knowledge` after approval or validated repeated
  feedback.

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
