# Conduit

## Before you start
- Committing, or creating, restructuring or closing a GitHub issue → read `CONTRIBUTING.md`.
- Building or changing any UI → read `DESIGN.md`.
- Touching the HTTP API, auth, process residency or the live-session WebSocket protocol → read
  `conduit-web/README.md`.
- Client builds, deployment, several servers or data recovery → read `docs/DEPLOYMENT.md`.
- Any check beyond the table below → read `docs/TESTING.md`.
- Taking my UI feedback → run `node scripts/conduit-feedback.mjs wait` in the background; it ends when I send an
  item and prints the item's path. The item says how to read it, and `done <id>` marks it handled.

Read each one once per session.

## Checking your work
Run from `conduit-web/`. Pick the single cheapest check that proves the change:

| Change | Check |
| --- | --- |
| Types, routes, isolated logic | `npm run typecheck`, `node --test test/<file>.test.js` |
| Server behaviour | `curl` against `/v0/...` with a cookie from `node ../scripts/conduit-auth.mjs mint-session --format cookie` |
| A component or styling | `npm run gallery`, then the Windows Chrome DevTools CLI (`node ../scripts/run-windows-chrome-devtools.mjs`) |
| A release | `npm test` (release only) |

For a low-blast-radius change, skip the check and say "not run". Run checks in the foreground. The test count only
shrinks (`test/budget.json`), so a change that needs a new test removes more than it adds.

`npm run typecheck`, the build and `restart` report convention problems (`scripts/check-conventions.mjs`, each rule's
reason is in it): tell me about any you see, then fix them.

After each bounded change set, run `bash .devcontainer/start-conduit.sh restart` so the server is ready, then hand it
to me: I confirm behaviour.

## Style
Write concise code: say each thing once, and leave out speculative options, wrappers and comments that restate
the code.

## Build outputs
A requested Windows or Android build may replace its own output without asking: `C:\Users\<user>\conduit-desktop-target\`,
`C:\Users\<user>\conduit-desktop-target-dev\`, `conduit-web/android/app/build/outputs/` and `~/conduit-dev.apk`.
Every other rule about writing outside the project still applies.
