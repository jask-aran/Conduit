# Testing Conduit

Use the narrowest test surface that proves the changed behavior. Run commands
from `conduit-web/` unless they start with `./scripts` or
`.devcontainer/start-conduit.sh`. Never add a production-only test endpoint.
The managed app uses port 4310. The browser harness uses Vite on port 4173.
Use port 4310 for normal UI work so the operator can review the same app.
Use port 4173 only for a deterministic browser-harness row below.

## Choose one approach

| Behavior | Entry point | Evidence |
| --- | --- | --- |
| Types, bundle, PWA, pure stores/helpers | `npm run typecheck`; `npm run build`; `npm test` | exit status and test output |
| One Node contract | `node --test test/<name>.test.js` | focused assertions |
| Express, HTTP, WebSocket, SSE, Pi lifecycle | Node test with `startConduitHarness()` | public contracts and fake-Pi events |
| Token cadence, stalls, high TPS, slow readers | `npm run test:harness -- ...` | versioned transport JSON |
| Markdown, DOM, frames, layout, scroll, reconnect | `npm run test:harness:browser -- ...` | versioned browser JSON |
| Legacy immediate-renderer comparison | `npm run test:harness:renderer -- ...` | comparable renderer JSON |
| Authenticated UI and real browser state | `npm run qa:agent-browser` | snapshots, assertions, screenshots |
| Release browser canaries | `npm run test:browser:setpieces` | assertions and failure traces |
| Terminal/PTy performance | `npm run test:terminal-performance` | machine-specific timing |
| Real provider, TLS, reverse proxy, Internet path | `npm run perf:live -- ...` | redacted live-path JSON |
| Package, restart, backup/restore | `./scripts/package-release.sh`; `./scripts/prove-deployment.sh` | package and deployment proof |

Do not substitute rows. Each entry point proves only the behavior in its row.

## Rules and sandbox boundaries

- Use the operator-provided managed server on `127.0.0.1:4310`. Check
  `/healthz`; do not restart a healthy server. If it is absent, run `bash
  .devcontainer/start-conduit.sh restart` once with host permission because
  the launcher writes process state under `~/.conduit`. Use `dev` only for HMR.
  Do not launch `node src/server.js`, `npm run start`, or Vite directly.
- Server contracts and the transport harness start isolated production server
  processes. Do not point them at the managed server or repository `data/`.
- Browser fixtures use temporary state and mock the API unless they test the
  server boundary. Never mutate repository `data/` from a test.
- Start Codex from the trusted repository root. `.codex/config.toml` selects
  `:danger-full-access` for this trusted local project so server, Vite,
  browser, and CLI-daemon commands run on the host on the first attempt. Keep
  the normal approval policy; do not add a second retry with host permission.
- On `listen EPERM`, `setsockopt: Operation not permitted`, or a similar bind
  error, stop. The project profile did not load or the session is stale. Start
  a new Codex session from the repository root. Do not repeat the same command
  in a sandbox, test another port, inspect processes, or start Vite separately.
- Redirected output can leave the terminal empty. Read the report file before
  you classify the run as failed or repeat it.
- Use agent-browser for ordinary UI validation. Use Playwright for the
  deterministic renderer harness, named release canaries, terminal probes, and
  opt-in suite maintenance.
- Store temporary JSON and screenshots under `/tmp`. Never record or commit
  secrets, prompts, transcript bodies, cookies, credentials, `test-results/`,
  `dist/`, `data/`, or `node_modules/`.
- Pass a renderer explicitly when comparing renderers. The application default
  is `incremark-synthetic`; the browser-harness baseline is `marked`.
- Run additional fixtures only when they cover a different behavior. Do not
  repeat a passing scenario to obtain evidence already present in its report.

## Fast, server, and transport checks

Run the normal fast checks from `conduit-web/`:

```bash
npm run typecheck
npm run build
npm test
node --test test/<name>.test.js
```

For Express, WebSocket, SSE, persistence, or Pi lifecycle behavior, use a Node
test with `startConduitHarness()`. It runs the production server on an ephemeral
port and replaces only Pi with a controlled RPC peer. Assert public HTTP,
WebSocket, persisted JSONL, and child-process behavior; do not mock the server
function under test.

