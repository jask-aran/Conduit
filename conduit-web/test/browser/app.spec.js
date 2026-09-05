import { expect, test } from "@playwright/test";
import { COMMAND_IDS, getCommandDefinition } from "../../src/client/commands/command-registry.ts";

const projects = [{
  id: "project_chat",
  slug: "chat",
  name: "Chats",
  sessions: [{ id: "session_existing", projectId: "project_chat", status: "active", title: "Existing chat" }],
}, {
  id: "project_research",
  slug: "research",
  name: "Research",
  sessions: [],
}];

const model = {
  provider: "example",
  id: "reasoner",
  spec: "example/reasoner",
  label: "Reasoner",
  thinkingLevels: ["off", "medium", "high"],
};

const plainModel = {
  provider: "example",
  id: "plain",
  spec: "example/plain",
  label: "Plain",
  thinkingLevels: ["off"],
};

const templates = [{
  id: "chat",
  label: "Assistant",
  version: 5,
  defaultable: true,
  tools: ["read", "write", "edit", "bash", "web_search", "fetch_content", "get_search_content", "source_check"],
}, {
  id: "workspace",
  label: "Coding",
  version: 1,
  defaultable: true,
  tools: ["read", "write", "edit", "bash"],
}];

const nativeWorkspaceSuggestions = {
  root: "/home/user",
  allowlist: ["/home/user"],
  defaultRoot: "/home/user",
  defaultInputPath: "~",
  suggestionRoot: "/home/user",
  modes: ["managed", "linked", "created", "cloned"],
};

const unhandledApiRequests = new WeakMap();

async function openSidebar(page, testInfo) {
  if (testInfo.project.name === "mobile-chromium") {
    const panel = page.getByRole("complementary", { name: "Workspace panel" });
    if (await panel.count() && await panel.getAttribute("aria-hidden") === "false") {
      await panel.getByRole("button", { name: "Close workspace panel" }).click();
    }
    await page.locator(".mobile-sidebar-trigger").click();
  }
}

async function openChatSurface(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
}

async function runPaletteCommand(page, label) {
  await page.getByRole("button", { name: "Open command palette", exact: true }).click({ force: true });
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await expect(palette).toBeVisible();
  await palette.getByRole("option").filter({ hasText: label }).first().click();
}

async function runWorkspaceViewCommand(page, label) {
  await page.getByRole("button", { name: "Open command palette", exact: true }).click({ force: true });
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await expect(palette).toBeVisible();
  await palette.getByRole("option").filter({ hasText: "Workspace views…" }).click();
  await palette.getByRole("option").filter({ hasText: label }).click();
}

async function runRegisteredCommand(page, commandId) {
  const command = getCommandDefinition(commandId);
  const binding = command.defaultBindings[0];
  expect(binding, `${commandId} must have a default binding`).toBeTruthy();
  for (const stroke of binding.strokes) {
    const keys = [];
    if (stroke.modifiers.includes("primary")) keys.push(process.platform === "darwin" ? "Meta" : "Control");
    if (stroke.modifiers.includes("control") && !keys.includes("Control")) keys.push("Control");
    if (stroke.modifiers.includes("alt")) keys.push("Alt");
    if (stroke.modifiers.includes("shift")) keys.push("Shift");
    const key = stroke.code.startsWith("Key")
      ? stroke.code.slice(3).toLowerCase()
      : stroke.code.startsWith("Digit")
        ? stroke.code.slice(5)
        : stroke.code === "Period" ? "." : stroke.key;
    await page.keyboard.press([...keys, key].join("+"));
  }
}

test.beforeEach(async ({ page }) => {
  if (process.env.CONDUIT_TEST_MARKDOWN_RENDERER) {
    await page.addInitScript((renderer) => {
      localStorage.setItem("conduit:markdown-renderer", renderer);
    }, process.env.CONDUIT_TEST_MARKDOWN_RENDERER);
  }
  await page.addInitScript(() => {
    class IdleWebSocket extends EventTarget {
      static OPEN = 1;
      constructor() {
        super();
        this.readyState = 0;
        queueMicrotask(() => { this.readyState = IdleWebSocket.OPEN; this.dispatchEvent(new Event("open")); });
      }
      send() {}
      close() {
        window.__closedSocketCount = (window.__closedSocketCount || 0) + 1;
        this.readyState = 3;
        this.dispatchEvent(new Event("close"));
      }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: IdleWebSocket });
    class MockEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      constructor(url) {
        super();
        this.url = url;
        this.readyState = MockEventSource.CONNECTING;
        this.onerror = null;
        this.onmessage = null;
        queueMicrotask(() => {
          if (this.readyState === MockEventSource.CLOSED) return;
          this.readyState = MockEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
          const payload = {
            data: JSON.stringify({ type: "runtime_global_snapshot", processes: [], at: new Date().toISOString() }),
          };
          this.onmessage?.(payload);
          this.dispatchEvent(new MessageEvent("message", payload));
        });
      }
      close() {
        this.readyState = MockEventSource.CLOSED;
        // Do not fire onerror on intentional close — that loops reconnects.
      }
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: MockEventSource });
  });
  const unhandled = [];
  unhandledApiRequests.set(page, unhandled);
  await page.route("**/v0/**", async (route) => {
    const request = route.request();
    unhandled.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.fulfill({ status: 501, json: { error: "unhandled_browser_test_api" } });
  });
  await page.route("**/v0/templates", async (route) => {
    await route.fulfill({ json: { templates, defaultTemplateId: "chat" } });
  });
  await page.route("**/v0/workspaces/suggestions", async (route) => {
    await route.fulfill({ json: { ...nativeWorkspaceSuggestions, folders: [] } });
  });
  let preferences = { defaultTemplateId: "chat", sessionNameModel: "", sessionNameThinkingLevel: "off" };
  await page.route("**/v0/preferences", async (route) => {
    const body = route.request().postDataJSON?.() || {};
    preferences = { ...preferences, ...body };
    await route.fulfill({ json: preferences });
  });
  await page.route("**/v0/runtime/settings", async (route) => {
    await route.fulfill({ json: {
      maxLiveProcesses: 12,
      maxGeneratingProcesses: 2,
      idleProcessTtlMs: 120_000,
      liveCount: 0,
      generatingCount: 0,
    } });
  });
  await page.route("**/v0/capabilities", async (route) => {
    await route.fulfill({ json: { partialContinue: true, globalRuntime: "sse" } });
  });
  await page.route("**/v0/ptys*", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ptys: [] } });
    await route.fulfill({ status: 501, json: { error: "unhandled_browser_test_api" } });
  });
  await page.route("**/v0/runtime", async (route) => {
    await route.fulfill({ json: { type: "runtime_global_snapshot", processes: [], at: new Date().toISOString() } });
  });
  await page.route("**/v0/pi-installations", async (route) => {
    await route.fulfill({ json: { installations: [
      { id: "conduit-pinned", label: "Isolated Pi", version: "0.84.1", available: true },
      { id: "host-pi", label: "Host Pi", version: "0.80.10", available: true },
    ] } });
  });
  await page.route("**/v0/chats", async (route) => {
    await route.fulfill({ status: 201, json: {
      id: "550e8400-e29b-41d4-a716-446655440099",
      projectId: "project_chat",
      status: "draft",
      title: "New chat",
    } });
  });
  await page.route("**/v0/chats/550e8400-e29b-41d4-a716-446655440099", async (route) => {
    await route.fulfill({ json: {
      id: "550e8400-e29b-41d4-a716-446655440099",
      projectId: "project_chat",
      status: "draft",
      title: "New chat",
    } });
  });
  await page.route("**/v0/sessions/550e8400-e29b-41d4-a716-446655440099", async (route) => {
    await route.fulfill({ json: {
      id: "550e8400-e29b-41d4-a716-446655440099",
      projectId: "project_chat",
      status: "draft",
      title: "New chat",
      messages: [], tools: [], page: { before: null },
    } });
  });
  await page.route("**/v0/chats/*/attachments", async (route) => {
    await route.fulfill({ json: { attachments: [] } });
  });
  await page.route("**/v0/projects/*/tree?*", async (route) => {
    const directory = new URL(route.request().url()).searchParams.get("path") || "";
    await route.fulfill({ json: { path: directory, entries: directory === "src"
      ? [{ name: "main.ts", path: "src/main.ts", type: "file" }]
      : [{ name: ".git", path: ".git", type: "directory" }, { name: "src", path: "src", type: "directory" }, { name: "app.js", path: "app.js", type: "file" }, { name: "README.md", path: "README.md", type: "file" }] } });
  });
  await page.route("**/v0/projects/*/file?*", async (route) => {
    const file = new URL(route.request().url()).searchParams.get("path");
    await route.fulfill({ json: { path: file, size: 31, content: "export function startConduit() {}\n" } });
  });
  await page.route("**/v0/projects/*/diff*", async (route) => {
    await route.fulfill({ json: { repository: true, branch: "agent/rhs-panel-mvp", upstream: "origin/agent/rhs-panel-mvp", ahead: 2, behind: 0, commits: [{ graph: "*", hash: "1234567890abcdef", shortHash: "1234567", subject: "Add workspace panel", author: "Conduit", authoredAt: "2026-07-22T10:00:00Z" }], files: [{ status: " M", path: "src/main.ts" }], diff: "# Working tree\n@@ -1 +1 @@\n-old\n+new\n" } });
  });
  await page.route("**/v0/chats/*?ifEmpty=true", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/v0/chats/*/models", async (route) => {
    const body = route.request().postDataJSON?.() || {};
    await route.fulfill({ json: {
      installationId: "conduit-pinned",
      runtimeKind: "conduit_profile",
      models: [model, plainModel],
      model: body.model || model.spec,
      thinkingLevel: body.thinkingLevel || "medium",
      defaultModel: model.spec,
      defaultThinkingLevel: "medium",
      requiresAuthentication: false,
      warnings: [],
      source: route.request().method() === "PATCH" ? "runtime_default" : "jsonl",
    } });
  });
  await page.route("**/v0/projects", async (route) => {
    await route.fulfill({ json: { projects } });
  });
  await page.route("**/v0/models?**", async (route) => {
    await route.fulfill({
      json: {
        models: [model, plainModel],
        defaultModel: model.spec,
        defaultThinkingLevel: "medium",
        requiresAuthentication: false,
      },
    });
  });
  await page.route("**/v0/settings?**", async (route) => {
    await route.fulfill({ json: { models: [model, plainModel], enabledModels: [model.spec, plainModel.spec], defaultModel: model.spec } });
  });
  await page.route("**/v0/settings", async (route) => {
    const body = route.request().postDataJSON?.() || {};
    await route.fulfill({ json: {
      models: [model, plainModel],
      enabledModels: body.enabledModels || [model.spec, plainModel.spec],
      defaultModel: body.defaultModel || model.spec,
    } });
  });
  await page.route("**/v0/sessions/session_existing", async (route) => {
    await route.fulfill({ json: {
      id: "session_existing",
      projectId: "project_chat",
      status: "active",
      title: "Existing chat",
      model: model.spec,
      thinkingLevel: "medium",
      messages: [
        { id: "message_existing", role: "user", content: "Previous question" },
        { id: "message_tool_only", role: "assistant", content: "", timestamp: "2026-07-15T06:49:27.768Z" },
      ],
      tools: [{
        id: "call_existing",
        name: "write",
        args: { path: "note.md" },
        done: true,
        result: "Saved",
        timestamp: "2026-07-15T06:49:27.768Z",
      }],
    } });
  });
  await page.route("**/v0/chats/session_existing", async (route) => {
    await route.fulfill({ json: {
      id: "session_existing",
      projectId: "project_chat",
      status: "active",
      title: "Existing chat",
      model: model.spec,
      thinkingLevel: "medium",
    } });
  });
  await page.route("**/v0/sessions/session_existing/transcript", async (route) => {
    await route.fulfill({ contentType: "text/markdown", body: "## User\n\nPrevious question" });
  });
  await page.route("**/v0/sessions/session_existing/move", async (route) => {
    await route.fulfill({ json: { id: "session_moved", title: "Existing chat", projectId: "project_research" } });
  });
  await page.route("**/v0/projects/project_research", async (route) => {
    await route.fulfill({ json: { ...projects[1], name: route.request().postDataJSON()?.name || projects[1].name } });
  });
  await page.route("**/v0/projects/project_research/move-sessions", async (route) => {
    await route.fulfill({ json: { moved: [] } });
  });
  await page.route("**/v0/live-sessions", async (route) => {
    const chatId = route.request().postDataJSON?.()?.chatId || "session_existing";
    await route.fulfill({ json: { id: `live_${chatId}`, chatId, streamUrl: `/v0/live-sessions/live_${chatId}/stream` } });
  });
});

