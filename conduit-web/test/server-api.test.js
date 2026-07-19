import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(origin, child) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Conduit server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Conduit server did not become ready");
}

test("raw JSON uploads publish atomically through the durable chat route", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-server-api-"));
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const freshSessionFile = path.join(root, "pi", "sessions", "future.jsonl");
  const conduitPi = path.join(root, "conduit-pi");
  await fs.writeFile(conduitPi, `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("0.80.6"); process.exit(0); }
if (process.argv.includes("--help")) { console.log("--mode --session --append-system-prompt --skill --approve --no-approve"); process.exit(0); }
const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "get_state") process.stdout.write(JSON.stringify({
    id: command.id,
    type: "response",
    command: "get_state",
    success: true,
    data: { sessionFile: ${JSON.stringify(freshSessionFile)}, sessionId: "future-session" },
  }) + "\\n");
});
`);
  await fs.chmod(conduitPi, 0o755);
  const nativePi = path.join(root, "native-pi");
  await fs.writeFile(nativePi, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 0.80.10; exit 0; fi\nif [ \"$1\" = \"--help\" ]; then echo '--mode --session --append-system-prompt --skill --approve --no-approve'; exit 0; fi\nexit 1\n");
  await fs.chmod(nativePi, 0o755);
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: root,
      CONDUIT_HOST: "127.0.0.1",
      CONDUIT_PORT: String(port),
      CONDUIT_FILES_ROOT: path.join(root, "files"),
      CONDUIT_CATALOG_FILE: path.join(root, "conduit.json"),
      CONDUIT_SESSION_REGISTRY_FILE: path.join(root, "sessions.json"),
      CONDUIT_PREFERENCES_FILE: path.join(root, "preferences.json"),
      CONDUIT_PI_AGENT_DIR: path.join(root, "pi"),
      CONDUIT_PI_COMMAND: conduitPi,
      CONDUIT_NATIVE_PI_COMMAND: nativePi,
      CONDUIT_NATIVE_PI_AGENT_DIR: path.join(root, "native-agent"),
      CONDUIT_WORKSPACE_ALLOWLIST: root,
    },
  });

  try {
    await waitForServer(origin, child);
    const templatesResponse = await fetch(`${origin}/v0/templates`);
    assert.equal(templatesResponse.status, 200);
    const templateCatalog = await templatesResponse.json();
    assert.ok(templateCatalog.templates.some((item) => item.id === "chat"));
    assert.ok(templateCatalog.templates.some((item) => item.id === "workspace"));
    assert.ok(templateCatalog.templates.some((item) => item.id === "runtime"));
    assert.equal(templateCatalog.defaultTemplateId, "chat");
    assert.equal(templateCatalog.templates.find((item) => item.id === "runtime").defaultable, false);

    const installations = await (await fetch(`${origin}/v0/pi-installations`)).json();
    const isolatedInstallation = installations.installations.find((item) => item.id === "conduit-pinned");
    const hostInstallation = installations.installations.find((item) => item.id === "host-pi");
    assert.equal(isolatedInstallation.version, "0.80.6");
    assert.equal(isolatedInstallation.executablePath, conduitPi);
    assert.equal(isolatedInstallation.agentHome.path, path.join(root, "pi"));
    assert.equal(isolatedInstallation.models.access, "managed");
    assert.equal(hostInstallation.version, "0.80.10");
    assert.equal(hostInstallation.executablePath, nativePi);
    assert.equal(hostInstallation.models.access, "read-only");
    assert.equal("command" in installations.installations[0], false);
    assert.equal("environment" in installations.installations[1], false);

    const linkedResponse = await fetch(`${origin}/v0/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "linked", path: workspace }),
    });
    assert.equal(linkedResponse.status, 201);
    const linked = await linkedResponse.json();
    await fs.mkdir(path.join(workspace, ".pi", "themes"), { recursive: true });
    const preflight = await (await fetch(`${origin}/v0/workspaces/${linked.id}/native-preflight`)).json();
    assert.equal(preflight.available, true);
    assert.equal(preflight.version, "0.80.10");
    assert.equal(preflight.trustRequired, true);
    assert.ok(preflight.resources.includes("themes"));

    const nativeChatResponse = await fetch(`${origin}/v0/chats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: linked.id, runtimeKind: "native_pi" }),
    });
    assert.equal(nativeChatResponse.status, 201);
    const nativeChat = await nativeChatResponse.json();
    assert.equal(nativeChat.runtime.kind, "native_pi");
    assert.equal(nativeChat.runtime.installationId, "host-pi");

    const nativeMove = await fetch(`${origin}/v0/sessions/${nativeChat.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project_chat" }),
    });
    assert.equal(nativeMove.status, 409);
    assert.equal((await nativeMove.json()).error, "chat_move_not_supported");

    const isolatedSwitch = await fetch(`${origin}/v0/chats/${nativeChat.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: "chat", runtimeKind: "conduit_profile" }),
    });
    assert.equal(isolatedSwitch.status, 200);
    const isolatedChat = await isolatedSwitch.json();
    assert.equal(isolatedChat.templateId, "chat");
    assert.equal(isolatedChat.runtime.kind, "conduit_profile");
    assert.equal(isolatedChat.runtime.profileId, "chat");

    const invalidNative = await fetch(`${origin}/v0/chats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project_chat", runtimeKind: "native_pi" }),
    });
    assert.equal(invalidNative.status, 400);
    assert.equal((await invalidNative.json()).error, "native_pi_requires_workspace");

    const externalAgents = path.join(root, "external-agents");
    await fs.mkdir(path.join(externalAgents, "skills"), { recursive: true });
    await fs.symlink(externalAgents, path.join(workspace, ".agents"));
    const symlinkedPreflight = await fetch(`${origin}/v0/workspaces/${linked.id}/native-preflight`);
    assert.equal(symlinkedPreflight.status, 400);
    assert.equal((await symlinkedPreflight.json()).error, "native_resource_symlink");

    const runtimeDefault = await fetch(`${origin}/v0/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultTemplateId: "runtime" }),
    });
    assert.equal(runtimeDefault.status, 400);
    assert.equal((await runtimeDefault.json()).error, "special_template");

    const prefsPatch = await fetch(`${origin}/v0/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultTemplateId: "workspace" }),
    });
    assert.equal(prefsPatch.status, 200);
    assert.equal((await prefsPatch.json()).defaultTemplateId, "workspace");

    const createdResponse = await fetch(`${origin}/v0/chats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project_chat" }),
    });
    assert.equal(createdResponse.status, 201);
    const chat = await createdResponse.json();
    assert.equal(chat.status, "draft");
    assert.equal(chat.templateId, "workspace");
    assert.equal("piSessionId" in chat, false);

    const chatModels = await (await fetch(`${origin}/v0/chats/${chat.id}/models`)).json();
    assert.equal(chatModels.installationId, "conduit-pinned");
    assert.equal(chatModels.runtimeKind, "conduit_profile");
    assert.equal(chatModels.source, "runtime_default");
    const invalidModel = await fetch(`${origin}/v0/chats/${chat.id}/models`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "missing/model" }),
    });
    assert.equal(invalidModel.status, 400);
    assert.equal((await invalidModel.json()).error, "invalid_model");

    const switched = await fetch(`${origin}/v0/chats/${chat.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: "chat" }),
    });
    assert.equal(switched.status, 200);
    assert.equal((await switched.json()).templateId, "chat");

    const ordinaryRuntime = await fetch(`${origin}/v0/chats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project_chat", templateId: "runtime" }),
    });
    assert.equal(ordinaryRuntime.status, 400);
    assert.equal((await ordinaryRuntime.json()).error, "special_template");

    const runtimeChat = await fetch(`${origin}/v0/runtime/chats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(runtimeChat.status, 201);
    const runtimeChatBody = await runtimeChat.json();
    assert.equal(runtimeChatBody.templateId, "runtime");

    const runtimeSwitch = await fetch(`${origin}/v0/chats/${runtimeChatBody.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: "workspace" }),
    });
    assert.equal(runtimeSwitch.status, 409);
    assert.equal((await runtimeSwitch.json()).error, "special_chat_locked");

    const freshLive = await fetch(`${origin}/v0/live-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: chat.id, projectId: "project_chat" }),
    });
    assert.equal(freshLive.status, 201);
    assert.equal((await freshLive.json()).status, "running");
    await assert.rejects(fs.access(freshSessionFile), { code: "ENOENT" });

    const directory = path.join(root, "files", ".conduit", "chats", chat.id);
    await fs.access(path.join(directory, "attachments"));
    await fs.access(path.join(directory, ".partial"));

    const attachmentId = crypto.randomUUID();
    const body = Buffer.from('{"raw":true}\n');
    const uploaded = await fetch(`${origin}/v0/chats/${chat.id}/attachments/${attachmentId}?name=payload.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(uploaded.status, 201);
    assert.deepEqual(await fs.readdir(path.join(directory, ".partial")), []);
    assert.equal(await fs.readFile(path.join(directory, "attachments", `${attachmentId}--payload.json`), "utf8"), body.toString());

    const download = await fetch(`${origin}/v0/chats/${chat.id}/attachments/${attachmentId}`);
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.match(download.headers.get("content-disposition"), /^attachment;/);
    assert.equal(Buffer.from(await download.arrayBuffer()).toString(), body.toString());

    const imageId = crypto.randomUUID();
    const imageBody = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const imageUpload = await fetch(`${origin}/v0/chats/${chat.id}/attachments/${imageId}?name=preview.png`, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: imageBody,
    });
    assert.equal(imageUpload.status, 201);
    const preview = await fetch(`${origin}/v0/chats/${chat.id}/attachments/${imageId}?preview=1`);
    assert.equal(preview.headers.get("content-type"), "image/png");
    assert.match(preview.headers.get("content-disposition"), /^inline;/);
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), imageBody);

    const malformed = await fetch(`${origin}/v0/chats/${chat.id}/attachments/not-a-uuid?name=nope`, {
      method: "PUT", body: "nope",
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await fs.readdir(path.join(directory, ".partial")), []);

    const abortedId = crypto.randomUUID();
    await new Promise((resolve) => {
      const request = http.request(`${origin}/v0/chats/${chat.id}/attachments/${abortedId}?name=aborted.bin`, {
        method: "PUT",
        headers: { "content-length": 1024 * 1024 },
      });
      request.once("error", resolve);
      request.once("socket", (socket) => socket.once("connect", () => {
        request.write(Buffer.alloc(4096, 1));
        setTimeout(() => request.destroy(), 20);
      }));
    });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if ((await fs.readdir(path.join(directory, ".partial"))).length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.deepEqual(await fs.readdir(path.join(directory, ".partial")), []);
    assert.equal((await fs.readdir(path.join(directory, "attachments"))).some((name) => name.startsWith(abortedId)), false);

    const deleted = await fetch(`${origin}/v0/chats/${chat.id}/attachments/${attachmentId}`, { method: "DELETE" });
    assert.equal(deleted.status, 204);
    const imageDeleted = await fetch(`${origin}/v0/chats/${chat.id}/attachments/${imageId}`, { method: "DELETE" });
    assert.equal(imageDeleted.status, 204);
    const listed = await fetch(`${origin}/v0/chats/${chat.id}/attachments`).then((response) => response.json());
    assert.deepEqual(listed.attachments, []);
  } finally {
    if (child.exitCode == null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
