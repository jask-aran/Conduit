import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

test("production image is pinned, unprivileged, read-only compatible, and self-checking", async () => {
  const dockerfile = await fs.readFile(path.join(root, "Dockerfile"), "utf8");
  assert.match(dockerfile, /^FROM node:24\.14\.0-bookworm-slim@sha256:[a-f0-9]{64}/m);
  assert.match(dockerfile, /AS client-build/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^STOPSIGNAL SIGTERM$/m);
  assert.match(dockerfile, /^HEALTHCHECK /m);
  assert.doesNotMatch(dockerfile, /:latest/);
});

test("Compose mounts the complete durable contract without host privileges", async () => {
  const compose = await fs.readFile(path.join(root, "compose.yaml"), "utf8");
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\n\s+- ALL/);
  assert.match(compose, /target: \/data/);
  assert.match(compose, /target: \/workspaces/);
  assert.match(compose, /CONDUIT_DATA_ROOT: \/data/);
  assert.match(compose, /CONDUIT_WORKSPACE_ALLOWLIST: \/workspaces/);
  assert.match(compose, /\$\{CONDUIT_BIND_ADDRESS:-127\.0\.0\.1\}/);
  assert.doesNotMatch(compose, /docker\.sock|privileged:/);
});

test("deployment and exact-commit packaging scripts remain executable", async () => {
  for (const relative of ["scripts/deploy.sh", "scripts/package-release.sh", "scripts/backup.sh", "scripts/restore.sh", "scripts/prove-deployment.sh"]) {
    const stats = await fs.stat(path.join(root, relative));
    assert.ok(stats.mode & 0o111, `${relative} must be executable`);
  }
});
