import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sessionDirectoryFor } from "../src/session-store.js";

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
  const freshSessionFile = path.join(sessionDirectoryFor(path.join(root, "files"), path.join(root, "pi", "model-profiles", "brave-search")), "future.jsonl");
  const conduitPi = path.join(root, "conduit-pi");
  await fs.writeFile(conduitPi, `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("0.84.1"); process.exit(0); }
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
      ...process.env,
      HOME: home,
      CONDUIT_HOST: "127.0.0.1",
      CONDUIT_PORT: String(port),
      CONDUIT_FILES_ROOT: path.join(root, "files"),
      CONDUIT_CATALOG_FILE: path.join(root, "conduit.json"),
      CONDUIT_SESSION_REGISTRY_FILE: path.join(root, "sessions.json"),
      CONDUIT_REMOTES_FILE: path.join(root, "remotes.json"),
      CONDUIT_PREFERENCES_FILE: path.join(root, "preferences.json"),
      CONDUIT_AUTH_FILE: path.join(root, "auth.json"),
      CONDUIT_PI_AGENT_DIR: path.join(root, "pi"),
      CONDUIT_PI_COMMAND: conduitPi,
      CONDUIT_NATIVE_PI_COMMAND: nativePi,
      CONDUIT_NATIVE_PI_AGENT_DIR: path.join(root, "native-agent"),
      CONDUIT_WORKSPACE_ALLOWLIST: root,
      CONDUIT_WORKSPACE_DEFAULT_ROOT: workspaceParent,
      CONDUIT_WORKSPACE_SUGGESTION_ROOT: workspaceParent,
      PATH: `${fakeGitDirectory}:${process.env.PATH}`,
      FAKE_GIT_MARKER: fakeGitMarker,
    },
  });

  try {
    await waitForServer(origin, child);
    const nativeHealth = await fetch(`${origin}/healthz`, { headers: { origin: "https://localhost" } });
    assert.equal(nativeHealth.headers.get("access-control-allow-origin"), "https://localhost");
    const externalHealth = await fetch(`${origin}/healthz`, { headers: { origin: "https://example.com" } });
    assert.equal(externalHealth.headers.get("access-control-allow-origin"), null);
    const workspacePolicy = await fetch(`${origin}/v0/workspaces/policy`).then((response) => response.json());
    assert.deepEqual(workspacePolicy.defaultRoot, workspaceParent);
    assert.deepEqual(workspacePolicy.defaultInputPath, workspaceParent);
    assert.deepEqual(workspacePolicy.suggestionRoot, workspaceParent);
    await fs.mkdir(path.join(workspaceParent, "existing-repo"));
    const workspaceSuggestions = await fetch(`${origin}/v0/workspaces/suggestions`).then((response) => response.json());
    assert.equal(workspaceSuggestions.defaultInputPath, workspaceParent);
    assert.deepEqual(workspaceSuggestions.folders, [{
      name: "existing-repo",
      path: path.join(workspaceParent, "existing-repo"),
      displayPath: path.join(workspaceParent, "existing-repo"),
    }]);
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
    assert.equal(isolatedInstallation.version, "0.84.1");
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
    assert.equal(linked.defaultTemplateId, null);
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
    assert.equal(tree.entries[0].name, "00-directory");
    assert.deepEqual([...tree.entries].sort((left, right) => left.type === right.type ? left.name.localeCompare(right.name) : left.type === "directory" ? -1 : 1), tree.entries);
    assert.equal(tree.entries.some((entry) => [".conduit", "symlinked"].includes(entry.name)), false);
    const managedFilePath = path.join(workspace, "00-directory", "managed.txt");
    await fs.writeFile(managedFilePath, "before\n");
    const managedFileUrl = `${origin}/v0/projects/${linked.id}/file?path=00-directory%2Fmanaged.txt`;
    const managedPreview = await (await fetch(managedFileUrl)).json();
    assert.equal(managedPreview.content, "before\n");
    assert.equal(typeof managedPreview.modifiedAt, "number");
    const managedMetadata = await (await fetch(`${managedFileUrl}&metadata=1`)).json();
    assert.deepEqual(managedMetadata, { path: "00-directory/managed.txt", size: 7, modifiedAt: managedPreview.modifiedAt });
    const replacedFile = await fetch(managedFileUrl, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "if-match": "*" },
      body: "after\n",
    });
    assert.equal(replacedFile.status, 200);
    assert.equal((await (await fetch(managedFileUrl)).json()).content, "after\n");
    assert.equal((await fetch(managedFileUrl, { method: "DELETE" })).status, 204);
    await assert.rejects(fs.access(managedFilePath), { code: "ENOENT" });
    const rejectedDirectoryDelete = await fetch(`${origin}/v0/projects/${linked.id}/file?path=00-directory`, { method: "DELETE" });
    assert.equal(rejectedDirectoryDelete.status, 400);
    assert.equal((await rejectedDirectoryDelete.json()).error, "path_not_file");
    const createdDirectory = await fetch(`${origin}/v0/projects/${linked.id}/directory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "00-directory/nested" }),
    });
    assert.equal(createdDirectory.status, 201);
    assert.deepEqual(await createdDirectory.json(), { path: "00-directory/nested" });
    const movableFileUrl = `${origin}/v0/projects/${linked.id}/file?path=00-directory%2Fmove-me.txt`;
    assert.equal((await fetch(movableFileUrl, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: "move\n",
    })).status, 201);
    const movedEntry = await fetch(`${origin}/v0/projects/${linked.id}/entry`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "00-directory/move-me.txt", destination: "00-directory/nested/moved.txt" }),
    });
    assert.equal(movedEntry.status, 200);
    assert.deepEqual(await movedEntry.json(), {
      path: "00-directory/move-me.txt",
      destination: "00-directory/nested/moved.txt",
      type: "file",
    });
    assert.equal(await fs.readFile(path.join(workspace, "00-directory", "nested", "moved.txt"), "utf8"), "move\n");
    const renamedDirectory = await fetch(`${origin}/v0/projects/${linked.id}/entry`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "00-directory/nested", destination: "00-directory/archive" }),
    });
    assert.equal(renamedDirectory.status, 200);
    assert.equal((await renamedDirectory.json()).type, "directory");
    assert.equal((await fetch(`${origin}/v0/projects/${linked.id}/directory?path=00-directory%2Farchive`, { method: "DELETE" })).status, 204);
    await assert.rejects(fs.access(path.join(workspace, "00-directory", "archive")), { code: "ENOENT" });
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
    const previewResponse = await fetch(`${origin}/v0/workspaces/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "created", path: workspaceParent, directoryName: "new-workspace" }),
    });
    assert.equal(previewResponse.status, 200);
    assert.equal((await previewResponse.json()).path, path.join(workspaceParent, "new-workspace"));
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
    await fs.mkdir(path.join(workspace, ".pi", "themes"), { recursive: true });
    const preflight = await (await fetch(`${origin}/v0/workspaces/${linked.id}/native-preflight`)).json();
    assert.equal(preflight.available, true);
    assert.equal(preflight.version, "0.80.10");
    assert.equal(preflight.savedTrust, null);
    assert.equal(preflight.trustRequired, false);
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

    const automaticTrustLaunch = await fetch(`${origin}/v0/live-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: nativeChat.id,
        projectId: linked.id,
        model: "missing/provider-model",
      }),
    });
    assert.equal(automaticTrustLaunch.status, 400);
    assert.equal((await automaticTrustLaunch.json()).error, "invalid_model");
    const savedPreflight = await (await fetch(`${origin}/v0/workspaces/${linked.id}/native-preflight`)).json();
    assert.equal(savedPreflight.savedTrust, true);
    assert.equal(savedPreflight.trustRequired, false);

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
      body: JSON.stringify({
        defaultTemplateId: "workspace",
        sessionNameModel: "example/cheap",
        sessionNameThinkingLevel: "low",
        terminalShortcuts: [{ id: "herdr", label: "Herdr", command: "herdr", target: "new" }],
        sidebarPins: ["chat:one", "project:two", "terminal:three"],
        sidebarChatLimit: 45,
        collapsedProjectIds: ["project_chat"],
        rendererControlsVisible: false,
        voicePreferences: { shortcut: "Ctrl+Shift+D", activation: "toggle", autoSend: true, captureProfile: "processed" },
      }),
    });
    assert.equal(prefsPatch.status, 200);
    const savedPreferences = await prefsPatch.json();
    assert.equal(savedPreferences.defaultTemplateId, "workspace");
    assert.equal(savedPreferences.sessionNameModel, "example/cheap");
    assert.equal(savedPreferences.sessionNameThinkingLevel, "low");
    assert.deepEqual(savedPreferences.terminalShortcuts, [{ id: "herdr", label: "Herdr", command: "herdr", target: "new" }]);
    assert.deepEqual(savedPreferences.sidebarPins, ["chat:one", "project:two", "terminal:three"]);
    assert.equal(savedPreferences.sidebarChatLimit, 45);
    assert.deepEqual(savedPreferences.collapsedProjectIds, ["project_chat"]);
    assert.equal(savedPreferences.rendererControlsVisible, false);
    const invalidTerminalShortcuts = await fetch(`${origin}/v0/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ terminalShortcuts: [{ id: "bad", label: "", command: "pwd", target: "current" }] }),
    });
    assert.equal(invalidTerminalShortcuts.status, 400);
    assert.equal((await invalidTerminalShortcuts.json()).error, "invalid_terminal_shortcuts");
    const invalidSidebarPins = await fetch(`${origin}/v0/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sidebarPins: ["chat:one", "chat:one"] }),
    });
    assert.equal(invalidSidebarPins.status, 400);
    assert.equal((await invalidSidebarPins.json()).error, "invalid_sidebar_pins");
    const invalidUiPreferences = await fetch(`${origin}/v0/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sidebarChatLimit: 4 }),
    });
    assert.equal(invalidUiPreferences.status, 400);
    assert.equal((await invalidUiPreferences.json()).error, "invalid_ui_preferences");
    const invalidTranscriptWidth = await fetch(`${origin}/v0/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcriptWidth: "980px" }),
    });
    assert.equal(invalidTranscriptWidth.status, 400);
    assert.equal((await invalidTranscriptWidth.json()).error, "invalid_ui_preferences");
    const readingSurface = await fetch(`${origin}/v0/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transcriptWidth: "wide",
        transcriptWideBlocks: "wider",
        codeBlockCollapse: "long",
        codeBlockCollapseLines: 25,
      }),
    });
    assert.equal(readingSurface.status, 200);
    const savedSurface = await readingSurface.json();
    assert.equal(savedSurface.transcriptWidth, "wide");
    assert.equal(savedSurface.transcriptWideBlocks, "wider");
    assert.equal(savedSurface.codeBlockCollapse, "long");
    assert.equal(savedSurface.codeBlockCollapseLines, 25);

    const inheritedWorkspaceChat = await fetch(`${origin}/v0/chats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: linked.id }),
    });
    assert.equal((await inheritedWorkspaceChat.json()).templateId, "workspace");
    const workspaceOverride = await fetch(`${origin}/v0/projects/${linked.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultTemplateId: "chat" }),
    });
    assert.equal((await workspaceOverride.json()).defaultTemplateId, "chat");
    const overriddenWorkspaceChat = await fetch(`${origin}/v0/chats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: linked.id }),
    });
    assert.equal((await overriddenWorkspaceChat.json()).templateId, "chat");
    const clearedOverride = await fetch(`${origin}/v0/projects/${linked.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultTemplateId: null }),
    });
    assert.equal((await clearedOverride.json()).defaultTemplateId, null);
    const hostOverride = await fetch(`${origin}/v0/projects/${linked.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultTemplateId: "host-pi" }),
    });
    assert.equal((await hostOverride.json()).defaultTemplateId, "host-pi");
    const hostDefaultChat = await fetch(`${origin}/v0/chats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: linked.id }),
    });
    const hostDefaultChatBody = await hostDefaultChat.json();
    assert.equal(hostDefaultChatBody.runtime.kind, "native_pi");
    assert.equal(hostDefaultChatBody.templateId, "workspace");
    const appearancePatch = await fetch(`${origin}/v0/projects/${linked.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceAppearance: { mode: "monogram", value: "AI", color: "mauve" } }),
    });
    assert.equal(appearancePatch.status, 200);
    assert.deepEqual((await appearancePatch.json()).workspaceAppearance, { mode: "monogram", value: "AI", color: "mauve" });
    const customColorAppearance = await fetch(`${origin}/v0/projects/${linked.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceAppearance: { mode: "icon", value: "atom", color: "#123456" } }),
    });
    assert.equal(customColorAppearance.status, 200);
    assert.deepEqual((await customColorAppearance.json()).workspaceAppearance, { mode: "icon", value: "atom", color: "#123456" });
    const invalidAppearance = await fetch(`${origin}/v0/projects/${linked.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceAppearance: { mode: "monogram", value: "ABC", color: "mauve" } }),
    });
    assert.equal(invalidAppearance.status, 400);
    assert.equal((await invalidAppearance.json()).error, "workspace_appearance_invalid");
    await fetch(`${origin}/v0/projects/${linked.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultTemplateId: null }),
    });

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
    const freshLiveBody = await freshLive.json();
    assert.equal(freshLiveBody.status, "running");
    assert.deepEqual(freshLiveBody.modelProfile, {
      id: "brave-search",
      label: "Brave search",
      searchRouting: {
        providers: ["brave", "exa", "parallel", "openai"],
        fallbackOn: ["transient", "quota", "network"],
      },
    });
    const derivedSearchConfig = JSON.parse(await fs.readFile(path.join(root, "pi", "model-profiles", "brave-search", "web-search.json"), "utf8"));
    assert.deepEqual(derivedSearchConfig.searchRouting.providers, ["brave", "exa", "parallel", "openai"]);
    assert.equal("provider" in derivedSearchConfig, false);
    assert.equal("searchProvider" in derivedSearchConfig, false);
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

    const projectsPayload = await fetch(`${origin}/v0/projects`).then((response) => response.json());
    const chatProject = projectsPayload.projects.find((item) => item.id === chat.projectId);
    assert.ok(chatProject);
    await fs.mkdir(path.dirname(freshSessionFile), { recursive: true });
    await fs.writeFile(freshSessionFile, `${JSON.stringify({ type: "session", id: "future-session", cwd: chatProject.path })}\n`);
    const deletedChat = await fetch(`${origin}/v0/sessions/${chat.id}`, { method: "DELETE" });
    assert.equal(deletedChat.status, 204);
    await assert.rejects(fs.access(freshSessionFile), { code: "ENOENT" });
  } finally {
    if (child.exitCode == null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