// A width commit that lands in one step -- restoring a stored width when the
// project changes -- used its own 256..496 clamp while drag and keyboard used
// clampWidth (240..65% of the viewport). A panel dragged wider than 496 came
// back narrower, and the commit dispatched no geometry motion, so the
// transcript stayed laid out for the width it never learned had changed.
test("restores a stored panel width past the old clamp and announces the commit @setpiece", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "resizable side panel is desktop chrome");
  await page.addInitScript(() => {
    // The compact-UI migration rescales stored widths by 0.8 exactly once.
    // Claim it, or the seeded width arrives as 480 and proves nothing.
    localStorage.setItem("conduit:compact-ui-v2", "true");
    localStorage.setItem("conduit:workspace-panel:project_chat:width", "600");
    window.__geometry = [];
    window.addEventListener("conduit:panel-geometry-motion", (event) => {
      window.__geometry.push({ phase: event.detail.phase, source: event.detail.source, size: event.detail.size, targetSize: event.detail.targetSize ?? null });
    });
  });
  await openChatSurface(page);
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  await expect(panel).toBeVisible();
  await expect.poll(async () => Math.round((await panel.boundingBox()).width)).toBe(600);

  const commits = await page.evaluate(() => window.__geometry.filter((entry) => entry.source === "workspace" && entry.targetSize != null));
  expect(commits.length).toBeGreaterThan(0);
  expect(commits.at(-1).targetSize).toBeGreaterThan(600);
});

test("workspace directory pages append and survive refresh with honest filtering", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop file tree");
  let nextPageRequests = 0;
  await page.route("**/v0/projects/*/tree?*", (route) => {
    const more = new URL(route.request().url()).searchParams.has("after");
    if (more) nextPageRequests += 1;
    return route.fulfill({ json: { entries: [{ name: more ? "zebra.txt" : "alpha.txt", path: more ? "zebra.txt" : "alpha.txt", type: "file" }], total: 2, truncated: !more, cursor: more ? null : '["file","alpha.txt"]' } });
  });
  await openChatSurface(page);
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  const filter = panel.getByRole("searchbox", { name: "Filter loaded files" });
  await expect(panel.getByRole("treeitem", { name: "alpha.txt" })).toBeVisible();
  await filter.fill("zebra");
  await expect(panel.getByText("Filter covers loaded entries only.")).toBeVisible();
  await panel.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(panel.getByRole("treeitem", { name: "zebra.txt" })).toBeVisible();
  await expect(panel.getByText("Filter covers loaded entries only.")).toHaveCount(0);
  await filter.clear();
  const beforeRefresh = nextPageRequests;
  await panel.getByRole("button", { name: "Refresh files", exact: true }).click();
  await expect.poll(() => nextPageRequests).toBeGreaterThan(beforeRefresh);
  await expect(panel.getByRole("button", { name: "Refresh files", exact: true })).toBeEnabled();
  await expect(panel.getByRole("treeitem", { name: "alpha.txt" })).toBeVisible();
  await expect(panel.getByRole("treeitem", { name: "zebra.txt" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Show more", exact: true })).toHaveCount(0);
});

test("workspace panel previews files, shows diff, and persists per chat", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "resizable side panel is desktop chrome");
  await openChatSurface(page);
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  await expect(panel).toBeVisible();
  if (page.viewportSize().width <= 760) {
    const tabCenters = await panel.getByRole("tab").evaluateAll((tabs) =>
      tabs.map((tab) => {
        const box = tab.getBoundingClientRect();
        return box.left + box.width / 2;
      }));
    expect(tabCenters.at(-1) - tabCenters[0]).toBeGreaterThan(180);
  }
  if (page.viewportSize().width > 760) {
    const main = page.locator('[data-slot="sidebar-inset"]');
    const thread = page.locator(".thread");
    const [panelBox, widthHandleBox, mainBox, threadBox] = await Promise.all([
      panel.boundingBox(),
      panel.getByRole("separator", { name: "Resize workspace panel" }).boundingBox(),
      main.boundingBox(),
      thread.boundingBox(),
    ]);
    expect(widthHandleBox.x).toBeLessThan(panelBox.x);
    const widthHandle = panel.getByRole("separator", { name: "Resize workspace panel" });
    const originalWidth = Number(await widthHandle.getAttribute("aria-valuenow"));
    await page.mouse.move(widthHandleBox.x + (widthHandleBox.width / 2), widthHandleBox.y + 80);
    await page.mouse.down();
    const resizeSamples = [];
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(widthHandleBox.x + (widthHandleBox.width / 2) - (step * 12), widthHandleBox.y + 80);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      resizeSamples.push(await page.evaluate(() => {
        const shell = document.querySelector("aside.workspace-panel");
        const surface = shell.querySelector(".workspace-panel-surface");
        const chat = document.querySelector('[data-slot="sidebar-inset"]');
        const transcript = document.querySelector(".thread");
        const motionShell = document.querySelector(".transcript-motion-shell");
        const handle = shell.querySelector('[aria-label="Resize workspace panel"]');
        const shellBox = shell.getBoundingClientRect();
        const surfaceBox = surface.getBoundingClientRect();
        const chatBox = chat.getBoundingClientRect();
        const motionBox = motionShell.getBoundingClientRect();
        return {
          panelWidth: shellBox.width,
          surfaceWidth: surfaceBox.width,
          surfaceLeft: surfaceBox.left,
          mainWidth: chatBox.width,
          mainRight: chatBox.right,
          threadLeft: transcript.getBoundingClientRect().left,
          threadWidth: transcript.getBoundingClientRect().width,
          motionRight: motionBox.right,
          motionWidth: motionBox.width,
          gapMainToSurface: surfaceBox.left - chatBox.right,
          gapMotionToSurface: surfaceBox.left - motionBox.right,
          emptyShellLeft: surfaceBox.left - shellBox.left,
          ariaWidth: Number(handle.getAttribute("aria-valuenow")),
        };
      }));
    }
    // Coupled resize: shell tracks surface every frame; chat stays adjacent.
    expect(new Set(resizeSamples.map((sample) => Math.round(sample.panelWidth))).size).toBeGreaterThan(3);
    expect(new Set(resizeSamples.map((sample) => Math.round(sample.surfaceWidth))).size).toBeGreaterThan(3);
    expect(new Set(resizeSamples.map((sample) => Math.round(sample.mainWidth))).size).toBeGreaterThan(3);
    expect(resizeSamples.every((sample) => Math.abs(sample.panelWidth - sample.surfaceWidth) < 1)).toBe(true);
    expect(resizeSamples.every((sample) => Math.abs(sample.emptyShellLeft) < 1)).toBe(true);
    // Adjacency is the contract: the gap holds steady while the panel resizes.
    // Its exact value is a scale decision and is deliberately not asserted.
    const gapRange = (values) => Math.max(...values) - Math.min(...values);
    expect(gapRange(resizeSamples.map((sample) => sample.gapMainToSurface))).toBeLessThan(1.5);
    // The transcript shell is the deliberate exception. Re-laying it out on
    // every pointer move cost 20.8ms a frame on a 143Hz display for a
    // formula-heavy answer -- every frame over budget -- because each message
    // root, KaTeX block and code card is its own layout root. During a drag it
    // holds its width and slides on the compositor instead, so its edge does
    // not track the surface; it is clipped by the shell and commits the real
    // width on release. The eased open/close path is unaffected.
    expect(new Set(resizeSamples.map((sample) => Math.round(sample.motionWidth))).size).toBe(1);
    expect(resizeSamples.every((sample) => sample.gapMainToSurface >= 0 && sample.gapMainToSurface < 32)).toBe(true);
    expect(resizeSamples.every((sample) => Math.abs(sample.ariaWidth - sample.surfaceWidth) < 1)).toBe(true);
    expect(resizeSamples.every((sample, index) =>
      index === 0 || sample.surfaceWidth >= resizeSamples[index - 1].surfaceWidth - 0.5)).toBe(true);
    const previewGeometry = await page.evaluate(() => {
      const shell = document.querySelector("aside.workspace-panel");
      const surface = document.querySelector(".workspace-panel-surface");
      const chat = document.querySelector('[data-slot="sidebar-inset"]');
      const transcript = document.querySelector(".thread");
      const motionShell = document.querySelector(".transcript-motion-shell");
      return {
        shell: shell.getBoundingClientRect().toJSON(),
        surface: surface.getBoundingClientRect().toJSON(),
        main: chat.getBoundingClientRect().toJSON(),
        transcript: transcript.getBoundingClientRect().toJSON(),
        motion: motionShell.getBoundingClientRect().toJSON(),
      };
    });
    await page.mouse.up();
    await expect(widthHandle).toHaveAttribute("aria-valuenow", String(Math.min(Math.floor(page.viewportSize().width * 0.65), originalWidth + 72)));
    await expect.poll(async () => Math.round((await panel.boundingBox()).width)).toBe(originalWidth + 72);
    const releasedGeometry = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
      const shell = document.querySelector("aside.workspace-panel");
      const surface = document.querySelector(".workspace-panel-surface");
      const chat = document.querySelector('[data-slot="sidebar-inset"]');
      const transcript = document.querySelector(".thread");
      const motionShell = document.querySelector(".transcript-motion-shell");
      resolve({
        shell: shell.getBoundingClientRect().toJSON(),
        surface: surface.getBoundingClientRect().toJSON(),
        main: chat.getBoundingClientRect().toJSON(),
        transcript: transcript.getBoundingClientRect().toJSON(),
        motion: motionShell.getBoundingClientRect().toJSON(),
      });
    })));
    // Release continuity: first released frame matches final drag frame.
    expect(Math.abs(releasedGeometry.shell.width - previewGeometry.shell.width)).toBeLessThan(1);
    expect(Math.abs(releasedGeometry.shell.x - previewGeometry.shell.x)).toBeLessThan(1);
    expect(Math.abs(releasedGeometry.surface.x - previewGeometry.surface.x)).toBeLessThan(1);
    expect(Math.abs(releasedGeometry.surface.width - previewGeometry.surface.width)).toBeLessThan(1);
    expect(Math.abs(releasedGeometry.main.right - previewGeometry.main.right)).toBeLessThan(1);
    expect(Math.abs(releasedGeometry.main.width - previewGeometry.main.width)).toBeLessThan(1);
    // The thread is the frozen part, so it is the one thing that legitimately
    // moves on release: it commits the width the drag was previewing. What must
    // not happen is it landing anywhere other than inside the settled shell.
    expect(releasedGeometry.transcript.width).toBeLessThanOrEqual(releasedGeometry.motion.width + 1);
    expect(releasedGeometry.transcript.x).toBeGreaterThanOrEqual(releasedGeometry.motion.x - 1);
    expect(releasedGeometry.motion.right).toBeLessThanOrEqual(releasedGeometry.surface.x + 1);
    // The shell held the pre-drag width for the whole gesture, so on release it
    // gives back exactly the 72px the panel took. That difference is the commit.
    expect(previewGeometry.motion.width - releasedGeometry.motion.width).toBeGreaterThan(70);
    expect(previewGeometry.motion.width - releasedGeometry.motion.width).toBeLessThan(74);
  }
  const tree = panel.getByRole("tree", { name: "Project files" });
  await tree.getByRole("treeitem", { name: "src" }).click();
  await tree.getByRole("treeitem", { name: "main.ts" }).click();
  await expect(panel.getByText("export function startConduit() {}" )).toBeVisible();
  const previewHandle = panel.getByRole("separator", { name: "Resize file preview" });
  await previewHandle.focus();
  await page.keyboard.press("Home");
  await expect(previewHandle).toHaveAttribute("aria-valuenow", "32");
  await page.keyboard.press("End");
  await expect(previewHandle).toHaveAttribute("aria-valuenow", await previewHandle.getAttribute("aria-valuemax"));
  await panel.getByRole("button", { name: /File preview/ }).click();
  await expect(panel.getByRole("region", { name: "File preview" })).toHaveCount(0);
  await panel.getByRole("button", { name: /File preview/ }).click();
  await panel.getByRole("tab", { name: "Source Control" }).click();
  await expect(panel.getByRole("button", { name: /Changes/ })).toBeVisible();
  await expect(panel.getByText("src/main.ts")).toBeVisible();
  await expect(panel.getByText("agent/rhs-panel-mvp", { exact: true })).toBeVisible();
  // Detail starts closed so graph work does not compete with panel motion.
  await expect(panel.getByText("Add workspace panel")).toHaveCount(0);
  await panel.getByRole("button", { name: "Show Details" }).click();
  await expect(panel.getByText("Add workspace panel")).toBeVisible();
  const sourceDetailHandle = panel.getByRole("separator", { name: "Resize details" });
  await sourceDetailHandle.focus();
  await page.keyboard.press("Home");
  await expect(sourceDetailHandle).toHaveAttribute("aria-valuenow", "96");
  await page.keyboard.press("End");
  await expect(sourceDetailHandle).toHaveAttribute("aria-valuenow", await sourceDetailHandle.getAttribute("aria-valuemax"));
  await panel.getByRole("tab", { name: "Patch" }).click();
  await expect(panel.getByText("@@ -1 +1 @@")).toBeVisible();
  await panel.getByRole("tab", { name: "Graph" }).click();
  await expect(panel.getByText("Add workspace panel")).toBeVisible();
  await panel.getByRole("tab", { name: "Artifacts" }).click();
  await expect(panel.getByText("No artifacts in the loaded transcript")).toBeVisible();
  await panel.getByRole("radio", { name: "Interactive UI" }).click();
  await expect(panel.getByText("Interactive artifacts are not enabled")).toBeVisible();
  await panel.getByRole("tab", { name: "Source Control" }).click();
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Workspace panel" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Source Control" })).toHaveAttribute("aria-selected", "true");
  await runPaletteCommand(page, "Toggle workspace panel");
  await expect(page.getByRole("complementary", { name: "Workspace panel" })).toHaveCount(0);
});

