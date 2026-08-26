# Conduit

Conduit is a self-hosted, single-user web app for working with
[Pi coding agents](https://github.com/earendil-works/pi). It gives chats,
working files, Workspaces, attachments, and live agent sessions one
authenticated home accessibel on the web. Its goal is a durable,
personal control plane for agents that work across local and remote
environments.

## Features

- Persistent chats with attachments, forks, regeneration, queued prompts,
  model controls, and thinking controls.
- Workspaces that link a local folder, create a managed folder, or clone a Git
  repository. Each Workspace can have a custom icon and color.
- A Workspace panel with file previews, Git status, history and diffs, plus a
  server-owned terminal that survives browser navigation.
- Push-to-talk and toggle-based voice dictation through managed local Whisper
  and Parakeet tiers or first-class OpenAI, Deepgram, and Groq providers.
- A Docker deployment with automatic HTTPS and persistent data and Workspace
  mounts.

## Deploy

Requires a Linux VPS, a public hostname that points to it, and Docker Engine
with the Compose plugin. On Debian or Ubuntu, the installer can install Docker
when run as root.

```bash
curl -fsSL https://get.jask-aran.com/conduit | bash
```
Enter the public hostname and login password when prompted. Open the HTTPS URL
shown by the installer.

To update an existing deployment:

```bash
~/conduit/scripts/deploy.sh restart
```

See [deployment operations](docs/operations/deployment.md) for custom paths,
release pinning, backup, and restore.


## Start locally

Requires Node.js 22+ and npm.

```bash
bash .devcontainer/start-conduit.sh setup
node scripts/conduit-auth.mjs set-password
bash .devcontainer/start-conduit.sh restart
```

Open <http://127.0.0.1:4310>. Sign in, then open **Settings → Auth** to connect
a model provider.




## Repository map

```text
conduit-web/  Web server, client, API contract, and tests
templates/    Pi profiles, tools, and skills
scripts/      Authentication, deployment, backup, and release tools
docs/         Architecture, operations, and release documentation
```

Development guides:
- [Web runtime and API](conduit-web/README.md)
- [Deployment operations](docs/operations/deployment.md)
- [Runtime data](docs/operations/runtime-data.md)
- [Testing](docs/testing.md)
- [Contributing](CONTRIBUTING.md)
