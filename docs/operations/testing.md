# Testing Conduit

Use the narrowest approach that proves the behavior. Run commands from
`conduit-web/` unless a command starts with `./scripts` or
`.devcontainer/start-conduit.sh`; never add a production-only test endpoint.

## Choose one approach

| Behavior | Approach | Entry point | Evidence |
| --- | --- | --- | --- |
| Types, bundle, PWA artifacts, pure stores and helpers | Static/unit | `npm run typecheck`; `npm run build`; `npm test -- test/<name>.test.js` | exit status and test output |
| Express, HTTP, WebSocket, SSE, Pi lifecycle | Server contract | `node --test test/<name>.test.js`; use `startConduitHarness()` | public-contract assertions; fake Pi logs/events |
| Token cadence, coalescing, stalls, high TPS, slow readers | Deterministic transport | `npm run test:harness -- ...` | versioned JSON; no credentials/provider |
| Solid rendering, DOM mutation, frames, reconnect | Deterministic browser | `npm run test:harness:browser -- ...` | versioned JSON; Playwright failure trace |
| Authenticated UI workflows and site functionality | Agent-browser development QA | `npm run qa:agent-browser` | restored-session snapshots, semantic checks, screenshots, network and accessibility evidence |
| Release browser set-pieces and terminal performance | Playwright release canary | `npm run test:browser:setpieces`; selected terminal checks when promoted | repeatable assertions, screenshots/traces on failure, performance report |
| Real provider, release, TLS, reverse proxy, Internet path | Live transport | `npm run perf:live -- ...` | redacted JSON; release and content parity |
| Image/package/persistence deployment contract | Deployment proof | `./scripts/package-release.sh <commit>`; `./scripts/prove-deployment.sh` | package checksum and retained evidence |

Do not substitute one row for another: deterministic tests explain behavior;
live tests measure a deployed system; browser functionality tests prove UI
contracts; deployment proof proves packaging and state boundaries.

## Common rules

- Local server commands are managed: from the repository root run
  `bash .devcontainer/start-conduit.sh restart`; use `dev` only for Vite HMR.
  Do not launch `node src/server.js`, `npm run start`, or Vite directly.
- The local launcher keeps its default `CONDUIT_HOST=0.0.0.0` bind so Windows
  can reach a server running inside WSL. Do not replace it with
  `CONDUIT_HOST=127.0.0.1` for ordinary local QA. Use `127.0.0.1:4310` as the
  client or health-check URL; the URL does not change the server bind.
- Browser specs mock the API unless the server boundary is the behavior under
  test. Keep state in a temporary fixture; never use repository `data/` for a
  test that can mutate it.
- Agent-browser is the default browser surface for development and pre-commit
  validation. Use a restored session and test the changed user flow manually
  with semantic assertions and evidence.
- Playwright is reserved for named release set-pieces and their CI canaries.
  Do not add or run a focused Playwright spec as the normal development loop.
  Promote a stable, release-critical flow into `test:browser:setpieces` when it
  needs repeatable CI proof.
- The full Playwright suite is a local maintenance check, not a pre-commit or
  automatic release gate. Record the exact command and result when a broad
  suite is stale, slow, or blocked.
- Redact passwords, prompts, cookies, transcript contents and credentials from
  logs and reports. Store temporary JSON under `/tmp`; do not commit reports,
  `test-results/`, `dist/`, `data/`, or `node_modules/`.
- Every report must identify its scenario, target and release. Compare live
  runs only when prompt, model, thinking level, output bounds and release are
  controlled; otherwise compare cadence only and state the confounder.

## Server and API contracts

`conduit-web/test/*.test.js` uses Node's test runner. Prefer pure unit tests for
stores, reducers and normalisers. For an Express/WS/SSE seam, use the black-box
`startConduitHarness()` fixture: it starts the production server on an ephemeral
loopback port, replaces only Pi with a controllable RPC peer, and exposes the
ordinary public contracts. Assert HTTP responses, WebSocket events, persisted
JSONL and child-process commands; do not mock the server function under test.

Run one file with:

```bash
node --test test/server-api.test.js
npm test -- test/live-harness.test.js
```

## Deterministic transport

The runner drives the production live-session WebSocket with scripted Pi
events. It has no provider cost and is the baseline for server delivery:

```bash
npm run test:harness -- \
  --scenario local-high-tps \
  --profile high-tps \
  --text "A deterministic streamed response" \
  --client-pause-after 20 --client-pause-ms 250
```

Profiles: `steady`, `burst`, `stall`, `high-tps`, `jitter`. Controls include
chunk size, intervals, seeded jitter, intentional source stalls and a paused
WebSocket reader. JSON reports include source/delivered counts and characters,
prompt acceptance, first delta, completion, throughput, p50/p95/p99/max gaps,
stall and burst counts, coalescing ratio and final-text parity.

## Deterministic browser and UI functionality

The browser harness drives the production Solid client through its public
HTTP/WS contracts with a deterministic stream. Use it only for rendering and
reconnect performance:

```bash
npm run test:harness:browser -- \
  --scenario browser-burst \
  --profile burst \
  --text "A browser-rendered response"
npm run test:harness:browser -- \
  --flow reconnect \
  --initial-text "Answer survives" \
  --recovered-delta " reconnects"
```

Reports include WebSocket and visible-text cadence, DOM mutation count,
animation-frame gaps, long tasks and final semantic text; reconnect reports
include socket count, resume count, recovery time and duplicate characters.

For non-streaming functionality—login, navigation, chat/project creation,
attachments, Workspace operations, model settings, PWA/mobile behavior and
terminal controls—use agent-browser against the managed server. Use
`npm run test:browser:setpieces` only for a promoted release canary. Failed
Playwright tests leave traces/screenshots under `test-results/`; a passing
harness report is stdout JSON, not a trace.

