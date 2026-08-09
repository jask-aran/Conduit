# Testing Conduit

Use the narrowest approach that proves the behavior. Run commands from
`conduit-web/` unless a command starts with `./scripts` or
`.devcontainer/start-conduit.sh`; never add a production-only test endpoint.
The managed server on port 4310 and the deterministic browser server on port
4173 are different test targets.

## Choose one approach

| Behavior | Approach | Entry point | Evidence |
| --- | --- | --- | --- |
| Types, bundle, PWA artifacts, pure stores and helpers | Static/unit | `npm run typecheck`; `npm run build`; `npm test`; `node --test test/<name>.test.js` for one file | exit status and test output |
| Express, HTTP, WebSocket, SSE, Pi lifecycle | Server contract | `node --test test/<name>.test.js`; use `startConduitHarness()` | public-contract assertions; fake Pi logs/events |
| Token cadence, coalescing, stalls, high TPS, slow readers | Deterministic transport | `npm run test:harness -- ...` | versioned JSON; no credentials/provider |
| Markdown rendering, DOM mutation, frames, layout, scroll, reconnect | Deterministic browser renderer | `npm run test:harness:browser -- ...` | versioned JSON; semantic/security and geometry assertions; Playwright failure trace |
| Immediate Marked/Incremark renderer comparison | Renderer benchmark | `npm run test:harness:renderer -- ...` | comparable JSON; currently a legacy two-renderer baseline |
| Authenticated UI workflows and site functionality | Agent-browser development QA | `npm run qa:agent-browser` | restored-session snapshots, semantic checks, screenshots, network and accessibility evidence |
| Release browser set-pieces | Playwright release canary | `npm run test:browser:setpieces` | repeatable assertions; screenshots/traces on failure |
| Terminal renderer and PTY performance | Explicit Playwright performance probe | `npm run test:terminal-performance`; add `:throttled` when needed | timing output; machine-specific thresholds |
| Real provider, release, TLS, reverse proxy, Internet path | Live transport | `npm run perf:live -- ...` | redacted JSON; release and content parity |
| Image/package/persistence deployment contract | Deployment proof | `./scripts/package-release.sh <commit>`; `./scripts/prove-deployment.sh` | package checksum and retained evidence |

Do not substitute one row for another: deterministic tests explain behavior;
live tests measure a deployed system; browser functionality tests prove UI
contracts; deployment proof proves packaging and state boundaries.

## Common rules

- Local server commands are managed: from the repository root run
  `bash .devcontainer/start-conduit.sh restart`; use `dev` only for Vite HMR.
  Do not launch `node src/server.js`, `npm run start`, or Vite directly.
- The server contract and deterministic transport harnesses start isolated
  production server processes themselves. Do not point them at the managed
  server or repository `data/`.
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
- Always pass a renderer explicitly to renderer comparisons. The application
  defaults to `incremark-synthetic`, while the browser harness defaults to
  `marked` for a stable baseline.

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
node --test test/live-harness.test.js
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

This harness measures server delivery only. It does not measure DOM mutations,
KaTeX work, layout shifts, scroll behavior, or animation frames.

## Deterministic browser renderer harness

The browser harness drives the production client source through deterministic
HTTP/WS/EventSource shims. It starts a Vite test server on port 4173 and does
not use the managed server on port 4310, real authentication, or a real Pi
process. The client is built with `VITE_CONDUIT_HARNESS=1`, which installs the
opt-in browser recorder.

Use it for Markdown rendering, renderer comparison, DOM identity, layout,
scroll, KaTeX, security, and reconnect performance:

```bash
npm run test:harness:browser -- \
  --renderer incremark-synthetic \
  --fixture table-cell-display-math \
  --profile steady \
  --chunk-size 3 \
  --require-typewriter-metrics
npm run test:harness:browser -- \
  --flow reconnect \
  --renderer incremark-typewriter \
  --initial-text "Answer survives" \
  --recovered-delta " reconnects"
npm run test:harness:browser -- --list-fixtures
```