The deterministic transport harness measures server delivery without a browser
or provider:

```bash
npm run test:harness -- --scenario local-high-tps --profile high-tps --text "A deterministic streamed response" --client-pause-after 20 --client-pause-ms 250
```

Profiles are `steady`, `burst`, `stall`, `high-tps`, and `jitter`. The report
covers acceptance, first delta, completion, throughput, gap percentiles,
stalls/bursts, coalescing, and final-text parity. It does not measure DOM work.

## Deterministic browser renderer

This harness starts Vite on `127.0.0.1:4173` with
`VITE_CONDUIT_HARNESS=1` and uses deterministic HTTP, WebSocket, and
EventSource shims. It does not use port 4310, authentication, or Pi. The
project profile runs it with host access on the first attempt.

```bash
npm run test:harness:browser -- --list-fixtures
npm run test:harness:browser -- --renderer incremark-synthetic --fixture table-cell-display-math --profile steady --chunk-size 3 --require-typewriter-metrics
```

Renderer IDs are `marked-stable`, `marked`, `incremark`,
`incremark-typewriter`, and `incremark-synthetic`. Named fixtures own expected
semantic structure, security, interactions, geometry, and stability thresholds.
Reports summarize visible cadence, DOM mutation, frame gaps, Long Tasks, layout,
scroll, parser/KaTeX work, Typewriter backlog, and final parity. Use `--flow
reconnect` for reconnect behavior.

Use `--paired-instrumentation` to measure observer overhead. A passing report is
stdout JSON, not a trace. If output is redirected, inspect that file instead of
rerunning the fixture. This layer does not prove authentication, provider,
deployment, or the full server. Reports store salted text digests and lengths,
not prompt or transcript text.

The renderer benchmark compares only legacy immediate `marked` and `incremark`.
Do not use it to claim Typewriter or Synthetic performance:

```bash
npm run test:harness:renderer -- --fixtures rich-markdown,table-cell-display-math,math-stress --runs 2
```

## Authenticated browser QA

This is the default UI workflow. Verify the operator-provided managed server,
then run browser QA. Run QA and follow-up commands normally in Codex.

```bash
curl -fsS http://127.0.0.1:4310/healthz
cd conduit-web
agent-browser skills get core
agent-browser skills get dogfood
npm run qa:agent-browser
```

The QA command creates or restores a worktree session, waits for network idle,
and prints its ID. Use the auth vault or the restored session; never pass a
password in a command. Refresh the snapshot after page changes, prefer semantic
locators, and save evidence under `/tmp`.

```bash
npm run agent-browser:local -- --session <id> --restore snapshot -i -c
npm run agent-browser:local -- --session <id> --restore screenshot /tmp/conduit-qa.png
npm run agent-browser:local -- --session <id> close
```

The wrapper fixes the socket directory, limits navigation to local Conduit, and
rejects arbitrary evaluation, CDP attachment, network/storage, credentials,
file transfer, plugins, and multi-session actions. Do not use raw agent-browser
commands.

Agent-browser and Chrome DevTools CLI use separate browser sessions. Use
agent-browser for ordinary UI QA. Use the native CLI for traces, page
evaluation, console, network, and screenshots.

The official CLI bundles `puppeteer-core`, not a browser. Conduit's Playwright
setup already downloads Chrome for Testing, so use that binary. Do not install a
second Chrome package or add full `puppeteer` for this workflow.

For a WSL CLI session, run this bootstrap before any browser command. The
project profile already gives it host access. The CLI daemon is detached, but
Codex can reap detached processes when a shell command ends. Keep this
bootstrap and the following CLI commands in one persistent terminal, or run
the complete sequence in one command. Do not run `list_pages` first: that
would auto-start the default browser and can fail on the WSL filesystem.

```bash
export XDG_RUNTIME_DIR=/tmp/conduit-chrome-devtools
CHROME_DEVTOOLS_BROWSER="$(find "$HOME/.cache/ms-playwright" -path '*/chrome-linux64/chrome' -type f -perm -111 -print | sort -V | tail -n 1)"
test -x "$CHROME_DEVTOOLS_BROWSER"
# Keep this terminal open for the remaining native CLI commands.
chrome-devtools start \
  --executablePath "$CHROME_DEVTOOLS_BROWSER" \
  --userDataDir /tmp/conduit-chrome-devtools-profile \
  --headless
```