// 1x1 transparent PNG.
const PNG_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("workspace previews an image instead of refusing it as binary", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "wide file preview is desktop chrome");
  await page.route("**/v0/projects/*/tree?*", async (route) => {
    await route.fulfill({ json: { path: "", entries: [
      { name: "logo.png", path: "logo.png", type: "file" },
      { name: "notes.txt", path: "notes.txt", type: "file" },
    ] } });
  });
  await page.route("**/v0/projects/*/file?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("metadata") === "1") {
      return route.fulfill({ json: { path: "logo.png", size: PNG_FIXTURE.length, modifiedAt: 1 } });
    }
    if (url.searchParams.get("download") === "1") {
      return route.fulfill({ body: PNG_FIXTURE, contentType: "application/octet-stream" });
    }
    if (url.searchParams.get("path") === "notes.txt") {
      return route.fulfill({ json: { path: "notes.txt", size: 5, modifiedAt: 1, revision: "r1", content: "hello" } });
    }
    // The text endpoint refuses binaries; the image path must never reach it.
    return route.fulfill({ status: 415, json: { error: "file_not_text", message: "Binary files cannot be previewed" } });
  });

  await openChatSurface(page);
  await runPaletteCommand(page, "Toggle maximized workspace panel");
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  await panel.getByRole("treeitem", { name: "logo.png" }).click();

  const image = panel.getByRole("img", { name: "logo.png" });
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("naturalWidth", 1);
  await expect(panel.getByText("Binary files cannot be previewed")).toHaveCount(0);
  // Editing and saving are meaningless for an image and must not be offered.
  await expect(panel.getByRole("button", { name: "Edit file" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Save file" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Download file" })).toBeVisible();

  // Jumping straight from an image to a text file, with no close in between.
  await panel.getByRole("treeitem", { name: "notes.txt" }).click();
  await expect(image).toHaveCount(0);
  await expect(panel.locator(".workspace-preview-file")).toHaveText("notes.txt");
  await expect(panel.getByRole("button", { name: "Edit file" })).toBeVisible();

  // ...and straight back again.
  await panel.getByRole("treeitem", { name: "logo.png" }).click();
  await expect(image).toBeVisible();
  await expect(panel.getByRole("button", { name: "Edit file" })).toHaveCount(0);
});

test("workspace files open two slots side by side", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "two file slots need the wide desktop layout");
  await openChatSurface(page);
  await runPaletteCommand(page, "Toggle maximized workspace panel");
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  const tree = panel.getByRole("tree", { name: "Project files" });
  const primary = panel.getByRole("region", { name: "File preview", exact: true });
  const secondary = panel.getByRole("region", { name: "Second file preview" });

  await tree.getByRole("treeitem", { name: "app.js" }).click();
  await expect(primary.locator(".workspace-preview-file")).toHaveText("app.js");
  await expect(secondary).toHaveCount(0);

  // Alt-click opens to the side and focuses the new slot.
  await tree.getByRole("treeitem", { name: "README.md" }).click({ modifiers: ["Alt"] });
  await expect(secondary.locator(".workspace-preview-file")).toHaveText("README.md");
  await expect(primary.locator(".workspace-preview-file")).toHaveText("app.js");
  await expect(tree.getByRole("treeitem", { name: "app.js" })).toHaveAttribute("aria-selected", "true");
  await expect(tree.getByRole("treeitem", { name: "README.md" })).toHaveAttribute("aria-selected", "true");

  await page.setViewportSize({ width: 500, height: 900 });
  await expect(primary).toBeVisible();
  await expect(secondary).toBeVisible();
  const [primaryBox, secondaryBox] = await Promise.all([primary.boundingBox(), secondary.boundingBox()]);
  expect(secondaryBox.y).toBeGreaterThanOrEqual(primaryBox.y + primaryBox.height);

  // A plain click lands in the focused slot and leaves the other one alone.
  await tree.getByRole("treeitem", { name: "src" }).click();
  await tree.getByRole("treeitem", { name: "main.ts" }).click();
  await expect(secondary.locator(".workspace-preview-file")).toHaveText("src/main.ts");
  await expect(primary.locator(".workspace-preview-file")).toHaveText("app.js");

  const storedFiles = () => page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
    .filter(([key]) => key.endsWith(":file") || key.endsWith(":file-secondary"))
    .map(([key, value]) => [key.split(":").at(-1), value])));
  expect(await storedFiles()).toEqual({ file: "app.js", "file-secondary": "src/main.ts" });

  await secondary.getByRole("button", { name: "Close second file" }).click();
  await expect(secondary).toHaveCount(0);
  await expect(primary.locator(".workspace-preview-file")).toHaveText("app.js");
  expect(await storedFiles()).toEqual({ file: "app.js" });
});

test("an unsaved draft in one file slot survives opening another file", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "two file slots need the wide desktop layout");
  await openChatSurface(page);
  await runPaletteCommand(page, "Toggle maximized workspace panel");
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  const tree = panel.getByRole("tree", { name: "Project files" });
  const primary = panel.getByRole("region", { name: "File preview", exact: true });
  const secondary = panel.getByRole("region", { name: "Second file preview" });

  await tree.getByRole("treeitem", { name: "app.js" }).click();
  await primary.getByRole("button", { name: "Edit file" }).click();
  await primary.locator(".cm-content").click();
  await page.keyboard.type("// draft");
  await expect(primary.locator(".workspace-preview-header small")).toHaveText("Unsaved");

  // An unanswered confirm() dismisses by default in Playwright, so the second
  // slot appearing at all proves no discard prompt gated the other slot.
  await tree.getByRole("treeitem", { name: "README.md" }).click({ modifiers: ["Alt"] });
  await expect(secondary.locator(".workspace-preview-file")).toHaveText("README.md");
  await expect(primary.locator(".workspace-preview-header small")).toHaveText("Unsaved");
});

test("a save acknowledges only the draft submitted before a later edit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "CodeMirror save race needs the desktop workspace editor");
  const initialContent = "export function startConduit() {}\n";
  const firstDraft = `${initialContent}v1`;
  let savedBody = "";
  let savedRevision = "";
  let resolveSaveStarted;
  const saveStarted = new Promise((resolve) => { resolveSaveStarted = resolve; });
  let releaseSave;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  await page.unroute("**/v0/projects/*/file?*");
  await page.route("**/v0/projects/*/file?*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "PUT") {
      savedBody = request.postData() || "";
      savedRevision = request.headers()["if-match"] || "";
      resolveSaveStarted();
      await saveGate;
      return route.fulfill({ json: { path: "app.js", size: firstDraft.length, modifiedAt: 2, revision: "revision-2" } });
    }
    if (url.searchParams.get("metadata") === "1") {
      return route.fulfill({ json: { path: "app.js", size: initialContent.length, modifiedAt: 1 } });
    }
    return route.fulfill({ json: { path: "app.js", size: initialContent.length, modifiedAt: 1, revision: "revision-1", content: initialContent } });
  });

  await openChatSurface(page);
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  const primary = panel.getByRole("region", { name: "File preview", exact: true });
  await panel.getByRole("treeitem", { name: "app.js" }).click();
  await expect(primary.getByRole("button", { name: "Edit file" })).toBeVisible();
  await primary.getByRole("button", { name: "Edit file" }).click();
  const editor = primary.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("v1");
  await expect(primary.getByRole("button", { name: "Save file" })).toBeEnabled();
  await primary.getByRole("button", { name: "Save file" }).click();
  await saveStarted;

  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("v2");
  await expect(primary.locator(".workspace-preview-header small")).toHaveText("Unsaved");
  releaseSave();

  await expect(primary.getByRole("button", { name: "Save file" })).toBeEnabled();
  await expect(primary.locator(".workspace-preview-header small")).toHaveText("Unsaved");
  expect(savedRevision).toBe("revision-1");
  expect(savedBody).toBe(firstDraft);
  await expect(editor).toContainText("v1v2");
});

