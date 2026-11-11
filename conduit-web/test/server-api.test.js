import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/**
 * Read from the server itself: test files run at the same time, so a port
 * chosen in advance can be taken before the child binds it.
 */
function boundOrigin(child) {
  return new Promise((resolve, reject) => {
    let seen = "";
    const onData = (chunk) => {
      seen += chunk.toString();
      const match = seen.match(/listening on (http:\/\/\S+)/);
      if (!match) return;
      child.stdout.off("data", onData);
      resolve(match[1].replace("0.0.0.0", "127.0.0.1"));
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => reject(new Error(`Conduit server exited before it listened (${code})`)));
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
  const fakeGitDirectory = path.join(root, "fake-bin");
  const fakeGit = path.join(fakeGitDirectory, "git");
  const fakeGitMarker = path.join(root, "fake-git.pid");
  await fs.mkdir(fakeGitDirectory);
  await fs.writeFile(fakeGit, `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "--is-inside-work-tree" ]; then echo true; exit 0; fi
if [ "$1" = "status" ]; then echo $$ > "$FAKE_GIT_MARKER"; sleep 30; exit 0; fi
if [ "$1" = "branch" ]; then echo main; exit 0; fi
if [ "$1" = "log" ]; then exit 0; fi
if [ "$1" = "rev-parse" ]; then exit 1; fi
exit 0
`);
  await fs.chmod(fakeGit, 0o755);
  const workspace = path.join(root, "workspace");
  const workspaceParent = path.join(root, "workspace-parent");
  const home = path.join(root, "home");
  await fs.mkdir(home);
  await fs.mkdir(workspace);
  await fs.mkdir(workspaceParent);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CONDUIT_.*(?:ROOT|FILE|DIR|DIST|PATH|TEMPLATE|COMMAND)$/.test(key))),
      HOME: home,
      CONDUIT_DATA_ROOT: path.join(root, "data"),
      CONDUIT_ADVERTISE_ON_LAN: "false",
      CONDUIT_HOST: "127.0.0.1",
      CONDUIT_PORT: "0",
      CONDUIT_FILES_ROOT: path.join(root, "files"),
      CONDUIT_CATALOG_FILE: path.join(root, "conduit.json"),
      CONDUIT_SESSION_REGISTRY_FILE: path.join(root, "sessions.json"),
      CONDUIT_REMOTES_FILE: path.join(root, "remotes.json"),
      CONDUIT_PREFERENCES_FILE: path.join(root, "preferences.json"),
      CONDUIT_AUTH_FILE: path.join(root, "auth.json"),
      CONDUIT_PI_AGENT_DIR: path.join(root, "pi"),
      CONDUIT_WORKSPACE_ALLOWLIST: root,
      CONDUIT_WORKSPACE_DEFAULT_ROOT: workspaceParent,
      CONDUIT_WORKSPACE_SUGGESTION_ROOT: workspaceParent,
      PATH: `${fakeGitDirectory}:${process.env.PATH}`,
      FAKE_GIT_MARKER: fakeGitMarker,
    },
  });

  try {
    const origin = await boundOrigin(child);
    await waitForServer(origin, child);
    const nativeHealth = await fetch(`${origin}/healthz`, { headers: { origin: "https://localhost" } });
    assert.equal(nativeHealth.headers.get("access-control-allow-origin"), "https://localhost");
    const externalHealth = await fetch(`${origin}/healthz`, { headers: { origin: "https://example.com" } });
    assert.equal(externalHealth.headers.get("access-control-allow-origin"), null);
    const linkedResponse = await fetch(`${origin}/v0/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "linked", path: workspace }),
    });
    assert.equal(linkedResponse.status, 201);
    const linked = await linkedResponse.json();
    await fs.mkdir(path.join(workspace, "00-directory"));
    for (let index = 0; index < 500; index += 1) {
      await fs.writeFile(path.join(workspace, `file-${String(index).padStart(3, "0")}`), "content\n");
    }
    await fs.writeFile(path.join(workspace, "zzz-late"), "content\n");
    await fs.mkdir(path.join(workspace, ".conduit"), { recursive: true });
    await fs.symlink(path.join(workspace, "file-000"), path.join(workspace, "symlinked"));
    const treeResponse = await fetch(`${origin}/v0/projects/${linked.id}/tree`);
    assert.equal(treeResponse.status, 200);
    const tree = await treeResponse.json();
    assert.equal(tree.path, "");
    assert.equal(tree.entries.length, 500);
    assert.equal(tree.truncated, true);
    assert.equal(tree.entries.some((entry) => [".conduit", "symlinked"].includes(entry.name)), false);
    const nextTreeResponse = await fetch(`${origin}/v0/projects/${linked.id}/tree?after=${encodeURIComponent(tree.cursor)}`);
    assert.equal(nextTreeResponse.status, 200);
    const nextTree = await nextTreeResponse.json();
    assert.equal(nextTree.total, tree.total);
    assert.equal(nextTree.truncated, false);
    assert.equal(nextTree.cursor, null);
    assert.equal(new Set([...tree.entries, ...nextTree.entries].map((entry) => entry.path)).size, tree.total);
    assert.ok(nextTree.entries.some((entry) => entry.name === "zzz-late"));
    const diffRequest = http.get(`${origin}/v0/projects/${linked.id}/diff`);
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        await fs.access(fakeGitMarker);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    const gitPid = Number(await fs.readFile(fakeGitMarker, "utf8"));
    await new Promise((resolve) => {
      diffRequest.once("error", resolve);
      diffRequest.destroy();
    });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        process.kill(gitPid, 0);
        await new Promise((resolve) => setTimeout(resolve, 25));
      } catch {
        break;
      }
    }
    assert.throws(() => process.kill(gitPid, 0));
    assert.equal((await fetch(`${origin}/healthz`)).status, 200);
    const createdWorkspaceResponse = await fetch(`${origin}/v0/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "created", path: workspaceParent, directoryName: "new-workspace" }),
    });
    assert.equal(createdWorkspaceResponse.status, 201);
    const createdWorkspace = await createdWorkspaceResponse.json();
    assert.equal(createdWorkspace.origin, "created");
    assert.equal(createdWorkspace.deletesFilesOnRemove, false);
    const rejectedDelete = await fetch(`${origin}/v0/projects/${createdWorkspace.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "destroy_workspace", confirmation: "wrong name" }),
    });
    assert.equal(rejectedDelete.status, 400);
    const destructiveDelete = await fetch(`${origin}/v0/projects/${createdWorkspace.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "destroy_workspace", confirmation: createdWorkspace.name }),
    });
    assert.equal(destructiveDelete.status, 204);
    await assert.rejects(fs.access(createdWorkspace.path), { code: "ENOENT" });
    const prefsPatch = await fetch(`${origin}/v0/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultTemplateId: "test" }),
    });
    assert.equal(prefsPatch.status, 200);
    const createdResponse = await fetch(`${origin}/v0/chats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project_chat" }),
    });
    assert.equal(createdResponse.status, 201);
    const chat = await createdResponse.json();
    assert.equal(chat.status, "draft");
    assert.equal(chat.templateId, "test");
    assert.equal("piSessionId" in chat, false);

    const freshLive = await fetch(`${origin}/v0/live-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: chat.id, projectId: "project_chat", intent: "prompt" }),
    });
    assert.equal(freshLive.status, 201, await freshLive.clone().text());
    assert.equal((await freshLive.json()).status, "running");

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

    const deletedChat = await fetch(`${origin}/v0/sessions/${chat.id}`, { method: "DELETE" });
    assert.equal(deletedChat.status, 204);
  } finally {
    if (child.exitCode == null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
