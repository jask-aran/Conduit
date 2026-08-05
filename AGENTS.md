# Repository Guidelines

This file is the working contract for contributors and coding agents:
operational constraints and steering. It deliberately does not repeat
reference documentation:

- `README.md` — product, architecture, data model, interface reference and
  setup. Read the section covering the area you touch before changing it.
- `CONTRIBUTING.md` — GitHub issue taxonomy, readiness and lifecycle rules,
  plus commit/history and performance-observation conventions.
- `docs/operations/testing.md` — test selection, commands, seams, local/VPS
  boundaries and evidence requirements for every testing approach.
- `conduit-web/README.md` — runtime model, HTTP API, auth mechanism, process
  residency and caps, and the live-session WebSocket protocol.
- `docs/architecture/personal-agent-platform-design.md` — long-range vision.
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
release artifact or VPS deployment, read `docs/operations/testing.md`. It is
the single reference for approach selection, commands, safety boundaries and
evidence.

## Style

ES modules, two-space indent, semicolons, double quotes; `camelCase`
functions, `PascalCase` components, kebab-case filenames. Configuration lives in
env vars documented by `conduit-web/.env.example`. No repo-wide formatter: avoid
formatting changes unrelated to the task.
