import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

test("production image is pinned, unprivileged, read-only compatible, and self-checking", async () => {
  const dockerfile = await fs.readFile(path.join(root, "Dockerfile"), "utf8");
  assert.match(dockerfile, /^FROM node:24\.14\.0-bookworm-slim@sha256:[a-f0-9]{64}/m);
  assert.match(dockerfile, /AS client-build/);
  assert.match(dockerfile, /AS dependency-build-base/);
  assert.match(dockerfile, /g\+\+ make python3/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^STOPSIGNAL SIGTERM$/m);
  assert.match(dockerfile, /^HEALTHCHECK /m);
  assert.doesNotMatch(dockerfile, /:latest/);
});

test("Compose pulls GHCR by default and mounts the complete durable contract", async () => {
  const compose = await fs.readFile(path.join(root, "compose.yaml"), "utf8");
  assert.match(compose, /ghcr\.io\/jask-aran\/conduit/);
  assert.doesNotMatch(compose, /^\s+build:/m);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\n\s+- ALL/);
  assert.match(compose, /target: \/data/);
  assert.match(compose, /target: \/workspaces/);
  assert.match(compose, /CONDUIT_DATA_ROOT: \/data/);
  assert.match(compose, /CONDUIT_WORKSPACE_ALLOWLIST: \/workspaces/);
  assert.match(compose, /expose:\n\s+- "4310"/);
  assert.match(compose, /caddy:/);
  assert.match(compose, /"80:80"/);
  assert.match(compose, /"443:443"/);
  assert.doesNotMatch(compose, /docker\.sock|privileged:/);
});

test("published image health identity remains the full source commit", async () => {
  const compose = await fs.readFile(path.join(root, "compose.yaml"), "utf8");
  const workflow = await fs.readFile(path.join(root, ".github/workflows/publish-container.yml"), "utf8");
  assert.doesNotMatch(compose, /^\s+CONDUIT_RELEASE:/m);
  assert.match(workflow, /echo "release=\$GITHUB_SHA"/);
});

test("source builds are an explicit Compose override", async () => {
  const override = await fs.readFile(path.join(root, "compose.build.yaml"), "utf8");
  assert.match(override, /^\s+build:/m);
  assert.match(override, /dockerfile: Dockerfile/);
});

test("clone-free installer downloads only deployment artifacts", async () => {
  const installer = await fs.readFile(path.join(root, "scripts/install.sh"), "utf8");
  assert.match(installer, /raw\.githubusercontent\.com/);
  assert.match(installer, /fetch compose\.yaml/);
  assert.match(installer, /exec \.\/scripts\/deploy\.sh up/);
  assert.doesNotMatch(installer, /git clone/);
});

test("deployment and exact-commit packaging scripts remain executable", async () => {
  for (const relative of ["scripts/deploy.sh", "scripts/package-release.sh", "scripts/backup.sh", "scripts/restore.sh", "scripts/prove-deployment.sh"]) {
    const stats = await fs.stat(path.join(root, relative));
    assert.ok(stats.mode & 0o111, `${relative} must be executable`);
  }
});
