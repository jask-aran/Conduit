import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { localCookie } from "../../scripts/conduit-local-auth.mjs";
import { AuthStore } from "../src/auth-store.js";

const authCli = fileURLToPath(new URL("../../scripts/conduit-auth.mjs", import.meta.url));

test("mint-session creates a caller-labeled token without a password", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-mint-"));
  const authFile = path.join(root, "auth.json");
  const store = new AuthStore(authFile);
  await store.setPassword("fixture-pw");
  const result = spawnSync(process.execPath, [authCli, "mint-session", "--json", "--user-agent", "test-agent"], {
    encoding: "utf8",
    env: { ...process.env, CONDUIT_AUTH_FILE: authFile },
  });
  assert.equal(result.status, 0, result.stderr);
  const minted = JSON.parse(result.stdout);
  assert.equal(minted.userAgent, "test-agent");
  assert.equal(typeof minted.token, "string");
  assert.ok(minted.token.length > 20);
  assert.equal(minted.sessionCount, 1);
  assert.equal((await store.findSession(minted.token)).userAgent, "test-agent");
  await fs.rm(root, { recursive: true, force: true });
});

test("mint-session writes mode-0600 Playwright storage state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-playwright-auth-"));
  const authFile = path.join(root, "auth.json");
  const output = path.join(root, "state.json");
  const store = new AuthStore(authFile);
  await store.setPassword("fixture-pw");
  await fs.writeFile(output, "old", { mode: 0o644 });
  const result = spawnSync(process.execPath, [
    authCli,
    "mint-session",
    "--format", "playwright",
    "--output", output,
    "--user-agent", "conduit-playwright",
  ], {
    encoding: "utf8",
    env: { ...process.env, CONDUIT_AUTH_FILE: authFile },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  const state = JSON.parse(await fs.readFile(output, "utf8"));
  assert.deepEqual(state.cookies[0], localCookie(state.cookies[0].value));
  assert.equal((await store.findSession(state.cookies[0].value)).userAgent, "conduit-playwright");
  assert.equal((await fs.stat(output)).mode & 0o777, 0o600);
  await fs.rm(root, { recursive: true, force: true });
});

test("mint-session refuses when no password is configured", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-mint-empty-"));
  const result = spawnSync(process.execPath, [authCli, "mint-session"], {
    encoding: "utf8",
    env: { ...process.env, CONDUIT_AUTH_FILE: path.join(root, "auth.json") },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No Conduit password/);
  await fs.rm(root, { recursive: true, force: true });
});