Then use the native CLI:

```bash
chrome-devtools status
chrome-devtools list_pages
chrome-devtools new_page http://127.0.0.1:4310/
chrome-devtools take_snapshot
chrome-devtools performance_start_trace --autoStop
chrome-devtools stop
```

If WSL must inspect the visible Windows Chrome session, use a dedicated Windows
Chrome instance with remote debugging on port `9222`, then connect with
`chrome-devtools start --browserUrl http://127.0.0.1:9222`. This requires WSL
mirrored networking or an SSH tunnel. Do not retry the Windows command through
the WSL NAT loopback when that port is unreachable; use the local WSL browser
above instead.

Use the deterministic browser harness for frame gaps and Long Tasks. Its
Playwright browser is a separate test surface from the native CLI session.

## Playwright and CI

Run browser commands normally under the project profile:

```bash
npm run test:browser:setpieces
npm run test:terminal-performance
npm run test:terminal-performance:throttled
npm run test:browser
```

Set-pieces are release canaries. The full suite is opt-in maintenance, not a
pre-commit gate. Failed runs retain traces and screenshots under
`test-results/`; do not commit them.

Pull requests and `main` run typecheck, build, Node tests, and one steady
transport scenario. Release tags run stable browser canaries. Browser harness,
renderer benchmark, agent-browser, live, terminal, and deployment tests are
manual.

## Managed, live, and deployment targets

For manual UI checks, use the existing managed server and verify health:

```bash
curl -fsS http://127.0.0.1:4310/healthz
```

Keep the launcher bind at `0.0.0.0` for Windows-to-WSL access. Use
`127.0.0.1:4310` as the client URL. Give candidate worktrees isolated temporary
state, then confirm port, PID, and health before testing.

`perf:live` is cost-bearing. It requires a healthy target with a full
40-character release SHA, an ordinary dedicated benchmark chat, controlled
model/thinking/output bounds, and secrets loaded outside shell history:

```bash
CONDUIT_RELEASE="$(git rev-parse HEAD)" bash .devcontainer/start-conduit.sh restart
export CONDUIT_PERF_PASSWORD='loaded from a protected secret'
export CONDUIT_PERF_PROMPT='Use the standard streaming baseline prompt.'
npm run perf:live -- \
  --target local \
  --origin http://127.0.0.1:4310 \
  --chat-id <dedicated-chat-id> > /tmp/conduit-live-local.json
unset CONDUIT_PERF_PASSWORD CONDUIT_PERF_PROMPT
```

For Internet testing, use the public HTTPS origin and a target such as
`vps-edge`. Default bounds are 60 seconds and 200,000 streamed characters.
Record the reason when you change `--timeout-ms` or `--max-chars`.

The live report measures provider/server delivery and persisted parity, not
browser frames. Pair it with the browser harness when rendering matters.

`npm run build` verifies bundle and PWA artifacts. The deployment script proves
one-engine, simulated two-host persistence; it does not replace a VPS test:

```bash
./scripts/package-release.sh <commit>
./scripts/prove-deployment.sh
```

Before public `perf:live`, check `https://conduit.jask-aran.com/healthz`.
Require `status: "ready"` and the expected 40-character SHA; otherwise stop.
See `docs/operations/deployment.md` for release, backup, restore, and public
deployment procedures.

## Evidence and comparison

Record the command, exit status, release, target, scenario, renderer or model,
bounds, and report path. Keep focused failure output and Playwright traces. For
live runs, keep redacted JSON and the public health response.

Compare only runs with the same fixture or prompt identity, renderer/model,
cadence, chunk size, seed, instrumentation, browser project, bounds, and
release. A measurement is not a regression claim until it has a comparable
baseline.

Keep claims separate: transport proves server delivery; fixtures prove client
rendering; agent-browser proves authenticated UI behavior; `perf:live` proves a
provider path; deployment proof verifies packaging and state.

When an already-required check emits useful metrics, carry one to three
headline observations into the commit body under `CONTRIBUTING.md`. Do not run
extra tests only to populate commit metrics. Keep ignored deployment proof
under `.deployment-evidence/`.
