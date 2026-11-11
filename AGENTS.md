# Conduit

## Before you start
- Committing → other agents may share this checkout. Leave changes that are not yours alone (never reset, revert or
  stash them) and commit only your own files.
- Cutting a release → read "Release" in `docs/DEPLOYMENT.md`.
- Building or changing any UI → read `DESIGN.md`.
- Touching the HTTP API, auth, process residency or the live-session WebSocket protocol → read "Changing the code"
  in `README.md`; `conduit-web/src/server/routes/` and `conduit-web/src/chat-backend-contract.d.ts` are the reference.
- Client builds, deployment, several servers or data recovery → read `docs/DEPLOYMENT.md`.
- Any check beyond the table below → read `docs/TESTING.md`.
- Taking my UI feedback → run `node scripts/conduit-feedback.mjs wait "<what you are working on>"` in the background.
  The feedback tool then lists you by that name, and I hand items to you from it. It ends when one arrives and prints
  the item's path and what to do next: the item says how to read it, `done <id>` marks it handled, and you wait again
  until I say stop.
- Reviewing UI feedback I already sent → `node scripts/conduit-feedback.mjs list`, then `take <id>` for each one that
  is `waiting`; every item I send lands in the folder whether or not a session was listening.

Read each one once per session.

## Checking your work
Run from `conduit-web/`. Pick the single cheapest check that proves the change:

| Change | Check |
| --- | --- |
| Types, routes, isolated logic | `npm run typecheck`, `node --test test/<file>.test.js` |
| Server behaviour | `curl` against `/v0/...` with a cookie from `node ../scripts/conduit-auth.mjs mint-session --format cookie` |
| A component or styling | `npm run gallery`, then the Windows Chrome DevTools CLI (`node ../scripts/run-windows-chrome-devtools.mjs`) |
| A release | `npm test` (release only) |

For a low-blast-radius change, skip the check and say "not run". Run checks in the foreground. Tests and Markdown only
shrink (`conduit-web/budgets.json`, checked with the conventions), so a change that needs a new test or document
removes more than it adds.

`npm run typecheck`, the build and `restart` report convention problems (`scripts/check-conventions.mjs`, each rule's
reason is in it): tell me about any you see, then fix them.

After each bounded change set, run `bash scripts/start-conduit.sh restart` so the server is ready, then hand it
to me: I confirm behaviour.

## Style
Write concise code: say each thing once, and leave out speculative options, wrappers and comments that restate
the code.

## Build outputs
A requested Windows or Android build may replace its own output without asking: `%LOCALAPPDATA%\conduit-build\desktop-target\`,
`%LOCALAPPDATA%\conduit-build\desktop-target-dev\`, `conduit-web/android/app/build/outputs/` and `~/conduit-dev.apk`.
Every other rule about writing outside the project still applies.