test("workspace file controls create, rename, move, and delete folders", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "opens the panel from the desktop header button");
  let rootEntries = [];
  let draftEntries = [];
  await page.unroute("**/v0/projects/*/tree?*");
  await page.unroute("**/v0/projects/*/file?*");
  await page.route("**/v0/projects/*/tree?*", (route) => {
    const directory = new URL(route.request().url()).searchParams.get("path") || "";
    return route.fulfill({ json: { path: directory, entries: directory === "drafts" ? draftEntries : rootEntries, truncated: false } });
  });
  await page.route("**/v0/projects/*/file?*", (route) => {
    const request = route.request();
    const file = new URL(request.url()).searchParams.get("path");
    if (request.method() === "PUT") {
      rootEntries = [{ name: "drafts", path: "drafts", type: "directory" }, { name: "notes.txt", path: "notes.txt", type: "file" }];
      return route.fulfill({ status: 201, json: { path: file, size: 0, modifiedAt: 1, revision: "empty" } });
    }
    return route.fulfill({ json: { path: file, size: 0, modifiedAt: 1, revision: "empty", content: "" } });
  });
  await page.route("**/v0/projects/*/directory*", (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      rootEntries = [{ name: "drafts", path: "drafts", type: "directory" }];
      return route.fulfill({ status: 201, json: { path: "drafts" } });
    }
    rootEntries = [];
    draftEntries = [];
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/v0/projects/*/entry", (route) => {
    const { path, destination } = route.request().postDataJSON();
    if (path === "notes.txt") {
      rootEntries = [{ name: "drafts", path: "drafts", type: "directory" }, { name: "ideas.txt", path: "ideas.txt", type: "file" }];
    } else {
      rootEntries = [{ name: "drafts", path: "drafts", type: "directory" }];
      draftEntries = [{ name: "ideas.txt", path: "drafts/ideas.txt", type: "file" }];
    }
    return route.fulfill({ json: { path, destination, type: "file" } });
  });

  await openChatSurface(page);
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  const tree = panel.getByRole("tree", { name: "Project files" });

  page.once("dialog", (dialog) => dialog.accept("drafts"));
  await panel.getByRole("button", { name: "New folder" }).click();
  await expect(tree.getByRole("treeitem", { name: "drafts" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept("notes.txt"));
  await panel.getByRole("button", { name: "New file" }).click();
  const notes = tree.getByRole("treeitem", { name: "notes.txt" });
  await expect(notes).toBeVisible();

  await notes.click({ button: "right" });
  page.once("dialog", (dialog) => dialog.accept("ideas.txt"));
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const ideas = tree.getByRole("treeitem", { name: "ideas.txt" });
  await expect(ideas).toBeVisible();

  await ideas.click({ button: "right" });
  page.once("dialog", (dialog) => dialog.accept("drafts"));
  await page.getByRole("menuitem", { name: "Move…" }).click();
  await expect(ideas).toHaveCount(0);
  await tree.getByRole("treeitem", { name: "drafts" }).click();
  await expect(tree.getByRole("treeitem", { name: "ideas.txt" })).toBeVisible();

  await tree.getByRole("treeitem", { name: "drafts" }).click({ button: "right" });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  await expect(tree.getByRole("treeitem", { name: "drafts" })).toHaveCount(0);
});

test("workspace file menu replaces, deletes, and polls selected files", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "opens the panel from the desktop header button; mobile reaches it through the More menu");
  let entries = [{ name: "app.js", path: "app.js", type: "file" }];
  let content = "export const version = 1;\n";
  let modifiedAt = 1;
  let revision = "revision-1";
  let replacementIfMatch = "";
  await page.unroute("**/v0/projects/*/tree?*");
  await page.unroute("**/v0/projects/*/file?*");
  await page.route("**/v0/projects/*/tree?*", (route) => route.fulfill({ json: { path: "", entries, truncated: false } }));
  await page.route("**/v0/projects/*/file?*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "DELETE") {
      entries = [];
      return route.fulfill({ status: 204, body: "" });
    }
    if (request.method() === "PUT") {
      replacementIfMatch = request.headers()["if-match"] || "";
      content = request.postData() || "";
      modifiedAt += 1;
      revision = "revision-2";
      return route.fulfill({ json: { path: "app.js", size: content.length, modifiedAt, revision } });
    }
    if (url.searchParams.get("metadata") === "1") {
      return route.fulfill({ json: { path: "app.js", size: content.length, modifiedAt } });
    }
    return route.fulfill({ json: { path: "app.js", size: content.length, modifiedAt, revision, content } });
  });

  await openChatSurface(page);
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  const fileFilter = panel.getByRole("searchbox", { name: "Filter loaded files" });
  await fileFilter.focus();
  await panel.evaluate((element) => {
    window.__workspaceFocusLeaves = 0;
    element.addEventListener("focusout", (event) => {
      if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest('[data-shortcut-scope="workspace-panel"]')) {
        window.__workspaceFocusLeaves += 1;
      }
    });
  });
  await panel.getByText("Select a text file to preview it.").click();
  await expect(fileFilter).toBeFocused();
  expect(await page.evaluate(() => window.__workspaceFocusLeaves)).toBe(0);

  const file = panel.getByRole("treeitem", { name: "app.js" });
  await file.click();
  await expect(panel.getByText("export const version = 1;")).toBeVisible();

  await file.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Replace with upload…" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete file" })).toBeVisible();
  await expect(page.getByRole("menu")).toHaveAttribute("data-shortcut-scope", "workspace-panel");
  expect(await page.evaluate(() => document.activeElement instanceof Element
    && Boolean(document.activeElement.closest('[data-shortcut-scope="workspace-panel"]')))).toBe(true);
  await page.waitForTimeout(3_200);
  await expect(page.getByRole("menuitem", { name: "Replace with upload…" })).toBeVisible();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Replace with upload…" }).click();
  const chooser = await chooserPromise;
  page.once("dialog", (dialog) => dialog.accept());
  await chooser.setFiles({ name: "replacement.js", mimeType: "text/javascript", buffer: Buffer.from("export const version = 2;\n") });
  await expect.poll(() => replacementIfMatch).toBe("*");
  await expect(panel.getByText("export const version = 2;")).toBeVisible();
  await expect(page.getByText("Replaced app.js")).toBeVisible();

  content = "export const version = 3;\n";
  modifiedAt += 1;
  revision = "revision-3";
  await expect(panel.getByText("export const version = 3;"), "selected file refreshes after the polling interval").toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("app.js updated")).toBeVisible();

  await file.click({ button: "right" });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete file" }).click();
  await expect(file).toHaveCount(0);
  await expect(page.getByText("Deleted app.js")).toBeVisible();
});

test("workspace expansion preserves transcript geometry and scroll position", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop expansion geometry");
  await page.route("**/v0/sessions/session_existing", (route) => route.fulfill({ json: {
    id: "session_existing", projectId: "project_chat", status: "active", title: "Existing chat", model: model.spec,
    messages: [{ id: "long_answer", role: "assistant", content: Array.from({ length: 80 }, (_, i) => `Paragraph ${i}: This transcript must keep its width and reading position while the workspace expands and restores.`).join("\n\n") }], tools: [],
  } }));
  await page.goto("/chat/session_existing");
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  await expect(panel.getByRole("button", { name: "Expand Workspace" })).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
  const viewport = page.locator(".message-scroller-viewport");
  await viewport.evaluate((element) => { element.scrollTop = 400; });
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(400);
  const initialWidth = await page.locator(".transcript-motion-shell").evaluate((element) => element.getBoundingClientRect().width);
  for (const label of ["Expand Workspace", "Restore split view"]) {
    const samples = await panel.getByRole("button", { name: label }).evaluate((button) => new Promise((resolve) => {
      const samples = [];
      button.click();
      const frame = () => {
        const panel = document.querySelector(".workspace-panel").getBoundingClientRect();
        const surface = document.querySelector(".workspace-panel-surface").getBoundingClientRect();
        const shell = document.querySelector(".transcript-motion-shell");
        samples.push({ width: shell.getBoundingClientRect().width, scroll: document.querySelector(".message-scroller-viewport").scrollTop,
          visibility: getComputedStyle(shell).contentVisibility, gap: surface.left - panel.left, panelWidth: panel.width });
        if (samples.length < 25) requestAnimationFrame(frame); else resolve(samples);
      };
      requestAnimationFrame(frame);
    }));
    expect(samples.every((sample) => Math.abs(sample.width - initialWidth) < 1)).toBe(true);
    expect(samples.every((sample) => Math.abs(sample.scroll - 400) < 1)).toBe(true);
    expect(samples.every((sample) => sample.visibility !== "hidden" && Math.abs(sample.gap) < 1)).toBe(true);
    expect(new Set(samples.map((sample) => Math.round(sample.panelWidth))).size).toBeGreaterThan(2);
    await testInfo.attach(label, { body: JSON.stringify(samples), contentType: "application/json" });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await panel.getByRole("button", { name: "Expand Workspace" }).click();
  await panel.getByRole("button", { name: "Restore split view" }).click();
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(400);
  await expect.poll(() => page.locator(".transcript-motion-shell").evaluate((element) => element.style.getPropertyValue("--workspace-transcript-width"))).toBe("");
});

test("closed workspace shortcut animates the full maximized surface", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop maximized motion");
  await openChatSurface(page);
  await page.evaluate(() => {
    window.__maximizedFrames = [];
    const sample = () => {
      const panel = document.querySelector(".workspace-panel-expanded");
      if (panel) {
        const surface = panel.querySelector(".workspace-panel-surface");
        const box = surface.getBoundingClientRect();
        window.__maximizedFrames.push({ width: box.width, left: box.left, panelWidth: panel.getBoundingClientRect().width });
      }
      if (window.__maximizedFrames.length < 30) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await runRegisteredCommand(page, COMMAND_IDS.maximizeWorkspacePanel);
  await expect.poll(() => page.evaluate(() => window.__maximizedFrames.length)).toBe(30);
  const frames = await page.evaluate(() => window.__maximizedFrames);
  expect(frames.every((frame) => Math.abs(frame.width - frame.panelWidth) < 1)).toBe(true);
  expect(new Set(frames.map((frame) => Math.round(frame.left))).size).toBeGreaterThan(3);
  expect(frames.every((frame, index) => index === 0 || frame.left <= frames[index - 1].left + 1)).toBe(true);
  expect(frames[0].left - frames.at(-1).left).toBeGreaterThan(frames.at(-1).width / 2);
});

test("maximized workspace command toggles the workspace panel", async ({ page }) => {
  await openChatSurface(page);
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  const main = page.locator('[data-slot="sidebar-inset"]');

  await runPaletteCommand(page, "Toggle maximized workspace panel");
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await expect(main).toHaveClass(/workspace-expanded/);
  await expect(panel.getByRole("searchbox", { name: "Filter loaded files" })).toBeFocused();

  await runRegisteredCommand(page, COMMAND_IDS.maximizeWorkspacePanel);
  await expect(panel).toHaveCount(0);
});

test("two shortcuts reach docked, maximized and closed from any state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "docked panel geometry is desktop chrome");
  await openChatSurface(page);
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  const main = page.locator('[data-slot="sidebar-inset"]');
  const maximized = () => expect(main).toHaveClass(/workspace-expanded/);
  const docked = () => expect(main).not.toHaveClass(/workspace-expanded/);

  // closed -> docked -> closed
  await runRegisteredCommand(page, COMMAND_IDS.toggleWorkspacePanel);
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await docked();
  await runRegisteredCommand(page, COMMAND_IDS.toggleWorkspacePanel);
  await expect(panel).toHaveCount(0);

  // closed -> maximized, and toggle steps down to docked rather than closing
  await runRegisteredCommand(page, COMMAND_IDS.maximizeWorkspacePanel);
  await maximized();
  await runRegisteredCommand(page, COMMAND_IDS.toggleWorkspacePanel);
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await docked();

  // docked -> maximized -> closed, and reopening lands docked, never maximized
  await runRegisteredCommand(page, COMMAND_IDS.maximizeWorkspacePanel);
  await maximized();
  await runRegisteredCommand(page, COMMAND_IDS.maximizeWorkspacePanel);
  await expect(panel).toHaveCount(0);
  await runRegisteredCommand(page, COMMAND_IDS.toggleWorkspacePanel);
  await docked();
});

test("escape leaves the workspace panel open", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop panel chrome");
  await openChatSurface(page);
  const panel = page.getByRole("complementary", { name: "Workspace panel" });

  await runRegisteredCommand(page, COMMAND_IDS.toggleWorkspacePanel);
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await panel.getByRole("searchbox", { name: "Filter loaded files" }).press("Escape");
  await expect(panel).toHaveAttribute("aria-hidden", "false");

  await runRegisteredCommand(page, COMMAND_IDS.maximizeWorkspacePanel);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator('[data-slot="sidebar-inset"]')).toHaveClass(/workspace-expanded/);
});

