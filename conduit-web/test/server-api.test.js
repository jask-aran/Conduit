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
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      CONDUIT_HOST: "127.0.0.1",
      CONDUIT_PORT: String(port),
      CONDUIT_FILES_ROOT: path.join(root, "files"),
      CONDUIT_CATALOG_FILE: path.join(root, "conduit.json"),
      CONDUIT_SESSION_REGISTRY_FILE: path.join(root, "sessions.json"),
      CONDUIT_PI_AGENT_DIR: path.join(root, "pi"),
    },
  });

  try {
    await waitForServer(origin, child);
    const createdResponse = await fetch(`${origin}/v0/chats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project_chat" }),
    });
    assert.equal(createdResponse.status, 201);
    const chat = await createdResponse.json();
    assert.equal(chat.status, "draft");
    assert.equal("piSessionId" in chat, false);
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
