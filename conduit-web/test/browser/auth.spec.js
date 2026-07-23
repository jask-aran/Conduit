import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test as base, expect } from "@playwright/test";
import { AuthStore } from "../../src/auth-store.js";

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function fakePi(root) {
  const conduitPi = path.join(root, "conduit-pi");
  await fs.writeFile(conduitPi, `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("0.80.6"); process.exit(0); }
if (process.argv.includes("--help")) { console.log("--mode --session --append-system-prompt --skill --approve --no-approve"); process.exit(0); }
process.exit(0);
`);
  await fs.chmod(conduitPi, 0o755);
  const nativePi = path.join(root, "native-pi");
  await fs.writeFile(nativePi, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 0.80.10; exit 0; fi\nif [ \"$1\" = \"--help\" ]; then echo '--mode --session --append-system-prompt --skill --approve --no-approve'; exit 0; fi\nexit 1\n");
  await fs.chmod(nativePi, 0o755);
  return { conduitPi, nativePi };
}

async function spawnAuthServer({ password, host = "127.0.0.1" }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-browser-auth-"));
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const { conduitPi, nativePi } = await fakePi(root);
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const authFile = path.join(root, "auth.json");
  const store = new AuthStore(authFile);
  if (password) await store.setPassword(password);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: root,
      CONDUIT_HOST: host,
      CONDUIT_PORT: String(port),
      CONDUIT_FILES_ROOT: path.join(root, "files"),
      CONDUIT_CATALOG_FILE: path.join(root, "conduit.json"),
      CONDUIT_SESSION_REGISTRY_FILE: path.join(root, "sessions.json"),
      CONDUIT_PREFERENCES_FILE: path.join(root, "preferences.json"),
      CONDUIT_PI_AGENT_DIR: path.join(root, "pi"),
      CONDUIT_AUTH_FILE: authFile,
      CONDUIT_PI_COMMAND: conduitPi,
      CONDUIT_NATIVE_PI_COMMAND: nativePi,
      CONDUIT_NATIVE_PI_AGENT_DIR: path.join(root, "native-agent"),
      CONDUIT_WORKSPACE_ALLOWLIST: root,
    },
  });
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return { origin, child, root };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Auth server did not start");
}

async function stop(server) {
  if (server?.child?.exitCode == null) {
    server.child.kill("SIGTERM");
    await new Promise((resolve) => server.child.once("exit", resolve));
  }
  if (server?.root) await fs.rm(server.root, { recursive: true, force: true });
}

const test = base.extend({ server: async ({}, use) => {
  const server = await spawnAuthServer({ password: "fixture-pw" });
  await use(server);
  await stop(server);
}});

test.beforeEach(async ({ page, server }) => {
  // Mock the SPA's API surface so the Solid shell loads quickly after login.
  await page.route("**/v0/templates", (route) => route.fulfill({ json: { templates: [{
    id: "chat", label: "General", version: 1, defaultable: true, tools: ["read", "bash"],
  }], defaultTemplateId: "chat" } }));
  await page.route("**/v0/preferences", (route) => route.fulfill({ json: { defaultTemplateId: "chat" } }));
  await page.route("**/v0/workspaces/suggestions", (route) => route.fulfill({ json: { folders: [] } }));
  await page.route("**/v0/runtime/settings", (route) => route.fulfill({ json: { maxLiveProcesses: 12, maxGeneratingProcesses: 2, idleProcessTtlMs: 120_000, liveCount: 0, generatingCount: 0 } }));
  await page.route("**/v0/capabilities", (route) => route.fulfill({ json: { partialContinue: true, globalRuntime: "sse" } }));
  await page.route("**/v0/runtime", (route) => route.fulfill({ json: { type: "runtime_global_snapshot", processes: [], at: new Date().toISOString() } }));
  await page.route("**/v0/pi-installations", (route) => route.fulfill({ json: { installations: [
    { id: "conduit-pinned", label: "Isolated Pi", version: "0.80.6", available: true },
    { id: "host-pi", label: "Host Pi", version: "0.80.10", available: true },
  ] } }));
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [{
    id: "project_chat", slug: "chat", name: "Chats", sessions: [],
  }] } }));
  await page.route("**/v0/models?**", (route) => route.fulfill({ json: { models: [], defaultModel: null, defaultThinkingLevel: "off", requiresAuthentication: false } }));
  await page.route("**/v0/settings?**", (route) => route.fulfill({ json: { models: [], enabledModels: [], defaultModel: null } }));
});

test("unauthenticated visit lands on /login; wrong password surfaces an error", async ({ page, server }) => {
  await page.goto(server.origin, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(".login-card")).toHaveCSS("border-radius", "24px");
  await expect(page.locator(".login-card")).not.toHaveCSS("backdrop-filter", "none");
  await expect(page.locator(".login-card h1")).toHaveCSS("font-family", /Georgia/);
  await expect(page.getByLabel("Password")).toHaveCSS("border-radius", "14px");
  await page.getByLabel("Password").fill("fixture-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText(/Incorrect password/);
});

test("first-run browser setup warns clearly, claims the submitted password, and closes the app", async ({ page }) => {
  const server = await spawnAuthServer({ password: undefined, host: "0.0.0.0" });
  try {
    await page.goto(server.origin, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("alert")).toContainText(/first person able to submit this page can claim the instance/i);
    await page.getByLabel("Password").fill("first-run-password");
    await page.getByRole("button", { name: "Set password & sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`^${server.origin}/chat/[0-9a-f-]+$`));
  } finally {
    await stop(server);
  }
});

test("correct password reaches the app, reload stays authenticated, logout returns to /login", async ({ page, server, isMobile }) => {
  test.skip(isMobile, "sidebar footer is rendered behind the mobile sheet; covered by the desktop run");
  await page.goto(server.origin, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Password").fill("fixture-pw");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`^${server.origin}/chat/[0-9a-f-]+$`));
  const durableUrl = page.url();

  // Reload must remain authenticated and keep the same durable chat route.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(durableUrl);

  // Sign out from the sidebar footer surfaces the login screen again.
  await page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