test("maximized workspace opens an optional second pane", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "split panes are desktop chrome");
  await page.setViewportSize({ width: 2_200, height: 1_000 });
  await openChatSurface(page);
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  const header = panel.locator(".workspace-panel-header");

  await runPaletteCommand(page, "Toggle maximized workspace panel");
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await expect(header).not.toHaveAttribute("data-split", "true");
  await expect(header.getByRole("toolbar")).toHaveCount(1);

  await panel.getByRole("button", { name: "Split into two panes" }).click();
  await expect(header).toHaveAttribute("data-split", "true");
  await expect(header.getByRole("toolbar")).toHaveCount(2);
  const rightTabs = header.getByRole("toolbar", { name: "Right workspace pane views" });
  await expect(rightTabs.getByRole("tab", { name: "Source Control (right pane)" })).toHaveAttribute("aria-selected", "true");

  const sourcePane = panel.locator('.workspace-diff[data-position="right"]');
  const ledger = sourcePane.locator(".workspace-change-ledger");
  const sourceActionLabel = sourcePane.locator(".workspace-source-actions span").first();
  const sourceTabLabel = rightTabs.getByRole("tab", { name: "Source Control (right pane)" }).locator("span");
  await expect.poll(async () => (await sourcePane.boundingBox())?.width || 0).toBeGreaterThan(520);
  await expect(ledger).toHaveCSS("display", "grid");
  await expect(sourceTabLabel).toBeVisible();

  const divider = panel.getByRole("separator", { name: "Resize workspace panes" });
  await divider.press("End");
  await expect.poll(async () => Math.round((await sourcePane.boundingBox())?.width || 0)).toBe(240);
  await expect.poll(async () => Math.round((await panel.locator('.workspace-files[data-position="left"]').boundingBox())?.width || 0)).toBeGreaterThan(240);
  await expect(ledger).toHaveCSS("display", "flex");
  await expect(sourceActionLabel).toBeHidden();
  await expect(sourceTabLabel).toBeHidden();

  await divider.press("Home");
  await expect.poll(async () => Math.round((await panel.locator('.workspace-files[data-position="left"]').boundingBox())?.width || 0)).toBe(240);
  await expect.poll(async () => Math.round((await sourcePane.boundingBox())?.width || 0)).toBeGreaterThan(240);

  // Each strip drives its own pane, so the right strip retargets only the right half.
  await rightTabs.getByRole("tab", { name: "Terminal (right pane)" }).click();
  await expect(rightTabs.getByRole("tab", { name: "Terminal (right pane)" })).toHaveAttribute("aria-selected", "true");
  await expect(header.getByRole("toolbar", { name: "Left workspace pane views" }).getByRole("tab", { name: "Files (left pane)" })).toHaveAttribute("aria-selected", "true");
  const storedSplit = () => page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith(":secondary-tab"))?.[1] ?? null);
  expect(await storedSplit()).toBe("terminal");

  await runRegisteredCommand(page, COMMAND_IDS.workspaceSplit);
  await expect(header).not.toHaveAttribute("data-split", "true");
  await expect(header.getByRole("toolbar")).toHaveCount(1);
  expect(await storedSplit()).toBeNull();
});

test("navigation commands move focus and select workspace views", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "keyboard navigation over desktop header chrome");
  await openChatSurface(page);
  const composer = page.getByRole("textbox", { name: "Message Pi" });
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  const fileFilter = panel.getByRole("searchbox", { name: "Filter loaded files" });
  const chatPane = page.locator(".chat-main");

  await runPaletteCommand(page, "Focus composer");
  await expect(composer).toBeFocused();
  await page.locator(".chat-header-title").click();
  await expect(chatPane).toBeFocused();
  await expect(chatPane).toHaveCSS("outline-style", "none");
  await runPaletteCommand(page, "Focus workspace panel");
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await expect(fileFilter).toBeFocused();

  await runWorkspaceViewCommand(page, "Source Control");
  const sourceControl = panel.getByRole("tab", { name: "Source Control" });
  await expect(sourceControl).toHaveAttribute("aria-selected", "true");
  await expect(sourceControl).toBeFocused();
  await panel.locator(".workspace-panel-header strong").click();
  await expect(sourceControl).toBeFocused();
});

test("terminal workspace commands focus the attached shell", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "keyboard navigation over desktop header chrome");
  const shell = {
    id: "terminal_focus",
    projectId: "project_chat",
    status: "running",
    title: "Focus shell",
    currentCommand: "zsh",
  };
  await page.unroute("**/v0/ptys*");
  await page.route("**/v0/ptys*", (route) => route.fulfill({ json: { ptys: [shell] } }));
  await openChatSurface(page);
  await page.evaluate(() => {
    class TerminalWebSocket extends EventTarget {
      static OPEN = 1;
      readyState = 0;
      binaryType = "arraybuffer";
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;
      constructor() {
        super();
        queueMicrotask(() => {
          this.readyState = TerminalWebSocket.OPEN;
          this.onopen?.(new Event("open"));
          this.onmessage?.(new MessageEvent("message", {
            data: JSON.stringify({ type: "control", writable: true }),
          }));
        });
      }
      send() {}
      close() { this.readyState = 3; }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: TerminalWebSocket });
  });

  await runWorkspaceViewCommand(page, "Terminal");
  await expect(page.locator(".terminal-header-scope")).toHaveText("Chats");
  await expect(page.locator(".sidebar-terminal-copy small")).toContainText("Chats · zsh");
  const shellFocused = () => page.evaluate(() => Boolean(document.activeElement?.closest(".terminal-canvas")));
  await expect.poll(shellFocused).toBe(true);

  await page.locator(".chat-header-title").click();
  await expect(page.locator(".chat-main")).toBeFocused();
  await runPaletteCommand(page, "Focus workspace panel");
  await expect.poll(shellFocused).toBe(true);
});

test("rapid panel reversals continue from rendered geometry and release transcript locks @setpiece", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await openChatSurface(page);
  const sidebar = page.locator(".conduit-sidebar");
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  // Captured from the settled sidebar rather than written down: the expanded
  // width is an interface-scale decision and has already moved twice.
  const expandedWidth = (await sidebar.boundingBox()).width;
  const sidebarTrigger = sidebar.locator('[data-sidebar="trigger"]');
  const workspace = page.locator("aside.workspace-panel");
  const transcriptShell = page.locator(".transcript-motion-shell");
  const waitFrames = (count) => page.evaluate((frameCount) => new Promise((resolve) => {
    let remaining = frameCount;
    const frame = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), count);
  const sampleEdges = (selector, edge, count) => page.evaluate(({ targetSelector, targetEdge, frameCount }) => new Promise((resolve, reject) => {
    const target = document.querySelector(targetSelector);
    if (!target) {
      reject(new Error(`Missing motion target: ${targetSelector}`));
      return;
    }
    const samples = [];
    const frame = () => {
      samples.push(target.getBoundingClientRect()[targetEdge]);
      if (samples.length === frameCount) resolve(samples);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), { targetSelector: selector, targetEdge: edge, frameCount: count });
  const sampleTransforms = (selector, count) => page.evaluate(({ targetSelector, frameCount }) => new Promise((resolve, reject) => {
    const target = document.querySelector(targetSelector);
    if (!target) {
      reject(new Error(`Missing motion target: ${targetSelector}`));
      return;
    }
    const samples = [];
    const frame = () => {
      const transform = getComputedStyle(target).transform;
      samples.push(transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41);
      if (samples.length === frameCount) resolve(samples);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), { targetSelector: selector, frameCount: count });

  await expect(page.locator(".thread")).toBeVisible();
  await expect(workspace).toBeAttached();
  await sidebarTrigger.evaluate((element) => element.click());
  await waitFrames(3);
  const sidebarMid = await page.evaluate(() => {
    const shell = document.querySelector(".conduit-sidebar");
    return shell ? shell.getBoundingClientRect().width : 0;
  });
  expect(sidebarMid).toBeGreaterThan(52);
  expect(sidebarMid).toBeLessThanOrEqual(Math.round(expandedWidth));
  await sidebarTrigger.evaluate((element) => element.click());
  const sidebarReverse = await sampleEdges(".conduit-sidebar", "width", 8);
  expect(sidebarReverse[0]).toBeLessThanOrEqual(Math.round(expandedWidth));
  expect(sidebarReverse.every((value, index) =>
    index === 0 || value + 0.5 >= sidebarReverse[index - 1])).toBe(true);
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await expect.poll(async () => Math.round((await sidebar.boundingBox()).width)).toBe(Math.round(expandedWidth));

  await page.getByRole("button", { name: "Toggle workspace panel" }).evaluate((element) => element.click());
  await waitFrames(3);
  const workspaceMid = await page.evaluate(() => {
    const surface = document.querySelector(".workspace-panel-surface");
    if (!surface) return 0;
    const transform = getComputedStyle(surface).transform;
    return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
  });
  expect(workspaceMid).toBeGreaterThan(0);
  expect(workspaceMid).toBeLessThan(420);
  await workspace.getByRole("button", { name: "Close workspace panel" }).evaluate((element) => element.click());
  const workspaceReverse = await sampleTransforms(".workspace-panel-surface", 8);
  expect(workspaceReverse[0]).toBeGreaterThan(0);
  expect(workspaceReverse.every((value, index) =>
    index === 0 || value + 0.5 >= workspaceReverse[index - 1])).toBe(true);
  await expect(workspace).toHaveAttribute("aria-hidden", "true");
  await expect.poll(async () => Math.round((await workspace.boundingBox())?.width || 0)).toBe(0);
  await expect.poll(() => transcriptShell.evaluate((element) =>
    new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)).toBe(0);
  await expect(page.locator(".transcript")).not.toHaveAttribute("data-panel-motion");
});

test("desktop panel surfaces settle immediately with reduced motion @setpiece", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openChatSurface(page);
  const sidebar = page.locator(".conduit-sidebar");
  await page.locator('[data-sidebar="trigger"]').click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  expect(await sidebar.evaluate((element) => element.getAnimations().filter((animation) =>
    animation.effect instanceof KeyframeEffect && animation.effect.target === element).length)).toBe(0);
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.locator("aside.workspace-panel");
  const surface = panel.locator(".workspace-panel-surface");
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await expect(surface).toBeVisible();
  expect(await surface.evaluate((element) => element.getAnimations().every((animation) =>
    Number(animation.effect?.getTiming().duration || 0) <= 1))).toBe(true);
});

test.afterEach(async ({ page }) => {
  expect(unhandledApiRequests.get(page) || [], "all browser API requests must use deterministic mocks").toEqual([]);
});

test("creates a durable chat route and renders the primary surface", async ({ page }) => {
  const createRequest = page.waitForRequest((request) => request.url().endsWith("/v0/chats") && request.method() === "POST");
  await openChatSurface(page);
  await createRequest;
  await expect(page).toHaveURL(/\/chat\/550e8400-e29b-41d4-a716-446655440099$/);
  if (test.info().project.name === "desktop-chromium") {
    await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("ChatsNew chat");
  }

  await expect(page.getByRole("heading", { name: "How can I help you today?" })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message Pi" });
  await expect(composer).toHaveAttribute("placeholder", "Send a message...");
  await expect(composer).toHaveJSProperty("tagName", "TEXTAREA");

  const composerGroup = page.locator(".composer");
  const sendButton = page.getByRole("button", { name: "Send message" });
  const [groupBox, inputBox, sendBox] = await Promise.all([
    composerGroup.boundingBox(),
    composer.boundingBox(),
    sendButton.boundingBox(),
  ]);
  expect(groupBox.height).toBeGreaterThan(inputBox.height);
  expect(sendBox.y).toBeGreaterThan(inputBox.y);
  await expect(page.getByRole("button", { name: "Voice input" })).toHaveCount(0);
  await expect(sendButton).toBeDisabled();
  await expect(sendButton).toHaveAttribute("data-variant", "ghost");
  await composer.fill("Hello");
  await expect(sendButton).toBeEnabled();
  await expect(sendButton).toHaveAttribute("data-variant", "ghost");
});

test("Workspace views use the nested palette page and terminal lives in the Workspace panel", async ({ page }, testInfo) => {
  const workspace = {
    id: "project_conduit",
    slug: "conduit",
    name: "Conduit",
    kind: "workspace",
    origin: "linked",
    sessions: [{ id: "session_conduit", projectId: "project_conduit", status: "active", title: "Conduit work" }],
  };
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", async (route) => route.fulfill({ json: { projects: [...projects, workspace] } }));
  await page.route("**/v0/chats/session_conduit", async (route) => route.fulfill({ json: workspace.sessions[0] }));
  await page.route("**/v0/sessions/session_conduit", async (route) => route.fulfill({ json: { ...workspace.sessions[0], messages: [], tools: [] } }));
  await page.route("**/v0/ptys*", (route) => route.fulfill({ json: { ptys: [] } }));

  await page.goto("/chat/session_conduit");
  await expect(page.getByRole("region", { name: "Terminal pane" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open command palette", exact: true }).click({ force: true });
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeVisible();
  await page.getByRole("option", { name: "Workspace views…" }).click();
  await expect(page.getByText("Workspace ›")).toBeVisible();
  await page.getByRole("option", { name: "Terminal" }).click();
  const terminal = page.getByRole("region", { name: "Terminal pane" });
  await expect(terminal).toBeVisible();
  await expect(terminal).toContainText("Start or reattach a terminal");
  await expect(page.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
  const divider = page.getByRole("separator", { name: "Resize workspace panel" });
  if ((page.viewportSize()?.width || 0) > 760) {
    const box = await divider.boundingBox();
    const panel = page.getByRole("complementary", { name: "Workspace panel" });
    const originalWidth = (await panel.boundingBox()).width;
    await page.mouse.move(box.x + 4, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x - 60, box.y + 80);
    await page.mouse.up();
    expect((await panel.boundingBox()).width).toBeGreaterThan(originalWidth + 50);
  }
  await page.getByRole("tab", { name: "Files" }).click();
  await expect(terminal).toHaveCount(0);
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Conduit work" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open terminal" }).click();
  await expect(terminal).toBeVisible();
});

test("dashboard routes restore the workspace panel state for their project scope", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "workspace panel geometry is desktop state");
  await page.addInitScript(() => {
    localStorage.setItem("conduit:workspace-panel:project:project_chat:open", "true");
    localStorage.setItem("conduit:workspace-panel:project:project_chat:expanded", "false");
    localStorage.setItem("conduit:workspace-panel:project:project_research:open", "true");
    localStorage.setItem("conduit:workspace-panel:project:project_research:expanded", "true");
  });
  await page.route("**/v0/projects/*/dashboard", (route) => route.fulfill({ json: {
    identity: { path: "/tmp/research" },
    stats: { activeChats: 0, liveChats: 0, lastActivityAt: null },
    git: null,
  } }));

  await page.goto("/project/project_research");
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  const main = page.locator('[data-slot="sidebar-inset"]');
  await expect(page.getByRole("region", { name: "Research dashboard" })).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(main).toHaveClass(/workspace-expanded/);

  await page.locator(".sidebar-dashboard").click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Start where the work is." })).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(main).not.toHaveClass(/workspace-expanded/);

  await page.locator(".sidebar-project-link").filter({ hasText: "Research" }).click();
  await expect(page).toHaveURL("/project/project_research");
  await expect(panel).toBeVisible();
  await expect(main).toHaveClass(/workspace-expanded/);
});

test("workspace context menu opens its dashboard with the Workspace maximized", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "workspace panel geometry is desktop state");
  const workspace = {
    id: "project_conduit",
    slug: "conduit",
    name: "Conduit",
    kind: "workspace",
    origin: "linked",
    path: "/tmp/conduit",
    sessions: [],
  };
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [...projects, workspace] } }));
  await page.route("**/v0/projects/*/dashboard", (route) => route.fulfill({ json: {
    identity: { path: "/tmp/conduit" },
    stats: { activeChats: 0, liveChats: 0, lastActivityAt: null },
    git: null,
  } }));

  await page.goto("/");
  const workspaceRow = page.locator(".sidebar-project-block").filter({ hasText: "Conduit" }).first();
  await workspaceRow.locator(".sidebar-project-link").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open maximized Workspace" }).click();

  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  const main = page.locator('[data-slot="sidebar-inset"]');
  await expect.poll(() => page.evaluate(() => ({
    open: localStorage.getItem("conduit:workspace-panel:project:project_conduit:open"),
    expanded: localStorage.getItem("conduit:workspace-panel:project:project_conduit:expanded"),
  }))).toEqual({ open: "true", expanded: "true" });
  await expect(page).toHaveURL("/workspace/project_conduit");
  await expect(panel).toBeVisible();
  await expect(main).toHaveClass(/workspace-expanded/);

  await page.reload();
  await expect(panel).toBeVisible();
  await expect(main).toHaveClass(/workspace-expanded/);
  await panel.getByRole("button", { name: "Restore split view" }).click();
  await expect(main).not.toHaveClass(/workspace-expanded/);
  await expect(page.getByRole("region", { name: "Conduit dashboard" })).toBeVisible();
});

