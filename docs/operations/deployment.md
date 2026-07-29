# Deployment contract

Conduit ships as one unprivileged application container with two explicit bind
mounts. The image contains the server, compiled client, templates, production
dependencies, and pinned Isolated Pi. It contains no credentials, transcripts,
workspace contents, or mutable application state.

## Host and container layout

The default relative paths produce the intended VPS layout when the release is
unpacked at `/srv/conduit`:

| Host path | Container path | Ownership |
| --- | --- | --- |
| `/srv/conduit/data` | `/data` | Conduit UID/GID; durable |
| `/srv/workspaces` | `/workspaces` | Conduit UID/GID; durable |
| release source and image | `/app` | read-only; replaceable |
| in-memory temporary files | `/tmp` | tmpfs; disposable |

`CONDUIT_DATA_ROOT=/data` is the single application-state boundary. It contains
the project and chat registries, preferences, runtime policy, password and
sessions, Isolated Pi settings/credentials/JSONL transcripts, chat working
files, and attachments. Clone reservations and atomic-write temporary files
also live there; they may be transient individually, but retaining the whole
root is the supported backup and restore contract.

Workspace contents live under `/workspaces`. Persisted workspace catalogue
paths use that container namespace rather than machine-specific host paths, so
the catalogue remains valid when both mounts are restored on another machine.
The default allowlist exposes only `/workspaces`; Conduit-owned chat files are
handled by their reserved project and cannot be registered as Workspaces.

Docker layers, npm caches, built client output, `/tmp`, logs emitted to stdout,
and stopped process memory are rebuildable. No live Pi process can be migrated;
after restore, Conduit resumes from its durable JSONL and registry state.

## First deployment

Requirements are Linux, Git, Docker Engine, and the Docker Compose plugin. No
host Node.js or Pi installation is required.

```bash
git clone https://github.com/jask-aran/Conduit.git conduit
cd conduit
./scripts/deploy.sh up
```

The script creates `.env` and the two host directories, builds the image, and
prompts for the single-user login password before starting the container. It
binds port 4310 to host loopback by default; put a TLS reverse proxy or
Tailscale Serve in front of `127.0.0.1:4310`.
The release directory must be owned by the account running Docker. Placing that
directory at `/srv/conduit` yields the layout above, but it is not required.

Edit `.env` before the first run when the release directory is not the desired
data location, the host user is not the intended file owner, or a different
loopback port is needed. Secrets are not environment variables: the password
hash, browser sessions, and Isolated Pi provider credentials remain inside the
mounted `/data` root.

Useful operations:

```bash
./scripts/deploy.sh status
./scripts/deploy.sh logs
./scripts/deploy.sh auth
./scripts/deploy.sh restart
./scripts/deploy.sh down
```

Compose runs the image read-only, drops every Linux capability, has no Docker
socket, and uses `no-new-privileges`; only `/data`, `/workspaces`, and tmpfs
`/tmp` are writable. Its health check calls the unauthenticated `/healthz`
readiness endpoint. SIGTERM first makes readiness fail, closes browser streams,
stops resident Pi children, and then closes the HTTP server.

## Exact-commit releases

Every Git commit is independently packageable:

```bash
./scripts/package-release.sh <commit-or-tag>
```

This creates `release/conduit-<version>-<short-sha>.tar.gz` and a SHA-256 file.
The archive contains exactly `git archive` output for that commit plus a small
release manifest. Its `.env.example`, image tag, OCI revision label, startup
log, and health response all carry the full commit SHA. The Node base image is
pinned by multi-platform digest, npm installs from `package-lock.json`, and the
bundled Pi packages remain exact versions.

Deploying a packaged release is the same two-step flow:

```bash
tar -xzf conduit-<version>-<short-sha>.tar.gz -C /srv
cd /srv/conduit-<version>-<short-sha>
./scripts/deploy.sh up
```

An upgrade builds another exact release against the same external data and
workspace directories, then replaces the application container. Schema changes
must remain forward-compatible or add an idempotent startup migration before
they are released; the current JSON stores already normalize their versioned
shape at load time and write atomically.

## Backup, restore, and migration

`backup.sh` makes a cold archive only. It refuses to run while the current
Compose project has a running container, then archives `.env`, `/data`, and
`/workspaces` as portable `data/` and `workspaces/` archive roots.

```bash
cd /srv/conduit
./scripts/deploy.sh down
./scripts/backup.sh /srv/conduit-backups
```

Each `*.tar.gz` has a sibling `*.tar.gz.manifest`. The manifest records the
release SHA, archive SHA-256, mode/UID/GID of each durable root, and SHA-256
checksums for every archived regular file. Keep the two files together. The
script needs only Bash, GNU tar, gzip, and standard coreutils in addition to
Docker Compose.

`restore.sh` has no overwrite mode. Unpack the exact release on the target,
leave its `data/` and adjacent `workspaces/` absent or empty, and restore the
archive before starting Conduit:

```bash
tar -xzf conduit-<version>-<short-sha>.tar.gz -C /srv
cd /srv/conduit-<version>-<short-sha>
./scripts/restore.sh /transfer/conduit-backup-<sha>-<time>.tar.gz
./scripts/deploy.sh up
```

Restore first verifies the archive SHA-256, archive layout, and every manifest
file checksum. It then refuses a running Compose project or non-empty target
`data/` or `workspaces/` roots. With no target `.env`, it restores the archived
one; an existing target `.env` is preserved so an operator can choose
independent target mount roots without overwriting configuration. The archive
retains numeric ownership, modes, ACLs, and xattrs; run it as the intended
owner, or as root when restoring original numeric owners. A failure after
publication is not automatically rolled back, so inspect the empty-target
preconditions and keep the original backup until the target has been verified.
Source and target must never write the same restored data concurrently.

## Local deployment proof

Run this from a clean, committed checkout with Docker Engine available:

```bash
./scripts/prove-deployment.sh
```

The harness owns its release directories, Compose project names, loopback
ports, test password, bind mounts, and cleanup. It packages the exact HEAD
release, starts isolated source host A, creates an authenticated session, draft
chat, attachment, Workspace and file, verifies the pinned Isolated Pi version,
rebuilds A with `deploy.sh restart`, cold-backs it up, restores it into
independent target host B mounts, and verifies the same identities and bytes.
It also asserts that Host Pi remains unavailable. Evidence is retained under
ignored `.deployment-evidence/`; temporary containers and mounts are removed
on success or failure.

This is a one-engine simulated-host proof, not a replacement for the required
source and target run on two real Linux VMs. Keep draft PR #43 draft and issue
#42 open until that acceptance run records both hosts' evidence.

## Runtime boundary

The container supports the bundled **Isolated Pi** runtime for ordinary chats
and managed Workspace sessions. It deliberately reports **Host Pi** as
unavailable: Native Pi means a host executable using the host toolchain and
filesystem, which cannot be preserved safely by mounting the host root, home,
Docker socket, or privileged capabilities into the web container.

A later host-runtime service can attach through a local Unix socket and map its
workspace roots into the stable `/workspaces` namespace. This deployment does
not create that bridge or expose an experimental network port, so the
application container can be replaced independently without constraining the
future runtime adapter.
