# Conduit

![architecture](interface_first_platform_architecture.svg)

Conduit is an interface-first personal agent platform. The long-term thesis is
that an agent session is the common primitive while its interface, execution
target, harness, tools, and autonomy posture can vary.

The repository is currently at **Phase 0: evaluate the Pi web-chat experience**.
It contains two implementations side-by-side so we can use a working system now,
compare ownership models, and decide what Conduit should build next.

## Current state

| Folder | What it is | State | Use it for |
| --- | --- | --- | --- |
| [`phase-0-pi-web`](phase-0-pi-web) | PI WEB used as the complete application | **Recommended default** | Real daily evaluation |
| [`phase-0-custom`](phase-0-custom) | Conduit-owned `pi --mode rpc` runtime and minimal chat UI | Reference prototype | Evaluating the alternative process-ownership boundary |

PI WEB currently gives us the larger working product surface: persistent
sessions, projects, workspaces, model selection, tool output, files, terminals,
multiple agents, and remote machines. The custom implementation demonstrates
what it would mean for Conduit itself to spawn and own one Pi RPC process per
chat.

The original custom-app checkout lived in transient storage and was not
recoverable when this repository was prepared. `phase-0-custom` is a faithful
reconstruction of the implemented lifecycle, HTTP endpoints, session discovery,
and JSONL bridge—not a byte-for-byte archive.

## Recommended evaluation setup

Run PI WEB inside WSL2 Ubuntu, where Pi is already installed and authenticated.
Open it from the Windows browser through WSL's localhost forwarding.

### Fastest path: private GitHub Codespace

For a disposable web-accessible evaluation environment, create a Codespace from
the branch containing this README:

<https://codespaces.new/jask-aran/Conduit?quickstart=1>

The included devcontainer automatically:

- creates a Node.js 22 Debian environment;
- installs native build tools;
- installs Pi `0.80.6` from its official npm package;
- installs the pinned PI WEB dependency;
- starts the PI WEB session daemon and web server;
- forwards port `8504` as **Conduit · PI WEB**.

When setup finishes, use the Codespace terminal for the only credential-bearing
step:

```text
pi
/login
```

Choose the desired provider and complete its browser authentication. Exit Pi,
then restart PI WEB so it reloads the authenticated model registry:

```bash
bash .devcontainer/start-pi-web.sh restart
```

Open the forwarded **Conduit · PI WEB** port from the Codespace's Ports panel.
The forwarded port is private to your GitHub account by default; keep it private.

The Codespace is an evaluation host, not an always-on VPS. Its filesystem and Pi
authentication persist while the Codespace exists, but agents do not continue
running while GitHub has stopped the Codespace. PI WEB restarts automatically
when the Codespace starts again.

### Prerequisites

- WSL2 with Ubuntu;
- Node.js 22 or newer and npm;
- `git`;
- Pi Coding Agent installed as `pi`;
- Pi already authenticated with at least one usable model;
- build tools for native Node modules (`build-essential` and Python).

Check the environment:

```bash
node --version
npm --version
git --version
pi --version
pi
```

Start and exit an ordinary Pi session once before installing PI WEB. This proves
that authentication, model discovery, shell startup, and Pi's state directory all
work independently of Conduit.

On Ubuntu, install native build prerequisites if they are missing:

```bash
sudo apt update
sudo apt install -y build-essential python3
```

## Install the recommended PI WEB version

```bash
git clone https://github.com/jask-aran/Conduit.git
cd Conduit/phase-0-pi-web
npm install
```

This checkout pins `@jmfederico/pi-web` to `1.202607.0` so the evaluation is
repeatable.

### Option A: WSL2 with systemd

Check whether systemd is active:

```bash
systemctl --user status
```

If that succeeds, install PI WEB as two per-user services:

```bash
npm run install:service
npm run doctor
npm run status
```

Open <http://127.0.0.1:8504> in the Windows browser.

To keep the user services running across logout or reboot:

```bash
sudo loginctl enable-linger "$USER"
```