test("uses compact sidebar groups and preserves a useful desktop rail", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await openChatSurface(page);
  const sidebar = page.locator('[data-slot="sidebar"][data-state]');
  const main = page.locator('[data-slot="sidebar-inset"]');
  const sampleShellGeometry = () => page.evaluate(() => new Promise((resolve) => {
    const shell = document.querySelector('[data-slot="sidebar"][data-state]');
    const chat = document.querySelector('[data-slot="sidebar-inset"]');
    const transcript = document.querySelector(".thread");
    const samples = [];
    const sample = () => {
      samples.push({
        sidebarWidth: shell.getBoundingClientRect().width,
        surfaceLeft: shell.querySelector(".sidebar-container").getBoundingClientRect().left,
        mainLeft: chat.getBoundingClientRect().left,
        threadLeft: transcript.getBoundingClientRect().left,
        threadWidth: transcript.getBoundingClientRect().width,
      });
      if (samples.length === 8) resolve(samples);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  const mainBox = await main.boundingBox();

  await expect(page.locator('[data-sidebar="header"]').getByRole("button", { name: "Conduit", exact: true })).toBeVisible();
  await expect(page.locator('.sidebar-group-action[aria-label="New chat"]').first()).toBeVisible();
  await expect(page.getByRole("button", { name: "New folder" })).toBeVisible();
  await expect(page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit/ })).toBeVisible();
  await expect(page.locator('[data-sidebar="footer"]')).toContainText(/Server connected|Connecting|Reconnecting|unavailable/);
  // The three primary groups, in order. Optional groups (Pinned, Terminals)
  // appear only when they have contents, so this must not be an exact set.
  await expect(page.locator('[data-sidebar="group-label"]')
    .filter({ hasText: /^(Chats|Projects|Workspaces)$/ }))
    .toHaveText(["Chats", "Projects", "Workspaces"]);
  await expect(page.locator('[data-sidebar="brand"] svg')).toHaveCount(0);
  await expect(page.locator('[data-sidebar="trigger"] svg')).toHaveCount(1);

  await expect(page.locator('.sidebar-chat[aria-label="Existing chat"]')).toBeVisible();
  await expect(page.locator('[data-sidebar="rail"]')).toHaveCount(1);

  const [expandedSidebarBox, expandedTriggerBox] = await Promise.all([
    page.locator('[data-slot="sidebar-container"]').boundingBox(),
    page.locator('[data-sidebar="trigger"]:visible').boundingBox(),
  ]);
  // Trigger stays inside the sidebar chrome on the trailing edge (brand left).
  expect(expandedTriggerBox.x).toBeGreaterThanOrEqual(expandedSidebarBox.x);
  expect(expandedTriggerBox.x + expandedTriggerBox.width).toBeLessThanOrEqual(expandedSidebarBox.x + expandedSidebarBox.width + 1);
  expect(expandedTriggerBox.x).toBeGreaterThan(expandedSidebarBox.x + expandedSidebarBox.width / 2);

  await page.locator('[data-sidebar="trigger"]:visible').click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  const collapsedShellSamples = await sampleShellGeometry();
  expect(new Set(collapsedShellSamples.map((sample) => Math.round(sample.sidebarWidth))).size).toBeGreaterThan(3);
  expect(new Set(collapsedShellSamples.map((sample) => Math.round(sample.surfaceLeft))).size).toBeGreaterThan(3);
  expect(new Set(collapsedShellSamples.map((sample) => Math.round(sample.mainLeft))).size).toBeGreaterThan(3);
  expect(new Set(collapsedShellSamples.map((sample) => Math.round(sample.threadLeft))).size).toBeGreaterThan(3);
  expect(new Set(collapsedShellSamples.map((sample) => Math.round(sample.threadWidth))).size).toBeGreaterThan(3);
  expect(collapsedShellSamples.every((sample, index) =>
    index === 0 || sample.surfaceLeft <= collapsedShellSamples[index - 1].surfaceLeft + 0.5)).toBe(true);
  await expect.poll(async () => (await main.boundingBox()).x).toBeLessThan(mainBox.x);
  await expect(page.locator('[data-sidebar="header"] span', { hasText: "Conduit" })).toBeHidden();
  await expect(page.locator(".mobile-sidebar-trigger")).toBeHidden();
  const rail = sidebar.locator('[data-sidebar="rail-actions"]');
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("button", { name: "New chat", exact: true })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Chat: Existing chat", exact: true })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Project: Research", exact: true })).toBeVisible();
  await expect(rail.locator('[data-sidebar="rail-divider"]')).toHaveCount(1);

  const [collapsedSidebarBox, collapsedTriggerBox] = await Promise.all([
    page.locator('[data-slot="sidebar-container"]').boundingBox(),
    page.locator('[data-sidebar="trigger"]:visible').boundingBox(),
  ]);
  expect(collapsedTriggerBox.x).toBeGreaterThanOrEqual(collapsedSidebarBox.x);
  expect(collapsedTriggerBox.x + collapsedTriggerBox.width).toBeLessThanOrEqual(collapsedSidebarBox.x + collapsedSidebarBox.width + 1);

  await page.locator('[data-sidebar="trigger"]:visible').click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  const expandedShellSamples = await sampleShellGeometry();
  expect(new Set(expandedShellSamples.map((sample) => Math.round(sample.sidebarWidth))).size).toBeGreaterThan(3);
  expect(new Set(expandedShellSamples.map((sample) => Math.round(sample.surfaceLeft))).size).toBeGreaterThan(3);
  expect(new Set(expandedShellSamples.map((sample) => Math.round(sample.mainLeft))).size).toBeGreaterThan(3);
  expect(new Set(expandedShellSamples.map((sample) => Math.round(sample.threadLeft))).size).toBeGreaterThan(3);
  expect(new Set(expandedShellSamples.map((sample) => Math.round(sample.threadWidth))).size).toBeGreaterThan(3);
  expect(expandedShellSamples.every((sample, index) =>
    index === 0 || sample.surfaceLeft + 0.5 >= expandedShellSamples[index - 1].surfaceLeft)).toBe(true);
  await expect.poll(async () => (await main.boundingBox()).x).toBe(mainBox.x);

  await page.locator('[data-sidebar="trigger"]:visible').click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await page.locator('[data-sidebar="trigger"]:visible').click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await page.locator('[data-sidebar="trigger"]:visible').click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
});

// --- Transcript reading surface -------------------------------------------
// Covers the ergonomics work: the code-block card contract, the width presets,
// and the scroll behaviours that used to yank a reader back to the bottom.

const longCode = Array.from({ length: 60 }, (_, index) => `const line${index + 1} = ${index + 1};`).join("\n");

async function openTranscriptFixture(page, { body } = {}) {
  // Filler first, code last: the transcript opens pinned to the tail, so this
  // puts the cards on screen while still leaving plenty of room to scroll up.
  const content = body ?? [
    ...Array.from({ length: 60 }, (_, index) => `Filler paragraph ${index + 1} giving the transcript room to scroll.`),
    "Here is a long block.",
    ["```ts", longCode, "```"].join("\n"),
    "And a short one.",
    ["```sh", "echo hi", "```"].join("\n"),
  ].join("\n\n");
  await page.unroute("**/v0/sessions/session_existing");
  await page.route("**/v0/sessions/session_existing", async (route) => {
    await route.fulfill({ json: {
      id: "session_existing",
      projectId: "project_chat",
      status: "active",
      title: "Existing chat",
      model: model.spec,
      thinkingLevel: "medium",
      messages: [
        { id: "message_q", role: "user", content: "Show me some code" },
        { id: "message_a", role: "assistant", content, timestamp: "2026-07-15T06:49:27.768Z" },
      ],
      tools: [],
      page: { before: null },
    } });
  });
  await page.goto("/chat/session_existing");
  await expect(page.locator(".chat-markdown .artifact").first()).toBeVisible();
  // Blocks outside the overscan band are virtualized away with
  // content-visibility, so bring the cards into view before interacting.
  await page.locator(".chat-markdown .artifact").first().scrollIntoViewIfNeeded();
  await expect(page.locator(".chat-markdown .artifact .artifact-header").first()).toBeVisible();
}

