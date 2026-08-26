# Testing Conduit

Run authenticated and native browser tests against `http://127.0.0.1:4310`.
Run `npm` commands from `conduit-web/`.

## Local authentication

Mint a session without using the password:

```bash
# repository root
node scripts/conduit-auth.mjs mint-session \
  --user-agent <label> \
  --format <token|cookie|json|playwright> \
  --output /tmp/conduit-auth
```

- `token`: raw session token
- `cookie`: `conduit_session=...` for HTTP or browser cookie import
- `json`: token and session metadata
- `playwright`: Playwright `storageState` JSON
- Omit `--output` to write to stdout. Output files use mode `0600`.
- Agent Browser and Windows DevTools mint and install their own sessions.

## Browser surfaces

| Surface | Use |
| --- | --- |
| Agent Browser | authenticated navigation, accessibility, screenshots, ordinary UI QA |
| Playwright | deterministic fixtures, DOM/layout metrics, release canaries |
| Windows Chrome DevTools | headed native frame, compositor, GPU, paint, layout, console, and network profiling |

### Agent Browser

Initialize or restore an authenticated session:

```bash
curl -fsS http://127.0.0.1:4310/healthz
npm run qa:agent-browser
```

Use the session ID printed by the command:

```bash
npm run agent-browser:local -- --session <id> --restore snapshot -i -c
npm run agent-browser:local -- --session <id> --restore a11y
npm run agent-browser:local -- --session <id> --restore screenshot /tmp/conduit.png
npm run agent-browser:local -- --session <id> close
```

Commands available through `agent-browser:local`:

- Navigate: `open`, `back`, `forward`, `reload`, `wait`
- Inspect: `snapshot`, `read`, `get`, `is`, `find`, `a11y`, `console`, `errors`
- Interact: `click`, `dblclick`, `fill`, `type`, `press`, `keyboard`, `hover`, `focus`, `check`, `uncheck`, `select`, `drag`, `scroll`, `scrollintoview`
- Evidence: `screenshot`, `diff snapshot`
- Session: `close`
- Reference: `agent-browser skills get core --full`

### Playwright

Pre-built tests:

```bash
npm run test:browser:setpieces
npm run test:terminal-performance
npm run test:terminal-performance:throttled
npm run test:browser
```

Playwright selectors and modes:

```bash
npx playwright test --list
npx playwright test test/browser/app.spec.js
npx playwright test test/browser/app.spec.js:123
npx playwright test --grep "test name" --project desktop-chromium
npx playwright test --headed --workers 1
npx playwright test --debug
npx playwright test --last-failed
```

- Projects: `desktop-chromium`, `mobile-chromium`
- Main flags: `--grep`, `--project`, `--headed`, `--debug`, `--workers`, `--trace`, `--last-failed`, `--list`
- Reference: `npx playwright test --help`

For custom Playwright work against port 4310, create state at the repository
root and pass the file as Playwright `storageState`:

```bash
node scripts/conduit-auth.mjs mint-session \
  --user-agent conduit-playwright \
  --format playwright \
  --output /tmp/conduit-playwright.json
```

### Windows Chrome DevTools

Chrome uses the persistent profile `C:\Users\jaska\AppData\Local\Conduit\chrome-agent` and CDP port `9222`.

```bash
curl -fsS http://127.0.0.1:4310/healthz
node ../scripts/run-windows-chrome-devtools.mjs start
node ../scripts/run-windows-chrome-devtools.mjs cli list_pages
node ../scripts/run-windows-chrome-devtools.mjs cli new_page http://127.0.0.1:4310/
node ../scripts/run-windows-chrome-devtools.mjs cli take_snapshot
node ../scripts/run-windows-chrome-devtools.mjs cli performance_start_trace --autoStop --filePath /tmp/conduit-native.json.gz
node ../scripts/run-windows-chrome-devtools.mjs stop-cli
```

`stop-cli` leaves Chrome and its profile running. Agent Browser is not a native
performance surface.

Wrapper and `cli` commands:

- Lifecycle: `status`, `start`, `stop-cli`
- Pages: `list_pages`, `new_page`, `select_page`, `navigate_page`, `close_page`, `resize_page`
- Inspect: `take_snapshot`, `take_screenshot`, `evaluate_script`, `list_console_messages`, `get_console_message`, `list_network_requests`, `get_network_request`
- Interact: `click`, `click_at`, `hover`, `drag`, `fill`, `type_text`, `press_key`, `handle_dialog`, `upload_file`
- Performance: `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`, `lighthouse_audit`
- Memory: `take_heapsnapshot`, `get_heapsnapshot_summary`, `get_heapsnapshot_details`, `compare_heapsnapshots`
- Reference: `chrome-devtools --help` or `chrome-devtools <command> --help`

## Deterministic harnesses

```bash
npm run test:harness -- --help
npm run test:harness -- --profile high-tps --scenario local-high-tps
npm run test:harness:browser -- --help
npm run test:harness:browser -- --list-fixtures
npm run test:harness:browser -- --renderer incremark-synthetic --fixture table-cell-display-math
npm run test:harness:renderer -- --fixtures rich-markdown,table-cell-display-math --runs 2
```

- Transport profiles: `steady`, `burst`, `stall`, `high-tps`, `jitter`
- Transport controls: `--text`, `--chunk-size`, `--interval-ms`, `--burst-size`, `--stall-after`, `--stall-ms`, `--client-pause-after`, `--client-pause-ms`, `--seed`
- Browser flows: `stream`, `reconnect`
- Browser renderers: `marked-stable`, `marked`, `incremark`, `incremark-typewriter`, `incremark-synthetic`, `incremark-advanced`
- Browser controls: `--fixture`, `--profile`, `--pacing`, `--instrumentation`, `--paired-instrumentation`, `--chunk-size`, `--interval-ms`, `--seed`

## Other tests

```bash
npm run typecheck
npm run build
npm test
node --test test/<name>.test.js
npm run perf:live -- --target local --origin http://127.0.0.1:4310 --chat-id <id>

# repository root
./scripts/package-release.sh <commit>
./scripts/prove-deployment.sh
```

- `startConduitHarness()`: isolated HTTP, WebSocket, SSE, persistence, PTY, and Pi lifecycle tests
- `perf:live`: cost-bearing provider and deployed-path timing
- `/tmp`: temporary JSON, traces, screenshots, cookie files, and Playwright state