The runner supports these renderer IDs:

```text
marked-stable
marked
incremark
incremark-typewriter
incremark-synthetic
```

`incremark-synthetic` includes the Typewriter queue and adds eager provisional
KaTeX previews. `--typewriter` is a compatibility alias that maps
`incremark` to `incremark-typewriter`.

The runner accepts the transport cadence profiles `steady`, `burst`, `stall`,
`high-tps`, and `jitter` through the shared cadence helper. The CLI help text
currently lists only the first, second, and fifth profiles; use the
implementation and fixture contracts as the source of truth for the other two
until the help text is aligned.

Named fixtures store source text, expected semantic structure, security and
interaction assertions, renderer-specific contracts, and stability thresholds
in `test/browser/helpers/streaming-fixtures.js`. Add a fixture when a bug or
accepted behavior needs repeatable source and final-state evidence. Do not put
provider prompts or transcript contents in reports.

The browser report includes:

- WebSocket and visible-text cadence.
- DOM mutation counts and mutation categories.
- Root replacement and removed-math-node evidence.
- Animation-frame gaps and Long Tasks.
- Layout-shift count/value.
- Table layout, structure, cell overflow, and geometry transitions.
- Math and rendered-block geometry reversals.
- Scroll writes and distance from the bottom.
- Semantic structure, security, interaction, and final-content parity.
- Renderer parse/reconcile/KaTeX timings and counters.
- Typewriter source/display progress, backlog, backlog age, adaptive rates,
  frame work, fallback mode, and terminal equality.

Reports carry salted text digests and lengths rather than raw prompts or
transcripts. Instrumented and uninstrumented paired runs quantify observer
overhead:

```bash
npm run test:harness:browser -- \
  --renderer incremark-synthetic \
  --fixture math-table-oscillation \
  --paired-instrumentation
```

The Typewriter terminal sample comes from the native transformer's
`onAllComplete` callback. Do not treat the last aggregated sample as terminal
when live and persisted projections can coexist.

The browser harness is the renderer investigation layer. It is not server,
authentication, provider, deployment, or full production-bundle proof.

## Renderer benchmark

`npm run test:harness:renderer` runs repeated deterministic browser probes and
emits one comparison report. Its current scope is the legacy immediate pair:
`marked` and `incremark`. It does not compare `marked-stable`,
`incremark-typewriter`, or `incremark-synthetic`.

Use it only for the scope it names:

```bash
npm run test:harness:renderer -- \
  --fixtures rich-markdown,table-cell-display-math,math-stress \
  --runs 2
```

For the current five-renderer set, run the browser harness separately for each
explicit renderer and use the same fixture, cadence, chunk size, seed,
instrumentation setting, and browser project. Do not use the legacy two-way
benchmark to claim a Synthetic or Typewriter improvement.

## Deterministic browser UI regression

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
- Use short, separate wrapper commands for multi-step flows and refresh
  snapshots after page changes.
- Use screenshots and `a11y` when they add evidence. Keep network inspection
  under Auto-review; the local wrapper rejects network commands.
- Store temporary evidence under `/tmp`; do not record credentials, cookies,
  prompts, or transcript contents.
- Run page actions through the local wrapper so every command uses the same
  writable browser socket directory:

```bash
npm run agent-browser:local -- --session <session-id-printed-by-qa> --restore snapshot -i -c
npm run agent-browser:local -- --session <session-id-printed-by-qa> --restore click @e1
npm run agent-browser:local -- --session <session-id-printed-by-qa> --restore screenshot /tmp/conduit-qa.png
```

The wrapper accepts local Conduit navigation and ordinary QA actions. It rejects
external URLs for `open`, `read`, and `a11y`, arbitrary `eval`, CDP attachment,
network, storage, cookie, auth, upload, download, plugin, and multi-session
commands. Keep those actions under Auto-review. The wrapper command also
remains under Auto-review because the policy cannot inspect page state or
resulting navigation; approve only local QA actions. If the browser reports a
separate Chrome or CDP host boundary, stop the local QA flow and request that
separate action under Auto-review; do not pass `--cdp` or similar options
through this wrapper. The wrapper also supplies a checked-in empty
agent-browser config and removes unsafe agent-browser environment overrides;
user and project config files cannot add startup actions to the local flow.