If WSL reports that systemd is not running, either use Option B or enable systemd
in `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

Then run `wsl --shutdown` from Windows PowerShell and reopen Ubuntu.

### Option B: WSL2 without systemd

The repository includes a launcher that supervises the PI WEB session daemon and
web server as two child processes:

```bash
npm run verify
npm run dev
```

Open <http://127.0.0.1:8504>. Keep the terminal open during evaluation. Ctrl-C
stops both processes cleanly.

### If localhost forwarding is unavailable

Find the WSL address with `hostname -I` and use the first address with port 8504.
Do not bind PI WEB to `0.0.0.0` on an untrusted network. For access from another
machine, prefer an SSH tunnel, private VPN address, or authenticated reverse
proxy.

## First PI WEB evaluation

Use a disposable or clean Git repository for the first run.

1. Open PI WEB and add the repository as a project.
2. Select the project folder or create a git worktree.
3. Start a Pi session.
4. Confirm that the expected authenticated models are available.
5. Send a small request that reads files and another that edits a file.
6. Observe streaming, tool calls, cost/context information, and changed files.
7. Close the browser while a session is running, reopen it, and resume the same
   session.
8. Start a second session and confirm both remain independently usable.
9. Restart only the PI WEB web service and confirm `sessiond` keeps the agent
   session alive.
10. Try the interface from a phone or second browser through a trusted connection.

The evaluation is successful when PI WEB is comfortable enough to use for real
work and process/session persistence behaves as promised.

## Evaluate the custom runtime

The custom implementation is intentionally much smaller. It is useful for
testing whether Conduit should directly own Pi RPC processes, not for comparing
feature polish with PI WEB.

```bash
cd ../phase-0-custom
cp .env.example .env.local
npm install
npm test
npm start
```

Open <http://127.0.0.1:4310>, create a chat, and send a prompt. Then close and
reopen the browser. The server-owned Pi process should not terminate merely
because the WebSocket disconnected.

The reconstructed implementation has not yet completed a real authenticated Pi
round-trip on the target WSL2 host. Its tests currently cover stable session IDs,
nested Pi session discovery, and rejection of path-like user input.

## What to record during evaluation

Keep notes against these questions rather than making the next architectural
decision from the feature list alone.

### Product experience

- Is PI WEB's chat experience good enough to become the daily Conduit interface?
- Which screens or workflows feel essential, distracting, or missing?
- Do projects, workspaces, files, terminals, and sessions match the way you work?
- Does mobile supervision feel genuinely useful?

### Runtime ownership

- Does PI WEB's `sessiond` recover cleanly from browser and web-server restarts?
- Can multiple long-running sessions be trusted without manual babysitting?
- Are logs, failure states, cancellation, and reconnection understandable?
- Is there a concrete capability that requires Conduit to own `pi --mode rpc`
  directly?

### Extensibility

- Can a PI WEB browser plugin supply the first Conduit-specific UI additions?
- Are its machine and fleet concepts sufficient for the next remote-runtime step?
- Can Conduit observe or translate session events without patching core PI WEB?
- Which required behavior is blocked by an internal or unstable PI WEB API?

### State and portability

- Where are projects, session history, configuration, and credentials stored?
- Can the state be backed up and restored predictably?
- Which state belongs to Pi/PI WEB, and what future metadata must Conduit own?
- Can a session be handed to another machine or harness with useful continuity?

### Security

- Is loopback/private-network access sufficient for current use?
- What authentication is needed before exposing a gateway beyond one trusted user?
- Are allowed filesystem roots and machine credentials understandable and narrow?

## Decision after evaluation

Choose the next direction based on observed constraints:

| Finding | Likely next step |
| --- | --- |
| PI WEB is good enough and its plugin/API seams cover near-term needs | Keep PI WEB as Phase 0 and add Conduit capabilities beside it |
| PI WEB is good, but a few workflows are missing | Build isolated PI WEB plugins or maintain a shallow fork |
| PI WEB's UI is good but its runtime boundary blocks required control | Keep or adapt the UI while introducing a Conduit runtime adapter |
| PI WEB's UI and domain model both conflict with the desired interface | Promote the custom runtime experiment and build the first-party app |
| Remote machines work well | Reuse PI WEB's fleet model before building a separate target daemon |
| Remote or cross-harness requirements cannot fit PI WEB | Define the normalized event and runtime contracts, then add a second adapter |

Do not start the general control broker, plugin marketplace, cross-harness
orchestration, platform memory, or VPS management merely because they appear in
the long-term architecture. The next build should answer a limitation observed
during this evaluation.

## Architectural boundary

PI WEB is the Phase 0 product, not Conduit's permanent platform contract.

- Pi and PI WEB remain authoritative for Pi history and live process state.
- PI WEB project, workspace, session, and machine IDs are runtime references—not
  universal Conduit identities.
- PI WEB's database and WebSocket protocol are implementation details.
- Future Conduit identity, lineage, normalized events, portable state, approvals,
  grants, and long-term memory must remain separate.
- A later runtime adapter may translate PI WEB into the platform contract; Phase 0
  does not need to implement that abstraction prematurely.

## Known limitations

- The custom app is reconstructed rather than byte-identical to the transient
  original.
- A full PI WEB native-module install could not run in the build sandbox because
  `node-pty` header extraction attempted unsupported ownership changes. The npm
  dependency graph and lockfile resolved successfully; WSL2 remains the intended
  verification environment.
- No real authenticated model round-trip has been verified from this repository
  on the target WSL2 installation yet.
- Neither implementation should be exposed directly to the public internet.

## Useful commands

From `phase-0-pi-web`:

```bash
npm run doctor
npm run status
npm run dev
```

From `phase-0-custom`:

```bash
npm test
npm start
```

Upstream PI WEB documentation: <https://pi-web.dev/>  
Upstream source: <https://github.com/jmfederico/pi-web>