test("renders persisted assistant Markdown with safe interactive controls", async ({ page }, testInfo) => {
  const markdown = [
    "## Markdown sample",
    "",
    "This is **strong**, *emphasized*, and `inline code`.",
    "Inline math: $E = mc^2$.",
    "",
    "$$",
    "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
    "$$",
    "",
    "- First item",
    "- Second item",
    "",
    "> A useful quotation",
    "",
    "| Feature | State |",
    "| --- | --- |",
    "| Tables | Working |",
    "",
    "```javascript",
    "const answer = 42;",
    "```",
    "",
    "[External documentation](https://example.com/docs)",
    "",
    "![Tracking image](https://example.com/tracker.png)",
    "",
    "<script>window.__markdownXss = true</script>",
    "[Unsafe link](javascript:window.__markdownXss=true)",
    "[Unsupported protocol](irc://example.com/channel)",
  ].join("\n");
  await page.route("**/v0/sessions/session_existing", async (route) => {
    await route.fulfill({ json: {
      messages: [
        { id: "message_existing", role: "user", content: "Show Markdown" },
        { id: "message_markdown", role: "assistant", content: markdown },
      ],
      tools: [],
    } });
  });
  await openChatSurface(page);
  await openSidebar(page, testInfo);
  // The dashboard lists the same chat as a project row, so scope to the sidebar.
  await page.locator('.sidebar-chat[aria-label="Existing chat"]').click();

  await expect(page.getByRole("heading", { name: "Markdown sample" })).toBeVisible();
  await expect(page.locator('[data-markdown="strong"]')).toHaveText("strong");
  await expect(page.locator(".chat-markdown ul li")).toHaveCount(2);
  await expect(page.locator(".chat-markdown blockquote")).toContainText("useful quotation");
  await expect(page.locator(".chat-markdown table")).toContainText("Tables");
  await expect(page.locator(".chat-markdown p > code")).toHaveText("inline code");
  await expect(page.locator(".katex")).toHaveCount(2);
  await expect(page.locator(".katex-display")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();
  await expect(page.locator('[data-language="javascript"] pre')).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator('a[href^="irc:"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__markdownXss)).toBeUndefined();

  await page.getByRole("button", { name: "External documentation" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Open external link?" });
  await expect(dialog).toContainText("https://example.com/docs");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("repairs unfinished Markdown while an assistant response streams @setpiece", async ({ page }) => {
  const streamedContent = "## Live response\n\n**still streaming**\n\nRead [the documentation][docs].\n\n```javascript\nconst answer = 42;\n```\n\n$$\nE = mc^2\n$$\n\n- **first item**\n\n  continued first item\n\n- `second item`\n\n[docs]: https://example.com/docs";
  await page.addInitScript((finalContent) => {
    class MockWebSocket extends EventTarget {
      static OPEN = 1;

      constructor() {
        super();
        this.readyState = 0;
        queueMicrotask(() => {
          this.readyState = MockWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        });
      }

      close() {
        this.readyState = 3;
      }

      send(data) {
        const request = JSON.parse(data);
        if (request.type !== "prompt") return;
        const emit = (payload, delay = 0) => setTimeout(() => this.onmessage?.({ data: JSON.stringify(payload) }), delay);
        emit({ type: "generation_started", generationId: "g1", seq: 1 });
        emit({ type: "assistant_message_started", generationId: "g1", seq: 2, messageId: "m1" });
        emit({ type: "content_block_started", generationId: "g1", seq: 3, messageId: "m1", block: { type: "text", contentIndex: 0, text: "" } });
        setTimeout(() => {
          emit({ type: "content_block_delta", generationId: "g1", seq: 4, messageId: "m1", blockType: "text", contentIndex: 0, delta: "## Live response\n\n" }, 0);
          emit({ type: "content_block_delta", generationId: "g1", seq: 5, messageId: "m1", blockType: "text", contentIndex: 0, delta: "**still streaming**\n\nRead [the documentation][docs].\n\n" }, 150);
          emit({ type: "content_block_delta", generationId: "g1", seq: 6, messageId: "m1", blockType: "text", contentIndex: 0, delta: "```javascript\nconst answer = 42;\n```\n\n" }, 300);
          emit({ type: "content_block_delta", generationId: "g1", seq: 7, messageId: "m1", blockType: "text", contentIndex: 0, delta: "$$\nE = mc^2\n$$" }, 450);
          emit({ type: "content_block_delta", generationId: "g1", seq: 8, messageId: "m1", blockType: "text", contentIndex: 0, delta: "\n\n- **first item**\n\n  continued first item\n\n- `second item`" }, 550);
          window.__releaseStreamFinal = () => {
            this.onmessage?.({ data: JSON.stringify({
              type: "assistant_message_completed",
              generationId: "g1",
              seq: 9,
              messageId: "m1",
              stopReason: "stop",
              blocks: [{ type: "text", contentIndex: 0, text: finalContent }],
            }) });
            setTimeout(() => this.onmessage?.({ data: JSON.stringify({
              type: "generation_settled",
              generationId: "g1",
              seq: 10,
            }) }), 50);
            setTimeout(() => this.onmessage?.({ data: JSON.stringify({
              type: "session_checkpoint",
              generationId: "g1",
              generationSeq: 10,
              chat: { id: "550e8400-e29b-41d4-a716-446655440099" },
            }) }), 100);
          };
        }, 0);
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: MockWebSocket,
    });
  }, streamedContent);
  await page.route("**/v0/sessions/550e8400-e29b-41d4-a716-446655440099", async (route) => {
    await route.fulfill({ json: {
      id: "550e8400-e29b-41d4-a716-446655440099",
      projectId: "project_chat",
      status: "active",
      title: "New chat",
      messages: [
        { id: "entry-user", role: "user", content: "Start streaming" },
        { id: "entry-assistant", role: "assistant", content: streamedContent },
      ],
      tools: [],
      page: { before: null },
    } });
  });
  await page.route("**/v0/live-sessions", async (route) => {
    await route.fulfill({ status: 201, json: { id: "live_stream", chatId: "550e8400-e29b-41d4-a716-446655440099", streamUrl: "/v0/live-sessions/live_stream/stream" } });
  });
  await openChatSurface(page);
  await page.getByRole("textbox", { name: "Message Pi" }).fill("Start streaming");
  const checkpointReload = page.waitForRequest((request) =>
    request.url().endsWith("/v0/sessions/550e8400-e29b-41d4-a716-446655440099"));
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("heading", { name: "Live response" })).toBeVisible();
  const liveHeading = page.getByRole("heading", { name: "Live response" });
  const liveHeadingNode = await liveHeading.elementHandle();
  expect(liveHeadingNode).not.toBeNull();
  await liveHeadingNode.evaluate((node) => node.setAttribute("data-stable-stream-node", "true"));
  const liveMarkdown = page.locator(".chat-markdown");
  await expect(liveMarkdown).toContainText("still streaming");
  const liveMarkdownNode = await liveMarkdown.elementHandle();
  expect(liveMarkdownNode).not.toBeNull();
  await liveMarkdownNode.evaluate((node) => node.setAttribute("data-before-final", "true"));
  await expect(page.locator('[data-language="javascript"]')).toBeVisible();
  await expect(page.locator('[data-language="javascript"] button[aria-label="Copy code"]')).toBeVisible();
  await expect(page.locator(".katex-display")).toBeVisible();
  await expect(liveMarkdown).toContainText("continued first item");
  await expect(page.locator(".chat-markdown li")).toHaveCount(2);
  await expect(page.locator(".chat-markdown strong", { hasText: "first item" })).toBeVisible();
  await expect(page.locator(".chat-markdown code", { hasText: "second item" })).toBeVisible();
  const liveListGap = await page.locator(".chat-markdown li").evaluateAll((items) => {
    const [first, second] = items.map((item) => item.getBoundingClientRect());
    return second.top - first.top;
  });
  const liveMarkdownHeight = await liveMarkdown.evaluate((element) => element.getBoundingClientRect().height);
  await expect(page.getByRole("button", { name: "the documentation" })).toHaveCount(0);
  await expect(page.locator("[data-stable-stream-node]")).toHaveCount(1);
  expect(await liveHeadingNode.evaluate((node) => node.isConnected && node === document.querySelector("[data-stable-stream-node]"))).toBe(true);
  await page.evaluate(() => window.__releaseStreamFinal());
  await expect(page.getByRole("button", { name: "the documentation" })).toBeVisible();
  await expect(page.locator(".chat-markdown li")).toHaveCount(2);
  await expect(page.locator(".chat-markdown li").first()).toContainText("continued first item");
  const settledListGap = await page.locator(".chat-markdown li").evaluateAll((items) => {
    const [first, second] = items.map((item) => item.getBoundingClientRect());
    return second.top - first.top;
  });
  expect(Math.abs(liveListGap - settledListGap)).toBeLessThanOrEqual(2);
  const settledMarkdownHeight = await liveMarkdown.evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.abs(liveMarkdownHeight - settledMarkdownHeight)).toBeLessThanOrEqual(4);
  await expect(page.locator("[data-stable-stream-node]")).toHaveCount(1);
  expect(await liveHeadingNode.evaluate((node) => node.isConnected)).toBe(true);
  const canonicalHeading = page.getByRole("heading", { name: "Live response" });
  const canonicalHeadingNode = await canonicalHeading.elementHandle();
  expect(canonicalHeadingNode).not.toBeNull();
  await canonicalHeadingNode.evaluate((node) => node.setAttribute("data-canonical-stream-node", "true"));
  await expect(page.getByRole("button", { name: "Copy Markdown" })).toBeVisible();
  await expect(page.locator(".chat-markdown[data-before-final]")).toHaveCount(1);
  expect(await liveMarkdownNode.evaluate((node) => node.isConnected && node === document.querySelector(".chat-markdown"))).toBe(true);
  await expect(page.locator(".server-markdown")).toHaveCount(0);
  await expect(page.locator('[data-language="javascript"]')).toBeVisible();
  await expect(page.locator(".katex-display")).toBeVisible();

  // Finalization and the durable checkpoint both reconcile in place: the live
  // canonical node survives and the welcome screen never flashes.
  await checkpointReload;
  await expect(page.locator(".chat-markdown[data-before-final]")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "How can I help you today?" })).toHaveCount(0);
  expect(await liveMarkdownNode.evaluate((node) => node.isConnected && node === document.querySelector(".chat-markdown"))).toBe(true);
  expect(await canonicalHeadingNode.evaluate((node) => node.isConnected && node === document.querySelector("[data-canonical-stream-node]"))).toBe(true);
  await expect(page.locator('[data-language="javascript"]')).toBeVisible();
  await expect(page.locator(".katex-display")).toBeVisible();
});

// The symptom, not the mechanism. A message full of KaTeX renders each formula
// from a growing partial, and every one of those renders is a different size,
// so the block above the caret can get shorter mid-generation. When it does the
// browser clamps scrollTop to the new bottom, the transcript stops following,
// and the reader is left behind while the answer keeps arriving. This watches
// for exactly that: content that shrinks under the reader, and a tail that
// stops tracking the bottom. It asserts nothing about how many times KaTeX runs
// or in what order, so it survives any change that keeps the page steady.
test("keeps a math-heavy answer steady and followed while it streams @setpiece", async ({ page }) => {
  const formulas = [
    "\\frac{\\partial u}{\\partial t} = \\alpha \\nabla^{2} u",
    "\\int_{-\\infty}^{\\infty} e^{-x^{2}}\\,dx = \\sqrt{\\pi}",
    "\\sum_{k=1}^{n} k^{3} = \\left(\\frac{n(n+1)}{2}\\right)^{2}",
    "\\begin{aligned} A &= \\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix} \\\\ \\det A &= ad - bc \\end{aligned}",
  ];
  const paragraph = "Each step below follows from the previous one, and the derivation continues across several lines of prose so the transcript is long enough to scroll.";
  const finalContent = formulas
    .map((formula, index) => `### Step ${index + 1}\n\n${paragraph}\n\n$$\n${formula}\n$$\n\nWhich gives an inline result of $x_{${index}} = ${index + 1}$ for this step.`)
    .join("\n\n");

  await page.addInitScript((content) => {
    // Small deltas on purpose: each one lands mid-formula, which is the state
    // that produces a fresh KaTeX render of a different size.
    const deltas = [];
    for (let cursor = 0; cursor < content.length; cursor += 18) deltas.push(content.slice(cursor, cursor + 18));

    class MockWebSocket extends EventTarget {
      static OPEN = 1;

      constructor() {
        super();
        this.readyState = 0;
        queueMicrotask(() => {
          this.readyState = MockWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        });
      }

      close() {
        this.readyState = 3;
      }

      send(data) {
        const request = JSON.parse(data);
        if (request.type !== "prompt") return;
        const emit = (payload, delay) => setTimeout(() => this.onmessage?.({ data: JSON.stringify(payload) }), delay);
        emit({ type: "generation_started", generationId: "g1", seq: 1 }, 0);
        emit({ type: "assistant_message_started", generationId: "g1", seq: 2, messageId: "m1" }, 0);
        emit({ type: "content_block_started", generationId: "g1", seq: 3, messageId: "m1", block: { type: "text", contentIndex: 0, text: "" } }, 0);
        let seq = 4;
        deltas.forEach((delta, index) => {
          emit({ type: "content_block_delta", generationId: "g1", seq: seq += 1, messageId: "m1", blockType: "text", contentIndex: 0, delta }, index * 12);
        });
        const settledAt = deltas.length * 12 + 40;
        emit({
          type: "assistant_message_completed",
          generationId: "g1",
          seq: seq += 1,
          messageId: "m1",
          stopReason: "stop",
          blocks: [{ type: "text", contentIndex: 0, text: content }],
        }, settledAt);
        emit({ type: "generation_settled", generationId: "g1", seq: seq += 1 }, settledAt + 40);
      }
    }

    Object.defineProperty(window, "WebSocket", { configurable: true, value: MockWebSocket });

    // Sample every frame from first paint to the end of the run. Recording the
    // worst case rather than a snapshot is what makes this a symptom watch: a
    // single shrink anywhere during generation is the defect, and polling from
    // the test side would step straight over it.
    window.__mathWatch = { shrinkPx: 0, detached: false, frames: 0 };
    const tick = () => {
      const markdown = document.querySelector(".chat-markdown");
      if (markdown) {
        const watch = window.__mathWatch;
        const height = markdown.getBoundingClientRect().height;
        if (watch.height != null) watch.shrinkPx = Math.max(watch.shrinkPx, watch.height - height);
        watch.height = height;
        // The button exists only while the app has handed the tail to the
        // reader. That is the detachment itself, not a proxy for it -- and
        // unlike a distance-from-bottom threshold it cannot be tripped by a
        // slow machine dropping frames, because a dropped frame does not
        // transfer scroll ownership.
        if (document.querySelector('[aria-label="Scroll to latest"]')) watch.detached = true;
        watch.frames += 1;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, finalContent);

  await page.route("**/v0/live-sessions", async (route) => {
    await route.fulfill({ status: 201, json: { id: "live_math", chatId: "550e8400-e29b-41d4-a716-446655440099", streamUrl: "/v0/live-sessions/live_math/stream" } });
  });

  await openChatSurface(page);
  await page.getByRole("textbox", { name: "Message Pi" }).fill("Derive it");
  // Wait for the composer to arm rather than letting click() sit on a disabled
  // button until the test times out: on a loaded machine the model and template
  // fetches this depends on can still be in flight, and a bare click reports
  // that as an unexplained 45s hang.
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeEnabled({ timeout: 20000 });
  await send.click();

  // Every formula rendered, and the last one only exists after the whole
  // message has streamed, so reaching it means the run completed.
  await expect(page.locator(".katex-display")).toHaveCount(formulas.length, { timeout: 20000 });
  await expect(page.getByRole("heading", { name: `Step ${formulas.length}` })).toBeVisible();
  await expect(page.locator(".chat-markdown[data-settled='true']")).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator(".chat-markdown[data-streaming]")).toHaveCount(0);
  await expect(page.locator("[data-streaming-pending]")).toHaveCount(0);
  await expect(page.locator(".katex-error")).toHaveCount(0);

  const watch = await page.evaluate(() => window.__mathWatch);
  expect(watch.frames).toBeGreaterThan(30);
  // One layout pass can legitimately reclaim a sub-pixel row. A formula
  // collapsing to a shorter render is tens of pixels, and that is the symptom.
  expect(watch.shrinkPx).toBeLessThan(8);
  // Nobody scrolled, so nothing should ever have taken the tail from the app.
  expect(watch.detached).toBe(false);
  // And it arrived at the bottom rather than merely never letting go. Polled,
  // not sampled: the tail is a spring, so on a loaded machine it can still be
  // travelling when the last assertion resolves.
  await expect.poll(async () => page.locator('[data-slot="message-scroller-viewport"]')
    .evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
  { timeout: 10000 }).toBeLessThan(24);
});

// Streaming cost is dominated by how much DOM each delta touches, and that is a
// number no frame-time assertion can pin down on a loaded machine. Count the
// mutations instead: a renderer that patches the tail touches a handful of nodes
// per character, one that rebuilds the message touches the whole tree every
// delta, and the ratio separates them by an order of magnitude regardless of how
// fast the machine is.
test("streams by patching the tail rather than rebuilding the message @setpiece", async ({ page }) => {
  const paragraph = "The derivation proceeds one clause at a time, and each sentence adds enough prose that the renderer has to lay out a fresh line rather than merely extending the last word on the current one.";
  const finalContent = Array.from({ length: 6 }, (_, index) => `### Part ${index + 1}\n\n${paragraph}`).join("\n\n");

  await page.addInitScript((content) => {
    const deltas = [];
    for (let cursor = 0; cursor < content.length; cursor += 8) deltas.push(content.slice(cursor, cursor + 8));

    class MockWebSocket extends EventTarget {
      static OPEN = 1;

      constructor() {
        super();
        this.readyState = 0;
        queueMicrotask(() => {
          this.readyState = MockWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        });
      }

      close() { this.readyState = 3; }

      send(data) {
        const request = JSON.parse(data);
        if (request.type !== "prompt") return;
        const emit = (payload, delay) => setTimeout(() => this.onmessage?.({ data: JSON.stringify(payload) }), delay);
        emit({ type: "generation_started", generationId: "g1", seq: 1 }, 0);
        emit({ type: "assistant_message_started", generationId: "g1", seq: 2, messageId: "m1" }, 0);
        emit({ type: "content_block_started", generationId: "g1", seq: 3, messageId: "m1", block: { type: "text", contentIndex: 0, text: "" } }, 0);
        let seq = 4;
        deltas.forEach((delta, index) => {
          emit({ type: "content_block_delta", generationId: "g1", seq: seq += 1, messageId: "m1", blockType: "text", contentIndex: 0, delta }, index * 10);
        });
        const settledAt = deltas.length * 10 + 40;
        emit({ type: "assistant_message_completed", generationId: "g1", seq: seq += 1, messageId: "m1", stopReason: "stop", blocks: [{ type: "text", contentIndex: 0, text: content }] }, settledAt);
        emit({ type: "generation_settled", generationId: "g1", seq: seq += 1 }, settledAt + 40);
      }
    }

    Object.defineProperty(window, "WebSocket", { configurable: true, value: MockWebSocket });

    window.__domWatch = { mutations: 0, characters: content.length, attached: false };
    const attach = () => {
      const markdown = document.querySelector(".chat-markdown");
      if (!markdown) return requestAnimationFrame(attach);
      window.__domWatch.attached = true;
      new MutationObserver((records) => {
        for (const record of records) {
          window.__domWatch.mutations += record.type === "childList"
            ? record.addedNodes.length + record.removedNodes.length
            : 1;
        }
      }).observe(markdown, { childList: true, subtree: true, characterData: true });
    };
    requestAnimationFrame(attach);
  }, finalContent);

  await page.route("**/v0/live-sessions", async (route) => {
    await route.fulfill({ status: 201, json: { id: "live_dom", chatId: "550e8400-e29b-41d4-a716-446655440099", streamUrl: "/v0/live-sessions/live_dom/stream" } });
  });

  await openChatSurface(page);
  await page.getByRole("textbox", { name: "Message Pi" }).fill("Explain it");
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeEnabled({ timeout: 20000 });
  await send.click();

  await expect(page.getByRole("heading", { name: "Part 6" })).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".chat-markdown[data-settled='true']")).toHaveCount(1, { timeout: 10000 });

  const watch = await page.evaluate(() => window.__domWatch);
  expect(watch.attached).toBe(true);
  // Ceiling, not a target. Patching the tail measures ~0.12 mutations per
  // streamed character; rebuilding the message on each delta puts it two orders
  // of magnitude higher. 0.5 leaves room for markup churn without going blind.
  expect(watch.mutations / watch.characters).toBeLessThan(0.5);
});

// This is the shape that was silently broken for months. A message containing
// display math is deliberately kept fully laid out until it settles, because
// virtualising a KaTeX block before the root has inline-size containment shifts
// the equations. The escape hatch -- virtualise it once settled -- depended on a
// settled signal that never fired, so every math-heavy message stayed fully laid
// out forever, and panel motion over a long transcript paid to lay all of it out
// again. Text-only transcripts were unaffected, which is exactly how it stayed
// hidden. Assert the structure rather than a frame time: a loaded transcript
// settles, and its offscreen math blocks are virtualised.
test("virtualizes a settled math-heavy transcript loaded from history @setpiece", async ({ page }, testInfo) => {
  const heavy = (index) => [
    "## Section " + index,
    "",
    "Prose for section " + index + " with **strong**, *emphasis*, `inline code` and inline math $x_{" + index + "} = \\alpha^{2}$ so the line carries real content.",
    "",
    "$$",
    "\\sum_{k=1}^{n} \\frac{k^{" + (index % 5 + 1) + "}}{\\sqrt{k+1}} = \\int_{0}^{\\infty} e^{-t} t^{" + (index % 3) + "} \\, dt",
    "$$",
    "",
    "```javascript",
    ...Array.from({ length: 18 }, (_, line) => "const value" + line + " = compute(" + index + ", " + line + "); // a reasonably long line of code"),
    "```",
  ].join("\n");
  const messages = [];
  for (let index = 0; index < 30; index += 1) {
    messages.push({ id: "u" + index, role: "user", content: "Question " + index });
    messages.push({ id: "a" + index, role: "assistant", content: heavy(index) });
  }
  await page.route("**/v0/sessions/session_existing", async (route) => {
    await route.fulfill({ json: { messages, tools: [], page: { before: null } } });
  });
  await openChatSurface(page);
  await openSidebar(page, testInfo);
  await page.locator('.sidebar-chat[aria-label="Existing chat"]').click();
  await expect(page.locator(".katex-display").first()).toBeVisible();

  // Every restored message settles. One leftover streaming marker anywhere in a
  // message is enough to hold it open forever, which is what happened.
  await expect.poll(async () => page.locator(".chat-markdown[data-settled='true']").count(), { timeout: 20000 })
    .toBe(30);
  await expect(page.locator("[data-streaming-pending]")).toHaveCount(0);

  // And settlement actually reaches the virtualizer: offscreen blocks inside
  // math-containing messages are the ones that were never being managed.
  const virtualizedMathMessages = await page.evaluate(() => {
    let count = 0;
    for (const root of document.querySelectorAll(".chat-markdown")) {
      if (!root.querySelector(".katex-display")) continue;
      if (root.querySelector('.incremark > [data-transcript-visibility="hidden"]')) count += 1;
    }
    return count;
  });
  expect(virtualizedMathMessages).toBeGreaterThan(5);
});