Close the session after use:

```bash
npm run agent-browser:local -- --session <session-id-printed-by-qa> close
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

CI has one automatic fast-check workflow and one release/set-piece browser
workflow:

- Pull requests and pushes to `main` run `typecheck`, `build`, all Node tests,
  and one steady deterministic transport harness scenario.
- Playwright set-pieces run manually or for `v*` release tags. The local
  `npm run test:browser:setpieces` command includes authentication. The GitHub
  release workflow uses `npm run test:browser:setpieces:ci`, which excludes the
  unstable auth canary and covers the command palette, primary chat route,
  live-stream reconnect, Workspace terminal entry route, and desktop/mobile PWA
  layout.
- The deterministic browser renderer harness, renderer benchmark,
  agent-browser QA, live provider measurement, terminal performance probes,
  and deployment proof are not automatic CI gates.
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

The terminal performance probes are separate and machine-sensitive:

```bash
npm run test:terminal-performance
npm run test:terminal-performance:throttled
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

## Commit metric handoff

Performance reports remain the detailed evidence source. When a build, check or
harness already run for the change emits useful quantitative data, carry only
the relevant headline observations into the commit body using the conventions
in `CONTRIBUTING.md`. Do not run an otherwise unnecessary build or harness just
to populate commit metrics, and do not copy the complete report into Git
history.

For an already-run `npm run build`, the standard bundle observations are:

- `bundle.initial_js_gzip_bytes`
- `bundle.initial_css_gzip_bytes`
- `bundle.largest_lazy_js_gzip_bytes`

For an already-run performance harness, preserve its scenario or flow and one
to three observations that describe the boundary under test—for example
transport cadence/coalescing, browser frame health, reconnect recovery, or live
path latency. Include a correctness/parity observation when it materially
qualifies the performance result. These headline values are historical
observations; the structured harness report remains the richer evidence.

## Comparison rules and known limits

Use the same fixture, renderer contract, cadence profile, chunk size, seed,
browser project, instrumentation setting, and release when comparing runs.
Use the same prompt identity, model, thinking level, and output bounds for live
transport comparisons.

Keep these claims separate:

- Deterministic transport proves server delivery and coalescing behavior.
- Deterministic browser probes prove client rendering and report browser work.
- Agent-browser proves the authenticated product flow on the managed server.
- `perf:live` measures real provider/server transport and persisted-content
  parity, not DOM rendering.
- Deployment proof verifies packaging, restart, backup/restore, and state
  boundaries, not provider or browser performance.

Do not treat a passing deterministic fixture as proof that every real model
stream is smooth. The named fixtures provide controlled regression coverage;
agent-browser remains the check for browser behavior that depends on real
layout, browser state, authentication, or a real session.

The renderer harness and fixture contracts are intentionally renderer-specific.
Marked Stable does not use the Incremark table projection, Typewriter adds the
adaptive display queue, and Synthetic adds provisional KaTeX previews. Compare
their final semantic/security output and stability metrics under separate
contracts. Do not use the legacy `marked` versus `incremark` benchmark to claim
performance for Typewriter or Synthetic.

## Evidence checklist

Record the commit/release, target/origin, scenario, prompt identity (not its
contents), model, thinking level, bounds, command, exit status and report path.
For failures retain the focused test output and Playwright trace; for live
runs retain the redacted JSON and the public health response. A measurement is
not a regression claim until the same scenario has a comparable baseline. Keep
temporary harness JSON under `/tmp`; keep ignored deployment proof under
`.deployment-evidence/`; never commit prompts, transcript bodies, cookies,
credentials, `test-results/`, `dist/`, `data/`, or `node_modules/`.