## Development and pre-commit browser QA

Use `agent-browser` for all browser validation during development and before a
commit. It is the primary UI testing surface. It is not CI regression proof.
The entry point starts or restores a named session, opens the managed local
server, waits for network idle, and prints a compact interactive snapshot:

```bash
bash .devcontainer/start-conduit.sh restart
cd conduit-web
agent-browser skills get core
agent-browser skills get dogfood
npm run qa:agent-browser
```

Run the restart and QA commands as separate commands. The QA entry point creates
or restores the named worktree session and prints its session ID. This keeps the
managed-server rule and the QA rule separately matchable by Codex.

Use the restored session for the changed flow:

- Prefer `snapshot -i -c` and semantic `find` commands.
- Use `batch` for short flows and refresh snapshots after page changes.
- Use filtered network requests, screenshots, and `a11y` when they add
  evidence.
- Store temporary evidence under `/tmp`; do not record credentials, cookies,
  prompts, or transcript contents.
- Close the session after use:

```bash
agent-browser --session <session-id-printed-by-qa> close
```

The normal pre-commit ladder is the fast code checks, the deterministic
transport harness when streaming code changed, and this agent-browser flow for
the affected UI. Do not run `npm run test:browser` as a pre-commit substitute.
Use the auth vault or an already restored session for login; never put a
password in a command or commit hook.

CI does not run agent-browser because it depends on a restored interactive
session. Capture its evidence in the change record, then promote only stable
release-critical behavior to the Playwright canary.

## CI browser policy

CI has two browser levels plus the fast code checks:

- Fast checks run automatically on pull requests and pushes to `main`.
- Playwright set-pieces run manually or for `v*` release tags through
  `npm run test:browser:setpieces`. The current canaries cover authentication,
  the command palette, the primary chat route, live-stream reconnect, the
  Workspace terminal route, and desktop/mobile PWA layout.
- The full Playwright suite runs locally by opt-in only with
  `npm run test:browser`; use it to maintain or promote canaries, not for
  ordinary development.

Deterministic browser performance tests remain separate from UI regression
tests. The performance harness may use Playwright internally, but it is not a
replacement for focused UI specs.

The release canary entry point is:

```bash
npm run test:browser:setpieces
```

## Local managed server

For manual UI checks or a local live run, restart from the repository root:

```bash
bash .devcontainer/start-conduit.sh restart
curl -fsS http://127.0.0.1:4310/healthz
```

The launcher default remains `0.0.0.0` so the WSL server is reachable from
Windows. The health response may say `development` for ordinary local work. The live
runner requires a full 40-character release SHA, so pin a committed build:

```bash
CONDUIT_RELEASE="$(git rev-parse HEAD)" \
  bash .devcontainer/start-conduit.sh restart
```

For a candidate worktree exposed to Windows/WSL, use isolated state and the
protected auth file:

```bash
CONDUIT_HOST=0.0.0.0 \
CONDUIT_STATE_DIR=/tmp/conduit-candidate-state \
CONDUIT_AUTH_FILE=/home/jask/Conduit/data/auth.json \
bash .devcontainer/start-conduit.sh restart
```

Confirm the port, PID and health response before testing so a main-checkout
server is not mistaken for the candidate.

## Live local or VPS transport

`perf:live` performs one bounded, cost-bearing run through normal login,
`/v0/live-sessions` and the authenticated WebSocket. It refuses an unhealthy
target, a missing full release SHA, an active generation or missing secrets;
it does not delete the chat or stop the server-owned process. Use a fresh,
ordinary chat reserved for benchmarks so history and concurrent work do not
confound the sample:

```bash
export CONDUIT_PERF_PASSWORD='loaded outside shell history'
export CONDUIT_PERF_PROMPT='Use the standard streaming baseline prompt.'
npm run perf:live -- \
  --target local \
  --origin http://127.0.0.1:4310 \
  --chat-id <dedicated-chat-id>
unset CONDUIT_PERF_PASSWORD CONDUIT_PERF_PROMPT
```

Replace `--origin` with `https://conduit.jask-aran.com` and set a target such
as `vps-edge` for Internet testing. Default bounds are 60 seconds and 200,000
streamed characters; override with `--timeout-ms` and `--max-chars` only when
the reason is recorded. Save stdout for comparison:

```bash
npm run perf:live -- ... > /tmp/conduit-live-<target>.json
```

The report records target, origin, full release, runtime/model/thinking level,
prompt acceptance, first visible delta, completion, visible-text deltas,
gap percentiles, gaps over 100 ms, output hashes and persisted-content parity.
It does not measure DOM frames; pair it with the deterministic browser layer
for client rendering.

## Release and deployment checks

`npm run build` includes the bundle/PWA budget and artifact checks. For an exact
commit package, run `./scripts/package-release.sh <commit>`; it embeds the full
SHA in the archive, image metadata and health response. `./scripts/prove-deployment.sh`
is a one-engine simulated two-host persistence proof, not a
substitute for a real VPS measurement.

After a tagged image release, verify the public deployment before `perf:live`:

```bash
curl -fsS https://conduit.jask-aran.com/healthz
```

Require `status: "ready"` and the expected 40-character SHA. If the release
is `latest`, a tag, `development`, or an older SHA, stop and fix deployment
provenance before measuring.

## Evidence checklist

Record the commit/release, target/origin, scenario, prompt identity (not its
contents), model, thinking level, bounds, command, exit status and report path.
For failures retain the focused test output and Playwright trace; for live
runs retain the redacted JSON and the public health response. A measurement is
not a regression claim until the same scenario has a comparable baseline.
