import { expect, test } from "@playwright/test";

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
    await route.fulfill({ json: { folders: [] } });
  });
  await page.route("**/v0/preferences", async (route) => {
    const body = route.request().postDataJSON?.() || {};
    await route.fulfill({ json: { defaultTemplateId: body.defaultTemplateId || "chat" } });
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
  await page.route("**/v0/ptys", async (route) => {
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
      : [{ name: "src", path: "src", type: "directory" }, { name: "README.md", path: "README.md", type: "file" }] } });
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

test("workspace panel previews files, shows diff, and persists per chat", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  await expect(panel).toBeVisible();
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
    expect(resizeSamples.every((sample) => Math.abs(sample.gapMainToSurface - 10) < 1.5)).toBe(true);
    expect(resizeSamples.every((sample) => Math.abs(sample.gapMotionToSurface - 10) < 1.5)).toBe(true);
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
    expect(Math.abs(releasedGeometry.transcript.x - previewGeometry.transcript.x)).toBeLessThan(1);
    expect(Math.abs(releasedGeometry.transcript.width - previewGeometry.transcript.width)).toBeLessThan(1);
    expect(Math.abs(releasedGeometry.motion.x - previewGeometry.motion.x)).toBeLessThan(1);
    expect(Math.abs(releasedGeometry.motion.width - previewGeometry.motion.width)).toBeLessThan(1);
  }
  await panel.getByRole("button", { name: "src" }).click();
  await panel.getByRole("button", { name: "main.ts" }).click();
  await expect(panel.getByText("export function startConduit() {}" )).toBeVisible();
  await panel.getByRole("button", { name: /File preview/ }).click();
  await expect(panel.getByRole("region", { name: "File preview" })).toHaveCount(0);
  await panel.getByRole("button", { name: /File preview/ }).click();
  await panel.getByRole("tab", { name: "Source Control" }).click();
  await expect(panel.getByText("1 changed file")).toBeVisible();
  await expect(panel.getByText("src/main.ts")).toBeVisible();
  await expect(panel.getByText("agent/rhs-panel-mvp", { exact: true })).toBeVisible();
  await expect(panel.getByText("Add workspace panel")).toBeVisible();
  await panel.getByRole("button", { name: /Working tree patch/ }).click();
  const patchHandle = panel.getByRole("separator", { name: "Resize working tree patch" });
  await expect(patchHandle).toBeVisible();
  const originalPatchHeight = Number(await patchHandle.getAttribute("aria-valuenow"));
  await patchHandle.focus();
  await page.keyboard.press("ArrowUp");
  await expect(patchHandle).toHaveAttribute("aria-valuenow", String(originalPatchHeight + 20));
  await panel.getByRole("tab", { name: "Artifacts" }).click();
  await expect(panel.getByText("No artifacts in the loaded transcript")).toBeVisible();
  await panel.getByRole("radio", { name: "Interactive UI" }).click();
  await expect(panel.getByText("Interactive artifacts are not enabled")).toBeVisible();
  await panel.getByRole("tab", { name: "Source Control" }).click();
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Workspace panel" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Source Control" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+." : "Control+.");
  await expect(page.getByRole("complementary", { name: "Workspace panel" })).toHaveCount(0);
});

test("desktop workspace shell and surface ease open and close together", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.goto("/");
  const panel = page.locator("aside.workspace-panel");
  const surface = panel.locator(".workspace-panel-surface");
  const sampleShellGeometry = () => page.evaluate(() => new Promise((resolve, reject) => {
    const shell = document.querySelector("aside.workspace-panel");
    const chat = document.querySelector('[data-slot="sidebar-inset"]');
    const transcript = document.querySelector(".thread");
    const motionShell = document.querySelector(".transcript-motion-shell");
    if (!shell || !chat || !transcript || !motionShell) {
      reject(new Error("Workspace shell, chat main, or transcript is not mounted"));
      return;
    }
    const samples = [];
    const sample = () => {
      const shellBox = shell.getBoundingClientRect();
      const surfaceBox = shell.querySelector(".workspace-panel-surface").getBoundingClientRect();
      const chatBox = chat.getBoundingClientRect();
      const motionBox = motionShell.getBoundingClientRect();
      const surfaceTransform = getComputedStyle(shell.querySelector(".workspace-panel-surface")).transform;
      const surfaceStyles = getComputedStyle(shell.querySelector(".workspace-panel-surface"));
      samples.push({
        panelWidth: shellBox.width,
        surfaceWidth: surfaceBox.width,
        surfaceLeft: surfaceBox.left,
        surfaceTranslateX: surfaceTransform === "none" ? 0 : new DOMMatrixReadOnly(surfaceTransform).m41,
        surfaceOpacity: Number(surfaceStyles.opacity),
        shellLeft: shellBox.left,
        mainRight: chatBox.right,
        // Chat-main right margin keeps ~10px between main and the shell edge.
        gapMainToShell: shellBox.left - chatBox.right,
        gapMotionToShell: shellBox.left - motionBox.right,
        threadLeft: transcript.getBoundingClientRect().left,
        threadWidth: transcript.getBoundingClientRect().width,
      });
      if (samples.length === 10) resolve(samples);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));

  await expect(page.locator(".thread")).toBeVisible();
  await expect(panel).toBeAttached();
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const openSamples = await sampleShellGeometry();
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await expect(panel).not.toHaveAttribute("inert", "");
  // The shell commits once; the visible Workspace surface slides from the right
  // edge while the transcript stays on its final geometry.
  expect(new Set(openSamples.map((sample) => Math.round(sample.surfaceTranslateX))).size).toBeGreaterThan(3);
  expect(openSamples.every((sample, index) =>
    index === 0 || sample.surfaceTranslateX <= openSamples[index - 1].surfaceTranslateX + 0.5)).toBe(true);
  expect(openSamples.every((sample) => sample.surfaceOpacity >= 0.99)).toBe(true);
  expect(openSamples.filter((sample) => sample.panelWidth > 8).every((sample) => Math.abs(sample.gapMainToShell - 10) < 2)).toBe(true);
  const openShellPaint = await page.evaluate(() => {
    const shell = document.querySelector("aside.workspace-panel");
    const surface = shell.querySelector(".workspace-panel-surface");
    const styles = getComputedStyle(shell);
    return {
      background: styles.backgroundColor,
      open: shell.classList.contains("workspace-panel-open"),
      surfaceOpacity: getComputedStyle(surface).opacity,
    };
  });
  expect(openShellPaint.open).toBe(true);
  expect(openShellPaint.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(openShellPaint.background).not.toBe("transparent");
  const [surfaceBox, closeBox, resizeBox, panelBox, mainBox] = await Promise.all([
    surface.boundingBox(),
    panel.getByRole("button", { name: "Close workspace panel" }).boundingBox(),
    panel.getByRole("separator", { name: "Resize workspace panel" }).boundingBox(),
    panel.boundingBox(),
    page.locator('[data-slot="sidebar-inset"]').boundingBox(),
  ]);
  expect(surfaceBox.x + surfaceBox.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  expect(resizeBox.width).toBeGreaterThanOrEqual(24);
  // Gutter is centered on the shell's left edge (between chat and panel).
  expect(resizeBox.x).toBeLessThan(panelBox.x);
  expect(resizeBox.x + resizeBox.width).toBeGreaterThan(panelBox.x);
  expect(resizeBox.x).toBeGreaterThanOrEqual(mainBox.x + mainBox.width - resizeBox.width);

  await panel.getByRole("button", { name: "Close workspace panel" }).click();
  const closeSamples = await sampleShellGeometry();
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await expect(panel).toHaveAttribute("inert", "");
  expect(new Set(closeSamples.map((sample) => Math.round(sample.surfaceTranslateX))).size).toBeGreaterThan(3);
  expect(closeSamples.every((sample, index) =>
    index === 0 || sample.surfaceTranslateX + 0.5 >= closeSamples[index - 1].surfaceTranslateX)).toBe(true);
  expect(closeSamples[0].surfaceOpacity).toBeGreaterThanOrEqual(0.99);
  expect(closeSamples
    .filter((sample) => sample.surfaceTranslateX < sample.surfaceWidth - 1)
    .every((sample) => sample.surfaceOpacity >= 0.99)).toBe(true);

  await page.keyboard.press(process.platform === "darwin" ? "Meta+." : "Control+.");
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+." : "Control+.");
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await expect.poll(async () => Math.round((await panel.boundingBox())?.width || 0)).toBe(0);
});

test("rapid panel reversals continue from rendered geometry and release transcript locks", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.goto("/");
  const sidebar = page.locator(".conduit-sidebar");
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
  expect(sidebarMid).toBeLessThan(244);
  await sidebarTrigger.evaluate((element) => element.click());
  const sidebarReverse = await sampleEdges(".conduit-sidebar", "width", 8);
  expect(sidebarReverse[0]).toBeLessThan(244);
  expect(sidebarReverse.every((value, index) =>
    index === 0 || value + 0.5 >= sidebarReverse[index - 1])).toBe(true);
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await expect.poll(async () => Math.round((await sidebar.boundingBox()).width)).toBe(244);

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

test("overlapping resize and panel motion cannot retain transcript preview geometry", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const workspace = page.locator("aside.workspace-panel");
  const handle = workspace.getByRole("separator", { name: "Resize workspace panel" });
  await expect(workspace).toHaveAttribute("aria-hidden", "false");
  await page.waitForTimeout(180);

  const handleBox = await handle.boundingBox();
  await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 72, handleBox.y + 100, { steps: 6 });
  await page.locator('[data-sidebar="trigger"]').evaluate((element) => element.click());
  await page.mouse.up();

  const transcript = page.locator(".transcript");
  const motionShell = page.locator(".transcript-motion-shell");
  await expect(transcript).not.toHaveAttribute("data-panel-motion");
  await expect.poll(() => motionShell.evaluate((element) => element.style.width)).toBe("");
  const settled = await page.evaluate(() => {
    const transcript = document.querySelector(".transcript").getBoundingClientRect();
    const shell = document.querySelector(".transcript-motion-shell").getBoundingClientRect();
    const surface = document.querySelector(".workspace-panel-surface").getBoundingClientRect();
    return {
      transcriptWidth: transcript.width,
      shellWidth: shell.width,
      gap: surface.left - shell.right,
    };
  });
  expect(Math.abs(settled.transcriptWidth - settled.shellWidth)).toBeLessThan(1);
  expect(Math.abs(settled.gap - 10)).toBeLessThan(1);

  await page.locator('[data-sidebar="trigger"]').click();
  const secondHandleBox = await handle.boundingBox();
  await page.mouse.move(secondHandleBox.x + (secondHandleBox.width / 2), secondHandleBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(secondHandleBox.x - 48, secondHandleBox.y + 100, { steps: 4 });
  await page.getByRole("button", { name: "Existing chat" }).evaluate((element) => element.click());
  await page.mouse.up();
  await expect(page.getByText("Previous question")).toBeVisible();
  await expect.poll(() => motionShell.evaluate((element) => element.style.width)).toBe("");

  if (await workspace.getAttribute("aria-hidden") === "false") {
    await workspace.getByRole("button", { name: "Close workspace panel" }).click();
  }
  await expect(workspace).toHaveCSS("width", "0px");
  await expect.poll(() => motionShell.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(200);
  await expect.poll(() => motionShell.evaluate((element) => Math.abs(
    element.getBoundingClientRect().width - element.parentElement.getBoundingClientRect().width,
  ))).toBeLessThan(1);
  const tableGeometry = await page.evaluate(() => {
    const markdown = document.createElement("div");
    markdown.className = "chat-markdown";
    markdown.dataset.renderer = "incremark-synthetic";
    markdown.innerHTML = "<div class=\"incremark\"><table><tbody><tr><td>one</td><td>two</td></tr></tbody></table></div>";
    document.querySelector(".thread").append(markdown);
    const table = markdown.querySelector("table").getBoundingClientRect();
    return {
      markdownWidth: markdown.getBoundingClientRect().width,
      tableWidth: table.width,
    };
  });
  expect(Math.abs((tableGeometry.tableWidth / tableGeometry.markdownWidth) - 1.5)).toBeLessThan(0.01);
});

test("explicit transcript visibility preserves offscreen geometry and reveals scrolled blocks", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  const content = Array.from({ length: 24 }, (_, index) =>
    `## Section ${index + 1}\n\n${"This section has enough text to occupy several wrapped lines while the transcript width changes. ".repeat(4)}`).join("\n\n");
  await page.route("**/v0/sessions/session_existing", (route) => route.fulfill({ json: {
    id: "session_existing",
    projectId: "project_chat",
    status: "active",
    title: "Existing chat",
    model: model.spec,
    thinkingLevel: "medium",
    messages: [
      { id: "message_existing", role: "user", content: "Previous question" },
      { id: "message_long", role: "assistant", content },
    ],
    tools: [],
  } }));
  await page.goto("/?markdownRenderer=incremark");
  await page.getByRole("button", { name: "Existing chat" }).click();
  const blocks = page.locator(".chat-markdown > .incremark > *");
  await expect(blocks).toHaveCount(48);
  await expect.poll(() => page.locator('[data-transcript-visibility="hidden"]').count()).toBeGreaterThan(20);

  const before = await page.evaluate(() => {
    const viewport = document.querySelector(".message-scroller-viewport");
    return { scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight };
  });
  await page.evaluate(() => {
    const viewport = document.querySelector(".message-scroller-viewport");
    viewport.scrollTop = Math.round(viewport.scrollHeight * 0.45);
  });
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => {
    const viewport = document.querySelector(".message-scroller-viewport");
    const bounds = viewport.getBoundingClientRect();
    const crossing = [...document.querySelectorAll(".chat-markdown > .incremark > *")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom >= bounds.top && rect.top <= bounds.bottom;
      });
    return {
      scrollHeight: viewport.scrollHeight,
      crossing: crossing.length,
      hiddenCrossing: crossing.filter((element) =>
        element.getAttribute("data-transcript-visibility") === "hidden").length,
    };
  });
  expect(after.crossing).toBeGreaterThan(0);
  expect(after.hiddenCrossing).toBe(0);
  expect(Math.abs(after.scrollHeight - before.scrollHeight)).toBeLessThan(before.clientHeight * 0.1);
});

test("desktop panel surfaces settle immediately with reduced motion", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const sidebar = page.locator(".conduit-sidebar");
  await page.locator('[data-sidebar="trigger"]').click();
  await expect(sidebar).toHaveCSS("width", "52px");
  expect(await sidebar.evaluate((element) => element.getAnimations().filter((animation) =>
    animation.effect instanceof KeyframeEffect && animation.effect.target === element).length)).toBe(0);
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.locator("aside.workspace-panel");
  const surface = panel.locator(".workspace-panel-surface");
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await expect(panel).toHaveCSS("width", "420px");
  await expect(surface).toHaveCSS("transform", "none");
  await expect(surface).toHaveCSS("opacity", "1");
  expect(await surface.evaluate((element) => element.getAnimations().every((animation) =>
    Number(animation.effect?.getTiming().duration || 0) <= 1))).toBe(true);
});

test("reselecting the active chat does not reload its transcript or workspace", async ({ page }, testInfo) => {
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Existing chat" }).click();
  await expect(page.getByText("Previous question")).toBeVisible();
  const activeChat = page.locator(".sidebar-chat[aria-current='page']");
  await expect(activeChat).toHaveText("Existing chat");
  const requests = [];
  page.on("request", (request) => {
    if (request.url().includes("/v0/sessions/session_existing")) requests.push(request.url());
  });

  await openSidebar(page, testInfo);
  await activeChat.click();
  await page.waitForTimeout(150);

  expect(requests).toEqual([]);
  await expect(activeChat).toHaveAttribute("aria-current", "page");
});

test("keeps the workspace panel mounted and warm between chats in one project", async ({ page }, testInfo) => {
  const sibling = { id: "session_other", projectId: "project_chat", status: "draft", title: "Other chat" };
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", async (route) => {
    await route.fulfill({ json: { projects: [{ ...projects[0], sessions: [...projects[0].sessions, sibling] }, projects[1]] } });
  });
  await page.route("**/v0/sessions/session_other", async (route) => {
    await route.fulfill({ json: { ...sibling, messages: [], tools: [] } });
  });
  let diffRequests = 0;
  await page.route("**/v0/projects/*/diff*", async (route) => {
    diffRequests += 1;
    await route.fulfill({ json: { repository: true, branch: "agent/rhs-panel-mvp", files: [], commits: [], diff: "" } });
  });

  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Existing chat" }).click();
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  await panel.getByRole("tab", { name: "Source Control" }).click();
  await expect(panel.getByText("agent/rhs-panel-mvp", { exact: true })).toBeVisible();
  const originalPanel = await panel.elementHandle();
  await page.evaluate(() => {
    localStorage.setItem("conduit:workspace-panel:session_other:open", "true");
    localStorage.setItem("conduit:workspace-panel:session_other:tab", "diff");
  });

  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Other chat" }).click();
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("Other chat");
  await page.waitForTimeout(150);

  expect(diffRequests).toBe(1);
  expect(await panel.evaluate((element, original) => element === original, originalPanel)).toBe(true);
});

test("restores cached Git status when returning to a workspace", async ({ page }, testInfo) => {
  const sibling = { id: "session_research", projectId: "project_research", status: "draft", title: "Research chat" };
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", async (route) => {
    await route.fulfill({ json: { projects: [projects[0], { ...projects[1], sessions: [sibling] }] } });
  });
  await page.route("**/v0/sessions/session_research", async (route) => {
    await route.fulfill({ json: { ...sibling, messages: [], tools: [] } });
  });
  let diffRequests = 0;
  await page.route("**/v0/projects/*/diff*", async (route) => {
    diffRequests += 1;
    const branch = route.request().url().includes("project_research") ? "main" : "master";
    await route.fulfill({ json: { repository: true, branch, files: [], commits: [], diff: "" } });
  });

  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Existing chat" }).click();
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  await panel.getByRole("tab", { name: "Source Control" }).click();
  await expect(panel.getByText("master", { exact: true })).toBeVisible();
  const originalPanel = await panel.elementHandle();
  await page.evaluate(() => {
    localStorage.setItem("conduit:workspace-panel:session_research:open", "true");
    localStorage.setItem("conduit:workspace-panel:session_research:tab", "diff");
  });

  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Research chat" }).click();
  await expect(panel.getByText("main", { exact: true })).toBeVisible();
  await openSidebar(page, testInfo);
  await page.evaluate(() => localStorage.setItem("conduit:workspace-panel:session_existing:open", "true"));
  await page.getByRole("button", { name: "Existing chat" }).click();
  await expect(panel.getByText("master", { exact: true })).toBeVisible();

  expect(diffRequests).toBe(2);
  expect(await panel.evaluate((element, original) => element === original, originalPanel)).toBe(true);
  await expect(panel.locator(".workspace-panel-loading")).toHaveCount(0);
});

test("does not commit a stale workspace response after project navigation", async ({ page }, testInfo) => {
  const sibling = { id: "session_research", projectId: "project_research", status: "draft", title: "Research chat" };
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", async (route) => {
    await route.fulfill({ json: { projects: [projects[0], { ...projects[1], sessions: [sibling] }] } });
  });
  await page.route("**/v0/sessions/session_research", async (route) => {
    await route.fulfill({ json: { ...sibling, messages: [], tools: [] } });
  });
  await page.unroute("**/v0/projects/*/tree?*");
  let releaseChatTree;
  await page.route("**/v0/projects/*/tree?*", async (route) => {
    const projectId = new URL(route.request().url()).pathname.split("/")[3];
    if (projectId === "project_chat") {
      await new Promise((resolve) => { releaseChatTree = resolve; });
      await route.fulfill({ json: { entries: [{ name: "chat-only.md", path: "chat-only.md", type: "file" }] } }).catch(() => {});
      return;
    }
    await route.fulfill({ json: { entries: [{ name: "research-only.md", path: "research-only.md", type: "file" }] } });
  });

  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Existing chat" }).click();
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  await expect.poll(() => Boolean(releaseChatTree)).toBe(true);
  await page.evaluate(() => {
    localStorage.setItem("conduit:workspace-panel:session_research:open", "true");
    localStorage.setItem("conduit:workspace-panel:session_research:tab", "files");
  });

  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Research chat" }).click();
  await expect(panel.getByRole("button", { name: "research-only.md" })).toBeVisible();
  await releaseChatTree();
  await page.waitForTimeout(100);
  await expect(panel.getByText("chat-only.md")).toHaveCount(0);
  await expect(panel.getByText("research-only.md")).toBeVisible();
});

test("closing the workspace panel cancels hidden tree, file, and diff work", async ({ page }, testInfo) => {
  await page.unroute("**/v0/projects/*/tree?*");
  const treeGates = [];
  let treeRequests = 0;
  await page.route("**/v0/projects/*/tree?*", async (route) => {
    const requestNumber = ++treeRequests;
    await new Promise((resolve) => { treeGates.push(resolve); });
    await route.fulfill({ json: { entries: [{ name: requestNumber === 1 ? "cancelled.md" : "cached.md", path: requestNumber === 1 ? "cancelled.md" : "cached.md", type: "file" }], truncated: false } }).catch(() => {});
  });
  await page.unroute("**/v0/projects/*/file?*");
  const fileGates = [];
  let fileRequests = 0;
  await page.route("**/v0/projects/*/file?*", async (route) => {
    const requestNumber = ++fileRequests;
    await new Promise((resolve) => { fileGates.push(resolve); });
    await route.fulfill({ json: { path: "cached.md", size: 5, content: requestNumber === 1 ? "stale" : "fresh" } }).catch(() => {});
  });
  await page.unroute("**/v0/projects/*/diff*");
  const diffGates = [];
  let diffRequests = 0;
  await page.route("**/v0/projects/*/diff*", async (route) => {
    const requestNumber = ++diffRequests;
    await new Promise((resolve) => { diffGates.push(resolve); });
    await route.fulfill({ json: { repository: true, branch: requestNumber === 1 ? "cancelled-branch" : "fresh-branch", files: [], commits: [], diff: "" } }).catch(() => {});
  });

  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Existing chat" }).click();
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  await expect.poll(() => treeGates.length).toBe(1);
  await panel.getByRole("button", { name: "Close workspace panel" }).click();
  treeGates[0]();

  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  await expect.poll(() => treeGates.length).toBe(2);
  await expect(panel.getByText("cancelled.md")).toHaveCount(0);
  treeGates[1]();
  await expect(panel.getByRole("button", { name: "cached.md" })).toBeVisible();
  await panel.getByRole("button", { name: "cached.md" }).click();
  await expect.poll(() => fileGates.length).toBe(1);
  await panel.getByRole("button", { name: "Close workspace panel" }).click();
  fileGates[0]();

  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  await expect(panel.getByText("stale")).toHaveCount(0);
  await panel.getByRole("button", { name: "cached.md" }).click();
  await expect.poll(() => fileGates.length).toBe(2);
  fileGates[1]();
  await expect(panel.getByText("fresh")).toBeVisible();
  await panel.getByRole("tab", { name: "Source Control" }).click();
  await expect.poll(() => diffGates.length).toBe(1);
  await panel.getByRole("button", { name: "Close workspace panel" }).click();
  diffGates[0]();

  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  await expect.poll(() => diffGates.length).toBe(2);
  await expect(panel.getByText("cancelled-branch")).toHaveCount(0);
  diffGates[1]();
  await expect(panel.getByText("fresh-branch")).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(unhandledApiRequests.get(page) || [], "all browser API requests must use deterministic mocks").toEqual([]);
});

test("creates a durable chat route and renders the primary surface", async ({ page }) => {
  const createRequest = page.waitForRequest((request) => request.url().endsWith("/v0/chats") && request.method() === "POST");
  await page.goto("/");
  await createRequest;
  await expect(page).toHaveURL(/\/chat\/550e8400-e29b-41d4-a716-446655440099$/);
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("ChatsNew chat");

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
  expect(groupBox.height).toBeGreaterThanOrEqual(72);
  expect(sendBox.y).toBeGreaterThan(inputBox.y);
  await expect(composerGroup).toHaveCSS("opacity", "1");
  await expect(page.getByRole("button", { name: "Voice input" })).toHaveCount(0);
  await expect(sendButton).toBeDisabled();
  await expect(sendButton).toHaveAttribute("data-variant", "default");
  await composer.fill("Hello");
  await expect(sendButton).toBeEnabled();
  await expect(sendButton).toHaveAttribute("data-variant", "default");
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

  await page.goto("/chat/session_conduit");
  await expect(page.getByRole("region", { name: "Terminal pane" })).toHaveCount(0);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByRole("option", { name: "Workspace views…" }).click();
  await expect(page.getByText("Workspace ›")).toBeVisible();
  await page.getByRole("option", { name: "Terminal" }).click();
  const terminal = page.getByRole("region", { name: "Terminal pane" });
  await expect(terminal).toBeVisible();
  await expect(terminal).toContainText("Start a terminal");
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

test("the terminal renderer can use the xterm baseline over the same PTY transport", async ({ page }) => {
  const workspace = {
    id: "project_terminal",
    slug: "terminal",
    name: "Terminal",
    kind: "workspace",
    origin: "linked",
    sessions: [{ id: "session_terminal", projectId: "project_terminal", status: "active", title: "Terminal work" }],
  };
  await page.addInitScript(() => localStorage.setItem("conduit:terminal-renderer", "xterm"));
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [...projects, workspace] } }));
  await page.route("**/v0/chats/session_terminal", (route) => route.fulfill({ json: workspace.sessions[0] }));
  await page.route("**/v0/sessions/session_terminal", (route) => route.fulfill({ json: { ...workspace.sessions[0], messages: [], tools: [] } }));
  await page.route("**/v0/ptys", (route) => route.fulfill(route.request().method() === "GET"
    ? { json: { ptys: [] } }
    : { status: 201, json: { id: "550e8400-e29b-41d4-a716-446655440055", projectId: workspace.id, status: "running" } }));

  await page.goto("/chat/session_terminal");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByRole("option", { name: "Workspace views…" }).click();
  await page.getByRole("option", { name: "Terminal" }).click();
  await page.getByRole("button", { name: "Start terminal" }).click();
  const canvas = page.locator(".terminal-canvas");
  await expect(canvas).toHaveAttribute("data-terminal-renderer", "xterm");
  await expect(canvas.locator(".xterm")).toBeVisible();
});

test("the terminal renderer can use Ghostty over the same PTY transport", async ({ page }) => {
  const workspace = {
    id: "project_ghostty",
    slug: "ghostty",
    name: "Ghostty",
    kind: "workspace",
    origin: "linked",
    sessions: [{ id: "session_ghostty", projectId: "project_ghostty", status: "active", title: "Ghostty work" }],
  };
  await page.addInitScript(() => localStorage.removeItem("conduit:terminal-renderer"));
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [...projects, workspace] } }));
  await page.route("**/v0/chats/session_ghostty", (route) => route.fulfill({ json: workspace.sessions[0] }));
  await page.route("**/v0/sessions/session_ghostty", (route) => route.fulfill({ json: { ...workspace.sessions[0], messages: [], tools: [] } }));
  await page.route("**/v0/ptys", (route) => route.fulfill(route.request().method() === "GET"
    ? { json: { ptys: [] } }
    : { status: 201, json: { id: "550e8400-e29b-41d4-a716-446655440056", projectId: workspace.id, status: "running" } }));

  await page.goto("/chat/session_ghostty");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByRole("option", { name: "Workspace views…" }).click();
  await page.getByRole("option", { name: "Terminal" }).click();
  await page.getByRole("button", { name: "Start terminal" }).click();
  const canvas = page.locator(".terminal-canvas");
  await expect(canvas).toHaveAttribute("data-terminal-renderer", "ghostty");
  await expect(canvas.locator("canvas")).toBeVisible();
  await page.getByRole("combobox", { name: "Terminal renderer" }).selectOption("xterm");
  await expect(canvas).toHaveAttribute("data-terminal-renderer", "xterm");
  await expect(canvas.locator(".xterm")).toBeVisible();
});

test("reopening a Workspace terminal reattaches its resident PTY instead of starting another shell", async ({ page }) => {
  const workspace = {
    id: "project_resident_terminal",
    slug: "resident-terminal",
    name: "Resident terminal",
    kind: "workspace",
    origin: "linked",
    sessions: [{ id: "session_resident_terminal", projectId: "project_resident_terminal", status: "active", title: "Resident terminal work" }],
  };
  const pty = { id: "550e8400-e29b-41d4-a716-446655440057", projectId: workspace.id, status: "running" };
  let creates = 0;
  let lists = 0;
  await page.addInitScript(() => localStorage.setItem("conduit:terminal-renderer", "xterm"));
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [...projects, workspace] } }));
  await page.route("**/v0/chats/session_resident_terminal", (route) => route.fulfill({ json: workspace.sessions[0] }));
  await page.route("**/v0/sessions/session_resident_terminal", (route) => route.fulfill({ json: { ...workspace.sessions[0], messages: [], tools: [] } }));
  await page.route("**/v0/ptys", (route) => {
    if (route.request().method() === "GET") { lists += 1; return route.fulfill({ json: { ptys: [pty] } }); }
    creates += 1;
    return route.fulfill({ status: 201, json: pty });
  });

  await page.goto("/chat/session_resident_terminal");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByRole("option", { name: "Workspace views…" }).click();
  await page.getByRole("option", { name: "Terminal" }).click();
  await expect(page.locator(".terminal-canvas .xterm")).toBeVisible();
  await page.getByRole("tab", { name: "Files" }).click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByRole("option", { name: "Workspace views…" }).click();
  await page.getByRole("option", { name: "Terminal" }).click();
  await expect(page.locator(".terminal-canvas .xterm")).toBeVisible();
  expect(lists).toBe(2);
  expect(creates).toBe(0);
});

test("reloading a durable new-chat URL does not create another chat", async ({ page }) => {
  let creates = 0;
  await page.route("**/v0/chats", async (route) => {
    creates += 1;
    await route.fulfill({ status: 201, json: {
      id: "550e8400-e29b-41d4-a716-446655440099", projectId: "project_chat", status: "draft", title: "New chat",
    } });
  });
  await page.goto("/");
  await expect(page).toHaveURL(/\/chat\/550e8400-e29b-41d4-a716-446655440099$/);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toBeVisible();
  expect(creates).toBe(1);
});

test("hydrates the durable model without reloading it after live attachment", async ({ page }) => {
  let modelReads = 0;
  let releaseFirstModelRead;
  const liveLaunchStarted = new Promise((resolve) => { releaseFirstModelRead = resolve; });
  await page.route("**/v0/chats/session_existing/models", async (route) => {
    modelReads += 1;
    await liveLaunchStarted;
    await route.fulfill({ json: {
      installationId: "conduit-pinned",
      runtimeKind: "conduit_profile",
      models: [model, plainModel],
      model: model.spec,
      thinkingLevel: "medium",
      defaultModel: model.spec,
      defaultThinkingLevel: "medium",
      requiresAuthentication: false,
      source: modelReads === 1 ? "jsonl" : "live",
    } });
  });
  await page.route("**/v0/live-sessions", async (route) => {
    releaseFirstModelRead();
    await route.fulfill({ json: { id: "live_existing", streamUrl: "/v0/live-sessions/live_existing/stream" } });
  });

  await page.goto("/chat/session_existing");

  await expect(page.getByRole("button", { name: "Reasoner medium" })).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(modelReads).toBe(1);
});

test("keeps the current chat connected when new-chat creation fails", async ({ page }, testInfo) => {
  await page.route("**/v0/chats/session_existing", async (route) => {
    await route.fulfill({ json: { id: "session_existing", projectId: "project_chat", status: "active", title: "Existing chat" } });
  });
  await page.route("**/v0/chats", async (route) => {
    await route.fulfill({ status: 503, json: { message: "Chat storage is unavailable" } });
  });
  await page.goto("/chat/session_existing");
  await expect(page.getByText("Previous question")).toBeVisible();
  const socketsClosedBefore = await page.evaluate(() => window.__closedSocketCount || 0);

  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "New chat" }).click();

  await expect(page).toHaveURL(/\/chat\/session_existing$/);
  await expect(page.getByText("Previous question")).toBeVisible();
  await expect(page.getByText("Chat storage is unavailable")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__closedSocketCount || 0)).toBe(socketsClosedBefore);
});

test("commits a new chat even if disposal of the replaced draft fails visibly", async ({ page }, testInfo) => {
  await page.route("**/v0/chats/*?ifEmpty=true", async (route) => {
    await route.fulfill({ status: 500, json: { message: "Draft cleanup failed" } });
  });
  await page.goto("/");
  await expect(page).toHaveURL(/\/chat\/550e8400-e29b-41d4-a716-446655440099$/);

  await page.route("**/v0/chats", async (route) => {
    await route.fulfill({ status: 201, json: {
      id: "550e8400-e29b-41d4-a716-446655440077",
      projectId: "project_chat",
      status: "draft",
      title: "New chat",
    } });
  });
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "New chat" }).click();

  await expect(page).toHaveURL(/\/chat\/550e8400-e29b-41d4-a716-446655440077$/);
  await expect(page.getByText(/old empty draft could not be removed: Draft cleanup failed/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toBeVisible();
});

test("new project chats identify their owning project in the header", async ({ page }, testInfo) => {
  await page.route("**/v0/chats", async (route) => {
    await route.fulfill({ status: 201, json: {
      id: "550e8400-e29b-41d4-a716-446655440088",
      projectId: "project_research",
      status: "draft",
      title: "New chat",
    } });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: /Research/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "New chat" }).click();
  const breadcrumb = page.getByRole("navigation", { name: "breadcrumb" });
  await expect(breadcrumb).toContainText("research");
  await expect(breadcrumb).toContainText("New chat");
});

test("opens and dismisses the new folder dialog", async ({ page }, testInfo) => {
  await page.goto("/");

  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create folder" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("keeps the workspace panel open while Escape dismisses sidebar dialogs and Settings", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  await expect(panel).toBeVisible();

  // Phone overlays are exclusive (sidebar XOR workspace). Dialog Escape coverage
  // on mobile opens the sidebar alone; desktop keeps the docked workspace open.
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Close workspace panel" }).click();
    await expect(panel).toBeHidden();
  }

  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "New folder" }).click();
  await expect(page.getByRole("dialog", { name: "New folder" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "New folder" })).toHaveCount(0);
  if (testInfo.project.name !== "mobile-chromium") await expect(panel).toBeVisible();

  await page.getByRole("button", { name: "New workspace" }).click();
  await expect(page.getByRole("dialog", { name: "Add workspace" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add workspace" })).toHaveCount(0);
  if (testInfo.project.name !== "mobile-chromium") await expect(panel).toBeVisible();

  await page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit/ }).click();
  await page.getByRole("menuitem", { name: "Manage settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
  if (testInfo.project.name !== "mobile-chromium") await expect(panel).toBeVisible();
});

test("long-press opens a sidebar context menu without navigating the chat", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "touch long-press coverage");
  await page.goto("/");
  await openSidebar(page, testInfo);
  const chat = page.getByRole("button", { name: "Existing chat" });
  await expect(chat).toBeVisible();
  const beforeUrl = page.url();
  const box = await chat.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await chat.dispatchEvent("pointerdown", { pointerType: "touch", bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 });
  await page.waitForTimeout(800);
  await chat.dispatchEvent("pointerup", { pointerType: "touch", bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 });
  await chat.dispatchEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y });
  const menu = page.locator('[data-slot="context-menu-content"]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  const menuBox = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox.x).toBeGreaterThanOrEqual(-2);
  expect(menuBox.y).toBeGreaterThanOrEqual(-2);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width + 2);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height + 2);
  await expect(page).toHaveURL(beforeUrl);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("header search opens the command palette and the close control dismisses it", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator(".palette-trigger")).toBeVisible();
  await page.locator(".palette-trigger").click();
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await expect(palette).toBeVisible();
  if (testInfo.project.name === "mobile-chromium" || (page.viewportSize()?.width || 0) <= 480) {
    const [shellBox, viewport] = await Promise.all([
      palette.locator(".command-shell").boundingBox(),
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    ]);
    expect(Math.abs(shellBox.width - viewport.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(shellBox.height - viewport.height)).toBeLessThanOrEqual(2);
  }
  await palette.getByRole("button", { name: "Close command palette" }).click();
  await expect(palette).toHaveCount(0);
});

test("mobile sidebar and workspace overlays are full-bleed and exclusive", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "phone overlay chrome only");
  await page.goto("/");

  const openSidebar = page.locator(".mobile-sidebar-trigger");
  await openSidebar.click();
  const sidebar = page.locator(".conduit-sidebar");
  await expect(sidebar).toHaveAttribute("data-mobile-open", "true");
  await expect(page.locator("html")).toHaveAttribute("data-mobile-overlay", "sidebar");
  const sidebarBox = await sidebar.boundingBox();
  expect(Math.abs(sidebarBox.width - page.viewportSize().width)).toBeLessThanOrEqual(2);
  // Open control leaves the chat header while the drawer owns dismiss.
  await expect(openSidebar).toHaveCount(0);
  await sidebar.locator('[data-sidebar="trigger"]').click();
  await expect(sidebar).toHaveAttribute("data-mobile-open", "false");
  await expect(page.locator("html")).not.toHaveAttribute("data-mobile-overlay", "sidebar");
  await expect(page.locator(".mobile-sidebar-trigger")).toBeVisible();

  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  await expect(panel).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-mobile-overlay", "workspace");
  const panelBox = await panel.boundingBox();
  expect(Math.abs(panelBox.width - page.viewportSize().width)).toBeLessThanOrEqual(2);
  // Workspace open control hides; close is the panel X only.
  await expect(page.getByRole("button", { name: "Toggle workspace panel" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close workspace panel" }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Toggle workspace panel" })).toBeVisible();

  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  await expect(panel).toBeVisible();
  // Full-bleed workspace covers the chat header — close it, then open sidebar.
  await page.getByRole("button", { name: "Close workspace panel" }).click();
  await page.locator(".mobile-sidebar-trigger").click();
  await expect(sidebar).toHaveAttribute("data-mobile-open", "true");
  await expect(page.locator("html")).toHaveAttribute("data-mobile-overlay", "sidebar");

  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveAttribute("data-mobile-open", "false");
  await expect(page.locator("html")).not.toHaveAttribute("data-mobile-overlay");
});

test("boots a deep-linked chat without projecting the default New chat state", async ({ page }) => {
  let releaseProjects;
  const projectsReady = new Promise((resolve) => { releaseProjects = resolve; });
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", async (route) => {
    await projectsReady;
    await route.fulfill({ json: { projects } });
  });

  await page.goto("/chat/session_existing");
  await expect(page.getByText("Loading chat…")).toBeVisible();
  await expect(page.getByText("New chat", { exact: true })).toHaveCount(0);
  releaseProjects();
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("Existing chat");
  await expect(page.getByText("Previous question")).toBeVisible();
});

test("keeps the initial draft route stable across reload", async ({ page }) => {
  let creates = 0;
  await page.unroute("**/v0/chats");
  await page.route("**/v0/chats", async (route) => {
    creates += 1;
    await route.fulfill({ status: 201, json: {
      id: "550e8400-e29b-41d4-a716-446655440099",
      projectId: "project_chat",
      status: "draft",
      title: "New chat",
    } });
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/chat\/550e8400-e29b-41d4-a716-446655440099$/);
  await page.reload();
  await expect(page).toHaveURL(/\/chat\/550e8400-e29b-41d4-a716-446655440099$/);
  expect(creates).toBe(1);
});

test("keeps the native textarea composer bounded in a thread", async ({ page }, testInfo) => {
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Existing chat" }).click();
  await expect(page.getByText("Previous question")).toBeVisible();
  await page.locator(".turn-trace-header").click();
  await expect(page.getByRole("button", { name: /write Complete/ })).toBeVisible();
  await expect(page.locator('[data-slot="message-header"]')).toHaveCount(0);

  const composerGroup = page.locator(".composer");
  const composerWrap = page.locator(".composer-wrap");
  const input = page.getByRole("textbox", { name: "Message Pi" });
  const sendButton = page.getByRole("button", { name: "Send message" });
  const [groupBox, inputBox, sendBox] = await Promise.all([
    composerGroup.boundingBox(),
    input.boundingBox(),
    sendButton.boundingBox(),
  ]);
  expect(groupBox.height).toBeGreaterThanOrEqual(72);
  expect(inputBox.height).toBeLessThanOrEqual(192);
  expect(sendBox.y).toBeGreaterThan(inputBox.y);
  await expect(composerWrap).toHaveCSS("position", "static");
  await expect(page.locator(".chat-meteors")).toBeVisible();
});

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
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Existing chat" }).click();

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

test("repairs unfinished Markdown while an assistant response streams", async ({ page }) => {
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
  await page.goto("/");
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

test("renders and answers every blocking host UI request kind", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    class HostUiWebSocket extends EventTarget {
      static OPEN = 1;
      constructor() {
        super();
        this.readyState = 0;
        window.__hostUiSocket = this;
        queueMicrotask(() => { this.readyState = HostUiWebSocket.OPEN; this.dispatchEvent(new Event("open")); });
      }
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
      send(data) { (window.__hostUiCommands ||= []).push(JSON.parse(data)); }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: HostUiWebSocket });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Existing chat" }).click();

  const request = async (payload) => page.evaluate((event) => {
    window.__hostUiSocket.onmessage({ data: JSON.stringify({ type: "extension_ui_request", ...event }) });
  }, payload);
  const lastCommand = () => page.evaluate(() => window.__hostUiCommands?.at(-1));
  await expect.poll(() => page.evaluate(() => typeof window.__hostUiSocket?.onmessage)).toBe("function");

  await request({ id: "confirm-1", method: "confirm", title: "Run command?", message: "This changes files." });
  const confirm = page.getByRole("region", { name: "Run command?" });
  await expect(confirm).toContainText("This changes files.");
  await confirm.getByRole("button", { name: "Approve" }).click();
  await expect.poll(lastCommand).toEqual({ type: "extension_ui_response", id: "confirm-1", confirmed: true });

  await request({ id: "select-1", method: "select", title: "Choose target", options: ["Alpha", "Beta"] });
  const select = page.getByRole("region", { name: "Choose target" });
  await expect(select.getByRole("button", { name: "Alpha" })).toBeVisible();
  await select.getByRole("button", { name: "Beta" }).click();
  await expect.poll(lastCommand).toEqual({ type: "extension_ui_response", id: "select-1", value: "Beta" });

  await request({ id: "input-1", method: "input", title: "Your name", placeholder: "Name", prefill: "Grace" });
  const input = page.getByRole("region", { name: "Your name" });
  await input.getByRole("textbox", { name: "Your name" }).fill("Ada");
  await input.getByRole("button", { name: "Submit" }).click();
  await expect.poll(lastCommand).toEqual({ type: "extension_ui_response", id: "input-1", value: "Ada" });

  await request({ id: "editor-1", method: "editor", title: "Edit plan", prefill: "First draft" });
  const editor = page.getByRole("region", { name: "Edit plan" });
  await editor.getByRole("textbox", { name: "Edit plan" }).fill("Revised plan");
  await editor.getByRole("button", { name: "Submit" }).click();
  await expect.poll(lastCommand).toEqual({ type: "extension_ui_response", id: "editor-1", value: "Revised plan" });
});

test("switches threads atomically without flashing the welcome screen", async ({ page }, testInfo) => {
  await page.route("**/v0/projects", async (route) => {
    await route.fulfill({ json: { projects: [{
      id: "project_chat",
      slug: "chat",
      name: "Chats",
      sessions: [
        { id: "session_first", projectId: "project_chat", status: "active", title: "First chat" },
        { id: "session_second", projectId: "project_chat", status: "active", title: "Second chat" },
      ],
    }, projects[1]] } });
  });
  await page.route("**/v0/sessions/session_first", async (route) => {
    await route.fulfill({ json: {
      id: "session_first", projectId: "project_chat", status: "active", title: "First chat",
      messages: [{ id: "entry-first", role: "user", content: "First thread body" }],
      tools: [], page: { before: null },
    } });
  });
  await page.route("**/v0/sessions/session_second", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({ json: {
      id: "session_second", projectId: "project_chat", status: "active", title: "Second chat",
      messages: [{ id: "entry-second", role: "user", content: "Second thread body" }],
      tools: [], page: { before: null },
    } });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);

  await page.getByRole("button", { name: "First chat" }).click();
  await expect(page.getByText("First thread body")).toBeVisible();

  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Second chat" }).click();
  // During the delayed load the previous thread stays put: no welcome heading,
  // no recentering empty layout, and the first thread's content is still shown.
  await expect(page.getByRole("heading", { name: "How can I help you today?" })).toHaveCount(0);
  await expect(page.locator(".chat-main-empty")).toHaveCount(0);
  await expect(page.getByText("First thread body")).toBeVisible();

  await expect(page.getByText("Second thread body")).toBeVisible();
  await expect(page.getByText("First thread body")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "How can I help you today?" })).toHaveCount(0);
});

test("does not launch an abandoned active chat during rapid switching", async ({ page }, testInfo) => {
  await page.route("**/v0/projects", async (route) => route.fulfill({ json: { projects: [{
    id: "project_chat", slug: "chat", name: "Chats",
    sessions: [
      { id: "session_first", projectId: "project_chat", status: "active", title: "First chat" },
      { id: "session_second", projectId: "project_chat", status: "active", title: "Second chat" },
    ],
  }, projects[1]] } }));
  let firstDetailResolved = false;
  await page.route("**/v0/sessions/session_first", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ json: {
      id: "session_first", projectId: "project_chat", status: "active", title: "First chat",
      messages: [{ id: "entry-first", role: "user", content: "Abandoned thread" }], tools: [], page: { before: null },
    } });
    firstDetailResolved = true;
  });
  await page.route("**/v0/sessions/session_second", async (route) => route.fulfill({ json: {
    id: "session_second", projectId: "project_chat", status: "active", title: "Second chat",
    messages: [{ id: "entry-second", role: "user", content: "Selected thread" }], tools: [], page: { before: null },
  } }));
  const launches = [];
  await page.route("**/v0/live-sessions", async (route) => {
    const body = route.request().postDataJSON();
    launches.push(body.chatId);
    await route.fulfill({ json: { id: `live_${body.chatId}`, streamUrl: `/v0/live-sessions/live_${body.chatId}/stream` } });
  });

  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "First chat" }).click();
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Second chat" }).click();
  await expect(page.getByText("Selected thread")).toBeVisible();
  await expect.poll(() => firstDetailResolved).toBe(true);
  await expect.poll(() => launches).toEqual(["session_second"]);
});

test("ignores queued events from the previous chat socket", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    class SwitchingWebSocket extends EventTarget {
      static OPEN = 1;
      constructor() {
        super();
        this.readyState = 0;
        (window.__switchSockets ||= []).push(this);
        queueMicrotask(() => { this.readyState = SwitchingWebSocket.OPEN; this.dispatchEvent(new Event("open")); });
      }
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
      send() {}
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: SwitchingWebSocket });
  });
  await page.route("**/v0/projects", async (route) => route.fulfill({ json: { projects: [{
    id: "project_chat", slug: "chat", name: "Chats",
    sessions: [
      { id: "session_first", projectId: "project_chat", status: "active", title: "First chat" },
      { id: "session_second", projectId: "project_chat", status: "active", title: "Second chat" },
    ],
  }, projects[1]] } }));
  for (const [id, title, content] of [
    ["session_first", "First chat", "First body"],
    ["session_second", "Second chat", "Second body"],
  ]) {
    await page.route(`**/v0/sessions/${id}`, async (route) => route.fulfill({ json: {
      id, projectId: "project_chat", status: "active", title,
      messages: [{ id: `entry-${id}`, role: "user", content }], tools: [], page: { before: null },
    } }));
  }
  await page.route("**/v0/live-sessions", async (route) => {
    const { chatId } = route.request().postDataJSON();
    await route.fulfill({ json: { id: `live_${chatId}`, streamUrl: `/v0/live-sessions/live_${chatId}/stream` } });
  });

  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "First chat" }).click();
  await expect(page.getByText("First body")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__switchSockets?.some((socket) => typeof socket.onmessage === "function"))).toBe(true);
  await page.evaluate(() => {
    window.__staleSocketHandler = window.__switchSockets.find((socket) => typeof socket.onmessage === "function").onmessage;
  });
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Second chat" }).click();
  await expect(page.getByText("Second body")).toBeVisible();
  await page.evaluate(() => {
    const handler = window.__staleSocketHandler;
    handler({ data: JSON.stringify({ type: "generation_started", generationId: "stale-generation", seq: 1 }) });
    handler({ data: JSON.stringify({ type: "assistant_message_started", generationId: "stale-generation", seq: 2, messageId: "stale-message" }) });
    handler({ data: JSON.stringify({ type: "content_block_started", generationId: "stale-generation", seq: 3, messageId: "stale-message", block: { type: "text", contentIndex: 0, text: "" } }) });
    handler({ data: JSON.stringify({ type: "content_block_delta", generationId: "stale-generation", seq: 4, messageId: "stale-message", blockType: "text", contentIndex: 0, delta: "STALE OUTPUT" }) });
  });
  await expect(page.getByText("STALE OUTPUT")).toHaveCount(0);
  await expect(page.getByText("Second body")).toBeVisible();
});

test("cold-loads a viewport-filling thread pinned to the true bottom after Markdown resolves", async ({ page }) => {
  const paragraph = (n) => `Paragraph ${n} carries enough words to wrap across more than one line of the transcript column so the assistant answer grows well beyond ten rem in height.`;
  const tallBody = Array.from({ length: 24 }, (_, index) => paragraph(index + 1)).join("\n\n");
  let releaseMarkdown;
  const markdownGate = new Promise((resolve) => { releaseMarkdown = resolve; });
  await page.route("**/src/client/chat/markdown.tsx*", async (route) => {
    await markdownGate;
    await route.continue();
  });
  await page.route("**/v0/projects", async (route) => {
    await route.fulfill({ json: { projects: [{
      id: "project_chat", slug: "chat", name: "Chats",
      sessions: [
        { id: "session_tall", projectId: "project_chat", status: "active", title: "Tall chat" },
      ],
    }, projects[1]] } });
  });
  await page.route("**/v0/chats/session_tall", async (route) => {
    await route.fulfill({ json: {
      id: "session_tall", projectId: "project_chat", status: "active", title: "Tall chat",
    } });
  });
  await page.route("**/v0/sessions/session_tall", async (route) => {
    await route.fulfill({ json: {
      id: "session_tall", projectId: "project_chat", status: "active", title: "Tall chat",
      messages: [
        { id: "tall-user-1", role: "user", content: "First short question" },
        { id: "tall-assistant-1", role: "assistant", content: "A short reply." },
        { id: "tall-user-2", role: "user", content: "Now the long one" },
        { id: "tall-assistant-2", role: "assistant", content: tallBody },
      ], tools: [], page: { before: null },
    } });
  });
  await page.goto("/chat/session_tall", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".markdown-skeleton")).toHaveCount(2);
  releaseMarkdown();
  // Sample the viewport from the delayed Markdown resolution through its
  // settlement. A one-shot pre-paint scroll would leave one of these frames far
  // from the true bottom after the skeleton expands.
  const samples = await page.evaluate(async () => {
    const out = [];
    for (let frame = 0; frame < 45; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]');
      if (viewport) out.push({ top: viewport.scrollTop, height: viewport.scrollHeight, client: viewport.clientHeight });
    }
    return out;
  });
  await expect(page.getByText("Paragraph 24 carries enough words")).toBeVisible();

  // Earlier rows may be virtualized; the tail row must stay fully laid out while
  // the viewport follows the answer through Markdown resolution.
  const contentVisibility = await page.locator('[data-message-id="tall-assistant-2"]')
    .evaluate((element) => getComputedStyle(element).contentVisibility);
  expect(contentVisibility).toBe("visible");

  const tall = samples.filter((sample) => sample.height - sample.client > 200);
  expect(tall.length).toBeGreaterThan(0);
  const worstDistanceFromBottom = Math.max(...tall.map((sample) => sample.height - sample.client - sample.top));
  expect(worstDistanceFromBottom).toBeLessThanOrEqual(32);
});

test("renders a selected chat before optional startup data and loads workspace suggestions on demand", async ({ page }, testInfo) => {
  let releaseOptional;
  const optionalGate = new Promise((resolve) => { releaseOptional = resolve; });
  await page.unroute("**/v0/capabilities");
  await page.unroute("**/v0/templates");
  await page.unroute("**/v0/pi-installations");
  await page.unroute("**/v0/workspaces/suggestions");
  await page.route("**/v0/capabilities", async (route) => {
    await optionalGate;
    await route.fulfill({ json: { partialContinue: true } });
  });
  await page.route("**/v0/templates", async (route) => {
    await optionalGate;
    await route.fulfill({ json: { templates, defaultTemplateId: "chat" } });
  });
  await page.route("**/v0/pi-installations", async (route) => {
    await optionalGate;
    await route.fulfill({ json: { installations: [
      { id: "conduit-pinned", label: "Isolated Pi", version: "0.84.1", available: true },
      { id: "host-pi", label: "Host Pi", version: "0.80.10", available: true },
    ] } });
  });
  let suggestionRequests = 0;
  await page.route("**/v0/workspaces/suggestions", async (route) => {
    suggestionRequests += 1;
    await route.fulfill({ json: { folders: [] } });
  });

  await page.goto("/chat/session_existing");
  await expect(page.getByText("Previous question")).toBeVisible();
  expect(suggestionRequests).toBe(0);

  await openSidebar(page, testInfo);
  await page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit/ }).click();
  await page.getByRole("menuitem", { name: "Manage settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("tab", { name: /Runtime/ }).click();
  await expect(settings.getByText("Loading Pi installations…")).toBeVisible();
  releaseOptional();
  await expect(settings.getByText("Pi 0.80.10")).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();

  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "New workspace" }).click();
  await expect.poll(() => suggestionRequests).toBe(1);
});

test("loads earlier history at the top without exposing pagination or moving the visible anchor", async ({ page }) => {
  const recent = Array.from({ length: 10 }, (_, index) => ([
    { id: `recent-user-${index}`, role: "user", content: `Recent question ${index} with enough text to occupy a stable transcript row across viewport sizes.` },
    { id: `recent-assistant-${index}`, role: "assistant", content: `Recent answer ${index} with enough text to occupy a stable transcript row across viewport sizes.` },
  ])).flat();
  let historyRequests = 0;
  await page.route("**/v0/sessions/session_existing?before=older-cursor", async (route) => {
    historyRequests += 1;
    await route.fulfill({ json: {
      id: "session_existing", projectId: "project_chat", status: "active", title: "Existing chat",
      messages: [
        { id: "older-user", role: "user", content: "Oldest automatically loaded question" },
        { id: "older-assistant", role: "assistant", content: "Oldest automatically loaded answer" },
      ],
      tools: [], page: { before: null },
    } });
  });
  await page.route("**/v0/sessions/session_existing", async (route) => {
    await route.fulfill({ json: {
      id: "session_existing", projectId: "project_chat", status: "active", title: "Existing chat",
      messages: recent, tools: [], page: { before: "older-cursor" },
    } });
  });

  await page.goto("/chat/session_existing");
  await expect(page.getByText("Recent answer 9", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load earlier messages" })).toHaveCount(0);
  const anchor = page.locator('[data-message-id="recent-user-0"]');
  const viewport = page.locator('[data-slot="message-scroller-viewport"]');
  const beforeY = await viewport.evaluate((element) => {
    element.scrollTop = 0;
    const anchorElement = document.querySelector('[data-message-id="recent-user-0"]');
    const y = anchorElement.getBoundingClientRect().y;
    element.dispatchEvent(new Event("scroll"));
    return y;
  });
  await expect(page.getByText("Oldest automatically loaded question")).toBeAttached();
  const after = await anchor.boundingBox();
  expect(historyRequests).toBe(1);
  expect(Math.abs(after.y - beforeY)).toBeLessThanOrEqual(2);
});

test("hides transient new chats and provides complete right-click menus", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { window.__copiedTranscript = text; } },
    });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);

  await expect(page.locator('[data-sidebar="content"]').getByText("New chat", { exact: true })).toHaveCount(0);
  await expect(page.locator('button[aria-current="page"]')).toHaveCount(0);
  await expect(page.getByLabel("Actions for Existing chat")).toHaveCount(0);

  await page.getByRole("button", { name: "Existing chat" }).click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText([
    "Rename",
    "Move to folder…",
    "Copy transcript",
    "Open terminal",
    "Delete chat",
  ]);

  await page.getByRole("menuitem", { name: "Rename" }).click();
  const renameDialog = page.getByRole("dialog", { name: "Rename chat" });
  await renameDialog.getByRole("textbox", { name: "Name" }).fill("Renamed chat");
  const renameRequest = page.waitForRequest((request) =>
    request.url().endsWith("/v0/sessions/session_existing") && request.method() === "PATCH");
  await renameDialog.getByRole("button", { name: "Rename" }).click();
  expect((await renameRequest).postDataJSON()).toEqual({ name: "Renamed chat" });

  await page.getByRole("button", { name: "Existing chat" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to folder…" }).hover();
  await expect(page.getByRole("menuitemradio", { name: "Chats" })).toBeChecked();
  const moveRequest = page.waitForRequest((request) => request.url().endsWith("/v0/sessions/session_existing/move"));
  // Move like a real pointer: an instant teleport past the parent menu defeats
  // the submenu's hover-grace corridor (which tracks movement direction), so
  // the submenu closes before the click. On phone layouts the submenu is
  // flipped to the left of its parent, which is where a straight-line move is
  // most likely to clip the parent items.
  const moveTarget = page.getByRole("menuitemradio", { name: "Research" });
  const moveTargetBox = await moveTarget.boundingBox();
  await page.mouse.move(moveTargetBox.x + moveTargetBox.width / 2, moveTargetBox.y + moveTargetBox.height / 2, { steps: 12 });
  await moveTarget.click();
  expect((await moveRequest).postDataJSON()).toEqual({ projectId: "project_research" });

  await page.getByRole("button", { name: "Existing chat" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy transcript" }).click();
  await expect.poll(() => page.evaluate(() => window.__copiedTranscript)).toBe("## User\n\nPrevious question");

  await page.getByRole("button", { name: "Research" }).click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText([
    "New chat",
    "Rename folder",
    "Move chats to…",
    "Delete folder",
  ]);
  await expect(page.getByRole("menuitem", { name: "Move chats to…" })).toBeDisabled();
});

test("uses compact sidebar groups and preserves a useful desktop rail", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.goto("/");
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
  await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New folder" })).toBeVisible();
  await expect(page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit/ })).toBeVisible();
  await expect(page.locator('[data-sidebar="footer"]')).toContainText(/Server connected|Connecting|Reconnecting|unavailable/);
  await expect(page.locator('[data-sidebar="group-label"]')).toHaveText(["Chats", "Projects", "Workspaces"]);
  await expect(page.locator('[data-sidebar="group-label"]').first()).toHaveCSS("font-size", "12px");
  await expect(page.locator('[data-sidebar="group-label"]').first()).toHaveCSS("font-weight", "700");
  await expect(page.getByRole("button", { name: "Existing chat" })).toHaveCSS("font-size", "13px");
  await expect(page.locator('[data-sidebar="header"] span', { hasText: "Conduit" })).toHaveCSS("font-size", "32px");
  await expect(page.locator('[data-sidebar="brand"] svg')).toHaveCount(0);
  await expect(page.locator('[data-sidebar="trigger"] svg')).toHaveCount(1);
  await expect(page.locator(".server-status-indicator")).toHaveCSS("width", "16px");
  await expect(page.locator(".server-status-indicator .runtime-indicator-dot")).toHaveCSS("width", "8px");

  await expect(page.getByRole("button", { name: "Existing chat" })).toBeVisible();
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
  await expect(sidebar).toHaveCSS("width", "52px");
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
  await expect(sidebar).toHaveCSS("width", "52px");
});

test("keeps linked workspaces in their own sidebar group", async ({ page }, testInfo) => {
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", async (route) => {
    await route.fulfill({ json: {
      projects: [...projects, {
        id: "project_workspace",
        slug: "jaskfish",
        name: "JaskFish",
        kind: "workspace",
        origin: "linked",
        sessions: [],
      }],
    } });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  if (testInfo.project.name === "mobile-chromium") {
    const drawer = page.locator(".conduit-sidebar");
    await expect(drawer).toHaveCSS("position", "fixed");
    const drawerBox = await drawer.boundingBox();
    expect(Math.abs(drawerBox.width - page.viewportSize().width)).toBeLessThanOrEqual(2);
    await expect(drawer).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(drawer.locator(".sidebar-container")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const firstLabelBox = await drawer.locator('[data-sidebar="group-label"]').first().boundingBox();
    expect(firstLabelBox.x).toBeGreaterThanOrEqual(drawerBox.x);
    await expect(drawer).toHaveAttribute("data-mobile-open", "true");
    await expect(page.locator(".mobile-sidebar-trigger")).toHaveCount(0);
    await expect(drawer.locator('[data-sidebar="trigger"]')).toBeVisible();
    await expect(drawer.locator('[data-sidebar="brand"]')).toHaveCSS("justify-content", "flex-start");
  }
  await expect(page.locator('[data-sidebar="group-label"]')).toHaveText(["Chats", "Projects", "Workspaces"]);
  await expect(page.getByRole("button", { name: "JaskFish" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New workspace" })).toBeVisible();
  if (testInfo.project.name === "desktop-chromium") {
    await page.locator('[data-sidebar="trigger"]:visible').click();
    const rail = page.locator('[data-sidebar="rail-actions"]');
    await expect(rail.getByRole("button", { name: "JaskFish", exact: true })).toBeVisible();
    await expect(rail.locator('[data-sidebar="rail-divider"]')).toHaveCount(2);
    await expect(rail.getByRole("button", { name: "JaskFish", exact: true }).locator(".workspace-glyph")).toHaveAttribute("data-value", "boxes");
  }
});

test("opens a targeted Workspace settings card from its context menu", async ({ page }, testInfo) => {
  const workspace = {
    id: "project_workspace",
    slug: "jaskfish",
    name: "JaskFish",
    kind: "workspace",
    origin: "linked",
    path: "/home/user/JaskFish",
    defaultTemplateId: null,
    sessions: [],
  };
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [...projects, workspace] } }));
  await page.route("**/v0/projects/project_workspace", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { ...workspace, defaultTemplateId: body.defaultTemplateId } });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "JaskFish" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Workspace settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("tab", { name: /Workspaces/ })).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByText("/home/user/JaskFish")).toBeVisible();
  const updateRequest = page.waitForRequest((request) => request.url().endsWith("/v0/projects/project_workspace")
    && request.method() === "PATCH");
  await settings.getByRole("combobox", { name: "Default profile" }).selectOption("workspace");
  expect((await updateRequest).postDataJSON()).toEqual({ defaultTemplateId: "workspace" });
  await expect(settings.getByText("Override: Coding")).toBeVisible();
  const hostRequest = page.waitForRequest((request) => request.url().endsWith("/v0/projects/project_workspace")
    && request.method() === "PATCH" && request.postDataJSON()?.defaultTemplateId === "host-pi");
  await settings.getByRole("combobox", { name: "Default profile" }).selectOption("host-pi");
  await hostRequest;
  await expect(settings.getByText("Override: Host Pi")).toBeVisible();
});

test("workspace draft chooses Host Pi and automatically trusts project resources", async ({ page }, testInfo) => {
  const workspace = {
    id: "project_workspace",
    slug: "jaskfish",
    name: "JaskFish",
    kind: "workspace",
    origin: "linked",
    defaultTemplateId: null,
    sessions: [],
  };
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [...projects, workspace] } }));
  await page.unroute("**/v0/chats");
  await page.route("**/v0/chats", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: {
      id: "550e8400-e29b-41d4-a716-446655440088",
      projectId: body.projectId,
      status: "draft",
      title: "New chat",
      templateId: body.templateId,
      runtime: { kind: body.runtimeKind, installationId: "conduit-pinned", binaryVersion: "0.84.1", profileId: body.templateId },
    } });
  });
  await page.route("**/v0/chats/550e8400-e29b-41d4-a716-446655440088", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: {
      id: "550e8400-e29b-41d4-a716-446655440088",
      projectId: "project_workspace",
      status: "draft",
      title: "New chat",
      templateId: body.templateId,
      runtime: { kind: body.runtimeKind, installationId: body.runtimeKind === "native_pi" ? "host-pi" : "conduit-pinned", profileId: body.templateId },
    } });
  });
  await page.route("**/v0/chats/550e8400-e29b-41d4-a716-446655440088/models", async (route) => {
    const body = route.request().postDataJSON?.() || {};
    await route.fulfill({ json: {
      installationId: "host-pi",
      runtimeKind: "native_pi",
      models: [model, plainModel],
      model: body.model || model.spec,
      thinkingLevel: body.thinkingLevel || "medium",
      defaultModel: model.spec,
      defaultThinkingLevel: "medium",
      requiresAuthentication: false,
      source: "runtime_default",
    } });
  });
  await page.unroute("**/v0/live-sessions");
  await page.route("**/v0/live-sessions", async (route) => {
    await route.fulfill({ status: 201, json: {
      id: "live_host",
      streamUrl: "/v0/live-sessions/live_host/stream",
      runtime: { kind: "native_pi", installationId: "host-pi" },
      trustPosture: "native_saved_trust",
    } });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  const createRequest = page.waitForRequest((request) => request.url().endsWith("/v0/chats")
    && request.method() === "POST" && request.postDataJSON()?.projectId === "project_workspace");
  await page.getByRole("button", { name: "JaskFish" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "New chat" }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    projectId: "project_workspace",
    templateId: "chat",
    runtimeKind: "conduit_profile",
  });
  await expect(page.getByRole("dialog", { name: /New chat in/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Profile Assistant" })).toBeVisible();
  await page.getByRole("button", { name: "Profile Assistant" }).click();
  const switchRequest = page.waitForRequest((candidate) => candidate.method() === "PATCH"
    && candidate.postDataJSON()?.runtimeKind === "native_pi");
  await page.getByRole("menuitemradio", { name: /Host Pi/ }).click();
  await switchRequest;
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Profile Host Pi" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Reasoner medium/ })).toBeVisible();

  await page.getByRole("textbox", { name: "Message Pi" }).fill("Inspect this workspace");
  const launchRequest = page.waitForRequest((request) => request.url().endsWith("/v0/live-sessions")
    && request.method() === "POST");
  await page.getByRole("button", { name: "Send message" }).click();
  const launch = await launchRequest;
  expect(launch.postDataJSON()).toMatchObject({
    chatId: "550e8400-e29b-41d4-a716-446655440088",
    model: model.spec,
  });
  expect(launch.postDataJSON()).not.toHaveProperty("trustChoice");
  expect(launch.postDataJSON()).not.toHaveProperty("trustToken");
  await expect(page.getByRole("alertdialog", { name: "Host Pi project resources" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toHaveValue("");
  await expect(page.locator(".chat-profile-posture")).toContainText("project resources trusted");
});

test("Host Pi default falls back to global when launch becomes unavailable", async ({ page }, testInfo) => {
  const workspace = {
    id: "project_workspace",
    slug: "jaskfish",
    name: "JaskFish",
    kind: "workspace",
    origin: "linked",
    defaultTemplateId: "host-pi",
    sessions: [],
  };
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [...projects, workspace] } }));
  await page.route("**/v0/projects/project_workspace", async (route) => route.fulfill({ json: {
    ...workspace,
    defaultTemplateId: route.request().postDataJSON()?.defaultTemplateId ?? null,
  } }));
  await page.unroute("**/v0/chats");
  await page.route("**/v0/chats", (route) => route.fulfill({ status: 201, json: {
    id: "550e8400-e29b-41d4-a716-446655440066",
    projectId: "project_workspace",
    status: "draft",
    title: "New chat",
    templateId: "chat",
    runtime: { kind: "native_pi", installationId: "host-pi" },
  } }));
  await page.route("**/v0/chats/550e8400-e29b-41d4-a716-446655440066", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: {
      id: "550e8400-e29b-41d4-a716-446655440066",
      projectId: "project_workspace",
      status: "draft",
      title: "New chat",
      templateId: body.templateId,
      runtime: { kind: body.runtimeKind, installationId: "conduit-pinned", profileId: body.templateId },
    } });
  });
  await page.unroute("**/v0/live-sessions");
  let attempts = 0;
  await page.route("**/v0/live-sessions", async (route) => {
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status: 409, json: { error: "native_pi_unavailable", message: "Host Pi disappeared" } });
    else await route.fulfill({ status: 201, json: { id: "live_fallback", streamUrl: "/v0/live-sessions/live_fallback/stream", runtime: { kind: "conduit_profile", installationId: "conduit-pinned" } } });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "JaskFish" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "New chat" }).click();
  await expect(page.getByRole("button", { name: "Profile Host Pi" })).toBeVisible();
  await page.getByRole("textbox", { name: "Message Pi" }).fill("Fall back safely");
  const clearDefault = page.waitForRequest((request) => request.url().endsWith("/v0/projects/project_workspace")
    && request.method() === "PATCH" && request.postDataJSON()?.defaultTemplateId === null);
  const switchRuntime = page.waitForRequest((request) => request.url().endsWith("/v0/chats/550e8400-e29b-41d4-a716-446655440066")
    && request.method() === "PATCH" && request.postDataJSON()?.runtimeKind === "conduit_profile");
  await page.getByRole("button", { name: "Send message" }).click();
  await Promise.all([clearDefault, switchRuntime]);
  await expect(page.getByRole("button", { name: "Profile Assistant" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toHaveValue("");
});

test("clone workspace derives a repository folder inside the chosen parent", async ({ page }, testInfo) => {
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      await route.fulfill({ status: 202, json: {
        project: {
          id: "project_clone",
          slug: "cloned-repo",
          name: body.name || "cloned-repo",
          kind: "workspace",
          origin: "cloned",
          state: "cloning",
          cloneOperationId: "operation_clone",
          externalPath: `${body.cloneParentPath}/${body.cloneDirectoryName || "repo"}`,
          path: `${body.cloneParentPath}/${body.cloneDirectoryName || "repo"}`,
          defaultTemplateId: null,
          deletesFilesOnRemove: false,
          sessions: [],
        },
        operation: { id: "operation_clone", state: "cloning" },
      } });
      return;
    }
    await route.fulfill({ json: { projects } });
  });
  await page.route("**/v0/workspace-operations/operation_clone", (route) => route.fulfill({
    json: { id: "operation_clone", projectId: "project_clone", state: "cloning", diagnostic: "Receiving objects: 42%" },
  }));
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "New workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add workspace" });
  await dialog.getByRole("radio", { name: /Clone repository/ }).click();
  await expect(dialog.getByLabel("GitHub repository or Git URL")).toBeVisible();
  await expect(dialog.getByLabel("Parent directory")).toBeVisible();
  await expect(dialog.getByLabel("Parent directory")).toHaveValue("~");
  await dialog.getByLabel("GitHub repository or Git URL").fill("react/react");
  await dialog.getByLabel("Parent directory").fill("/home/user/code");
  await dialog.getByLabel("Folder name (optional)").fill("checked-out-repo");
  const requestPromise = page.waitForRequest((request) => request.url().endsWith("/v0/projects") && request.method() === "POST");
  await dialog.getByRole("button", { name: "Clone workspace" }).click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({
    mode: "cloned",
    cloneUrl: "react/react",
    cloneParentPath: "/home/user/code",
    cloneDirectoryName: "checked-out-repo",
  });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Cloning Workspace")).toBeVisible();
});

test("shows a cloning Workspace with bounded output and cancellation", async ({ page }) => {
  const cloningWorkspace = {
    id: "project_clone_progress",
    slug: "react",
    name: "React",
    kind: "workspace",
    origin: "cloned",
    state: "cloning",
    cloneOperationId: "operation_clone_progress",
    path: "/home/user/react",
    sessions: [],
  };
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [projects[0], cloningWorkspace] } }));
  await page.route("**/v0/workspace-operations/operation_clone_progress", (route) => route.fulfill(route.request().method() === "DELETE"
    ? { json: { id: "operation_clone_progress", state: "cancelled" } }
    : { json: { id: "operation_clone_progress", projectId: cloningWorkspace.id, state: "cloning", diagnostic: "Receiving objects: 42%" } }));

  await page.goto(`/workspace/${cloningWorkspace.id}`);
  await expect(page.getByText("Cloning Workspace")).toBeVisible();
  await expect(page.getByLabel("Clone output preview")).toContainText("Receiving objects: 42%");
  const cancellation = page.waitForRequest((request) => request.url().endsWith("/v0/workspace-operations/operation_clone_progress") && request.method() === "DELETE");
  await page.getByRole("button", { name: "Cancel clone" }).click();
  await cancellation;
});

test("creates an explicit external Workspace only after the server resolves its target", async ({ page }, testInfo) => {
  await page.unroute("**/v0/projects");
  await page.route("**/v0/workspaces/preview", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ mode: "created", path: "/home/user/code", directoryName: "new-app" });
    await route.fulfill({ json: {
      path: "/home/user/code/new-app",
      ownership: "Conduit will create this folder. Unlinking it later keeps the folder and its files.",
    } });
  });
  await page.route("**/v0/projects/project_created/dashboard", async (route) => {
    await route.fulfill({ json: { identity: { id: "project_created", defaultTemplateId: null }, stats: { totalChats: 0, activeChats: 0, liveChats: 0, liveTerminals: 0 }, git: null, recentChats: [] } });
  });
  await page.route("**/v0/projects", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: {
        id: "project_created", slug: "new-app", name: body.name || "new-app", kind: "workspace", origin: "created",
        externalPath: "/home/user/code/new-app", path: "/home/user/code/new-app", defaultTemplateId: null, deletesFilesOnRemove: false, sessions: [],
      } });
      return;
    }
    await route.fulfill({ json: { projects } });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "New workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add workspace" });
  await dialog.getByRole("radio", { name: /Create folder/ }).click();
  await expect(dialog.getByLabel("Parent directory")).toHaveValue("~");
  await dialog.getByLabel("Parent directory").fill("/home/user/code");
  await dialog.getByLabel("New folder name").fill("new-app");
  await expect(dialog.getByText("/home/user/code/new-app")).toBeVisible();
  await expect(dialog.getByText(/Unlinking it later keeps the folder/)).toBeVisible();
  const requestPromise = page.waitForRequest((request) => request.url().endsWith("/v0/projects") && request.method() === "POST");
  await dialog.getByRole("button", { name: "Create workspace" }).click();
  expect((await requestPromise).postDataJSON()).toMatchObject({ mode: "created", path: "/home/user/code", directoryName: "new-app" });
  await expect(dialog).toHaveCount(0);
});

test("the meteor field fills the chat main surface without intercepting input", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.goto("/");

  const main = page.locator('[data-slot="sidebar-inset"]');
  const meteors = page.locator(".chat-meteors");
  await expect(main).toHaveCSS("isolation", "isolate");
  await expect(meteors).toBeVisible();
  await expect(meteors.locator(".solid-meteor").first()).toBeAttached();
  await expect(meteors).toHaveCSS("pointer-events", "none");
  await expect(meteors).toHaveCSS("overflow", "hidden");
  await expect.poll(() => meteors.locator(".solid-meteor").evaluateAll((nodes) =>
    nodes.some((node) => Number.parseFloat(node.style.animationDelay) < 0),
  )).toBe(true);
  await expect.poll(() => meteors.locator(".solid-meteor").evaluateAll((nodes) => {
    const field = document.querySelector(".chat-meteors")?.getBoundingClientRect();
    if (!field) return 0;
    return nodes.filter((node) => {
      const box = node.getBoundingClientRect();
      return Number(getComputedStyle(node).opacity) > 0
        && box.right > field.left && box.left < field.right
        && box.bottom > field.top && box.top < field.bottom;
    }).length;
  })).toBeGreaterThan(0);

  const [initialMain, initialField] = await Promise.all([main.boundingBox(), meteors.boundingBox()]);
  expect(initialField).toEqual(initialMain);

  await page.setViewportSize({ width: 1600, height: 900 });
  const [resizedMain, resizedField] = await Promise.all([main.boundingBox(), meteors.boundingBox()]);
  expect(resizedField).toEqual(resizedMain);
  expect(resizedField.width).toBeGreaterThan(initialField.width);
  expect(resizedField.height).toBeGreaterThan(initialField.height);

  await page.getByRole("textbox", { name: "Message Pi" }).click();
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toBeFocused();
});

test("the meteor field remains animated when reduced motion is enabled", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const meteor = page.locator(".chat-meteors .solid-meteor").first();
  await expect(meteor).toBeAttached();
  await expect(meteor).not.toHaveCSS("animation-duration", "0.01s");
});

test("composer model picker exposes model and thinking selectors", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Reasoner medium/ }).click();
  await expect(page.getByText("Model", { exact: true })).toBeVisible();
  await expect(page.getByText("Thinking", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Reasoner example" })).toBeChecked();
  await expect(page.getByRole("menuitemradio", { name: "High" })).toBeVisible();
});

test("choosing a model closes the menu and restores page pointer events", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Reasoner medium/ }).click();
  await expect(page.locator("body")).toHaveCSS("pointer-events", "none");
  await page.getByRole("menuitemradio", { name: "Plain example" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none");
});

test("shows a newly created chat in the sidebar immediately", async ({ page }, testInfo) => {
  await page.goto("/");
  await openSidebar(page, testInfo);

  await expect(page.locator('[data-sidebar="content"]').getByText("New chat", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.locator(".sidebar-chat", { hasText: "New chat" })).toBeVisible();
});

test("leaves an uncommitted new chat without blocking target navigation when cleanup returns chat_not_found", async ({ page }, testInfo) => {
  await page.route("**/v0/chats/550e8400-e29b-41d4-a716-446655440099?ifEmpty=true", async (route) => {
    await route.fulfill({ status: 404, json: { error: "chat_not_found" } });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "New chat" }).click();
  await page.waitForURL(/\/chat\/550e8400-e29b-41d4-a716-446655440099/);
  await expect(page.locator(".sidebar-chat", { hasText: "New chat" })).toBeVisible();

  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Existing chat" }).click();

  await expect(page).toHaveURL(/\/chat\/session_existing$/);
  await expect(page.getByText("Previous question")).toBeVisible();
  await expect(page.locator('[data-sidebar="content"]').getByText("New chat", { exact: true })).toHaveCount(0);
  await expect(page.getByText("chat_not_found", { exact: true })).toHaveCount(0);
});

test("a prompt sent from a brand-new chat never travels over the previous chat's live stream", async ({ page }, testInfo) => {
  const livePosts = [];
  await page.addInitScript(() => {
    class RecordingWebSocket extends EventTarget {
      static instances = [];
      constructor(url) {
        super();
        this.url = url;
        this.readyState = 0;
        this.sent = [];
        RecordingWebSocket.instances.push(this);
        queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
      }
      send(payload) { this.sent.push(JSON.parse(payload)); }
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: RecordingWebSocket });
    Object.defineProperty(window, "__wsInstances", { configurable: true, get: () => RecordingWebSocket.instances });
  });
  await page.route("**/v0/live-sessions", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      livePosts.push(body);
      const id = `live_${livePosts.length}`;
      return route.fulfill({ status: 201, json: { id, chatId: body.chatId, streamUrl: `/v0/live-sessions/${id}/stream` } });
    }
    return route.fulfill({ json: { sessions: [] } });
  });

  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Existing chat" }).click();
  await expect.poll(() => livePosts.length).toBe(1);

  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "New chat" }).click();
  await page.waitForURL(/\/chat\/550e8400-e29b-41d4-a716-446655440099/);
  const composer = page.getByRole("textbox", { name: "Message Pi" });
  await expect(composer).toBeEditable();
  await composer.fill("hello");
  await expect(composer).toHaveValue("hello");
  await composer.press("Enter");
  await expect.poll(() => livePosts.length).toBe(2);

  expect(livePosts[0].chatId).toBe("session_existing");
  expect(livePosts[1].chatId).toBe("550e8400-e29b-41d4-a716-446655440099");
  const readPromptFrames = () => page.evaluate(() => window.__wsInstances
    .filter((socket) => socket.url.includes("/v0/live-sessions/"))
    .flatMap((socket) => socket.sent.filter((frame) => frame.type === "prompt").map((frame) => ({ url: socket.url, frame }))));
  await expect.poll(async () => (await readPromptFrames()).length).toBe(1);
  const promptFrames = await readPromptFrames();
  expect(promptFrames[0].frame.message).toBe("hello");
  expect(promptFrames[0].url.endsWith("/live_2/stream")).toBe(true);
});

test("collapses a turn's thinking, narration, and tools into one trace", async ({ page }, testInfo) => {
  await page.route("**/v0/projects", async (route) => {
    await route.fulfill({ json: { projects: [
      { id: "project_chat", slug: "chat", name: "Chats", sessions: [
        { id: "session_thinking", projectId: "project_chat", status: "active", title: "Thinking chat" },
      ] },
    ] } });
  });
  await page.route("**/v0/sessions/session_thinking", async (route) => {
    await route.fulfill({ json: {
      id: "session_thinking",
      projectId: "project_chat",
      status: "active",
      title: "Thinking chat",
      messages: [
        { id: "u1", role: "user", content: "What does this repo do", timestamp: "2026-07-22T01:58:00.000Z" },
        { id: "a1", role: "assistant", content: "", timestamp: "2026-07-22T01:58:01.000Z", blocks: [
          { type: "thinking", thinking: "Let me explore the workspace first." },
          { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } },
        ] },
        { id: "a2", role: "assistant", content: "Now reading the readme.", timestamp: "2026-07-22T01:58:05.000Z", blocks: [
          { type: "thinking", thinking: "Now for the readme." },
          { type: "text", text: "Now reading the readme." },
          { type: "toolCall", id: "call_2", name: "read", arguments: { path: "README.md" } },
        ] },
        { id: "a3", role: "assistant", content: "This repo is an analytics project.", timestamp: "2026-07-22T01:58:09.000Z", blocks: [
          { type: "thinking", thinking: "Time to **summarize**." },
          { type: "text", text: "This repo is an analytics project." },
        ] },
      ],
      tools: [
        { id: "call_1", name: "bash", args: { command: "ls" }, done: true, result: "file.py", timestamp: "2026-07-22T01:58:02.000Z" },
        { id: "call_2", name: "read", args: { path: "README.md" }, done: true, result: "# Readme", timestamp: "2026-07-22T01:58:06.000Z" },
      ],
      page: { before: null },
    } });
  });

  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Thinking chat" }).click();

  const trace = page.locator(".turn-trace");
  await expect(trace.locator(".turn-trace-header")).toContainText("Time to summarize.");
  await expect(trace.locator(".turn-trace-header")).toContainText("2 tool calls");
  await expect(trace.locator(".turn-trace-preview strong")).toHaveText("summarize");
  await expect(trace.locator(".turn-trace-preview")).not.toContainText("**");
  await expect(trace.locator(".turn-trace-body")).toHaveCount(0);
  await expect(page.locator(".bubble-assistant")).toHaveCount(1);
  await expect(page.locator(".bubble-assistant")).toContainText("This repo is an analytics project.");

  await trace.locator(".turn-trace-header").click();
  const body = trace.locator(".turn-trace-body");
  await expect(body).toContainText("Let me explore the workspace first.");
  await expect(body).toContainText("Now for the readme.");
  await expect(body).toContainText("Now reading the readme.");
  await expect(body).toContainText("Time to summarize.");
  await expect(body.locator(".tool-card")).toHaveCount(2);
  const kinds = await body.evaluate((element) => [...element.children].map((child) => child.classList.contains("tool-card") ? "tool" : "text"));
  expect(kinds).toEqual(["text", "tool", "text", "text", "tool", "text"]);
});

test("previews the latest trace activity while a turn runs and keeps it after completion", async ({ page }) => {
  await page.addInitScript(() => {
    class MockWebSocket extends EventTarget {
      static OPEN = 1;
      constructor() {
        super();
        this.readyState = 0;
        queueMicrotask(() => { this.readyState = MockWebSocket.OPEN; this.dispatchEvent(new Event("open")); });
      }
      close() { this.readyState = 3; }
      send(data) {
        const request = JSON.parse(data);
        if (request.type !== "prompt") return;
        const emit = (payload, delay) => setTimeout(() => this.onmessage?.({ data: JSON.stringify(payload) }), delay);
        emit({ type: "generation_started", generationId: "g1", seq: 1 }, 0);
        emit({ type: "assistant_message_started", generationId: "g1", seq: 2, messageId: "m1" }, 10);
        emit({ type: "content_block_started", generationId: "g1", seq: 3, messageId: "m1", block: { type: "thinking", contentIndex: 0, text: "" } }, 20);
        emit({ type: "content_block_delta", generationId: "g1", seq: 4, messageId: "m1", blockType: "thinking", contentIndex: 0, delta: "Let me explore the workspace " }, 30);
        emit({ type: "content_block_delta", generationId: "g1", seq: 5, messageId: "m1", blockType: "thinking", contentIndex: 0, delta: "before answering." }, 40);
        emit({ type: "content_block_started", generationId: "g1", seq: 6, messageId: "m1", block: { type: "toolCall", contentIndex: 1, toolCallId: "call_1", name: "bash", arguments: { command: "ls" } } }, 990);
        emit({ type: "tool_execution_started", generationId: "g1", seq: 7, toolCallId: "call_1", name: "bash", arguments: { command: "ls" } }, 1000);
        emit({ type: "content_block_started", generationId: "g1", seq: 8, messageId: "m1", block: { type: "toolCall", contentIndex: 2, toolCallId: "call_2", name: "read", arguments: { path: "README.md" } } }, 1040);
        emit({ type: "tool_execution_started", generationId: "g1", seq: 9, toolCallId: "call_2", name: "read", arguments: { path: "README.md" } }, 1050);
        emit({ type: "tool_execution_completed", generationId: "g1", seq: 10, toolCallId: "call_1", name: "bash", isError: false }, 1400);
        emit({ type: "tool_execution_completed", generationId: "g1", seq: 11, toolCallId: "call_2", name: "read", isError: false }, 1450);
        emit({ type: "assistant_message_started", generationId: "g1", seq: 12, messageId: "m2" }, 1500);
        emit({ type: "content_block_started", generationId: "g1", seq: 13, messageId: "m2", block: { type: "thinking", contentIndex: 0, text: "" } }, 1510);
        emit({ type: "content_block_delta", generationId: "g1", seq: 14, messageId: "m2", blockType: "thinking", contentIndex: 0, delta: "Let me get more details about the project." }, 1520);
        emit({ type: "content_block_started", generationId: "g1", seq: 15, messageId: "m2", block: { type: "toolCall", contentIndex: 1, toolCallId: "call_3", name: "read", arguments: { path: "config.json" } } }, 1990);
        emit({ type: "tool_execution_started", generationId: "g1", seq: 16, toolCallId: "call_3", name: "read", arguments: { path: "config.json" } }, 2000);
        emit({ type: "tool_execution_completed", generationId: "g1", seq: 17, toolCallId: "call_3", name: "read", isError: false }, 2300);
        emit({ type: "assistant_message_started", generationId: "g1", seq: 18, messageId: "m3" }, 2400);
        emit({ type: "content_block_started", generationId: "g1", seq: 19, messageId: "m3", block: { type: "text", contentIndex: 0, text: "" } }, 2410);
        emit({ type: "content_block_delta", generationId: "g1", seq: 20, messageId: "m3", blockType: "text", contentIndex: 0, delta: "Here is what I found." }, 2420);
        emit({ type: "assistant_message_completed", generationId: "g1", seq: 21, messageId: "m3", stopReason: "stop", blocks: [{ type: "text", contentIndex: 0, text: "Here is what I found." }] }, 3200);
        window.__releaseAgentEnd = () => {
          window.__agentEnded = true;
          this.onmessage?.({ data: JSON.stringify({ type: "generation_settled", generationId: "g1", seq: 22 }) });
        };
      }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: MockWebSocket });
  });
  await page.route("**/v0/live-sessions", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { id: "live_trace", chatId: body.chatId, streamUrl: "/v0/live-sessions/live_trace/stream" } });
  });

  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message Pi" });
  await composer.fill("hi");
  await composer.press("Enter");

  const header = page.locator(".turn-trace-header");
  await expect(header).toContainText("Let me explore the workspace before answering.", { timeout: 4000 });
  await expect(header).toContainText("2 tool calls", { timeout: 4000 });
  await expect(page.locator(".turn-trace-body")).toHaveCount(0);
  await expect(header).toContainText("Let me get more details about the project.", { timeout: 4000 });
  await expect(header).toContainText("1 tool call (3 total)", { timeout: 4000 });
  await expect(page.locator(".bubble-assistant")).toContainText("Here is what I found.", { timeout: 4000 });

  await header.click();
  const body = page.locator(".turn-trace-body");
  await expect(body).toContainText("Let me explore the workspace before answering.");
  await expect(body).toContainText("Let me get more details about the project.");
  await expect(body.locator(".tool-card")).toHaveCount(3);
  const kinds = await body.evaluate((element) => [...element.children].map((child) => child.classList.contains("tool-card") ? "tool" : "text"));
  expect(kinds).toEqual(["text", "tool", "tool", "text", "tool"]);
  // The complete chronology is already present while the final answer streams,
  // before agent_end or a checkpoint reload can rebuild it from JSONL.
  expect(await page.evaluate(() => Boolean(window.__agentEnded))).toBe(false);
  await page.evaluate(() => window.__releaseAgentEnd());
  await expect(page.locator(".agent-activity")).toContainText("Ready", { timeout: 6000 });
});

test("selects a chat model through the runtime-aware model route", async ({ page }) => {
  const settingsRequest = page.waitForRequest((request) =>
    /\/v0\/chats\/[^/]+\/models$/.test(new URL(request.url()).pathname) && request.method() === "PATCH");
  await page.goto("/");

  await page.getByRole("button", { name: /Reasoner medium/ }).click();
  await page.getByRole("menuitemradio", { name: "Plain example" }).click();

  const request = await settingsRequest;
  expect(request.postDataJSON()).toEqual({ model: "example/plain", thinkingLevel: "off" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Plain off/ })).toBeVisible();
});

test("model scope settings searches and toggles multiple checked models", async ({ page }, testInfo) => {
  await page.goto("/");
  await openSidebar(page, testInfo);

  await page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit/ }).click();
  await page.getByRole("menuitem", { name: "Manage settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  const search = page.getByRole("combobox", { name: "Search available models" });
  await expect(search).toBeFocused();
  await search.fill("example plain");
  await expect(search).toHaveValue("example plain");
  await search.press("Space");
  await expect(search).toHaveValue("example plain ");
  await search.fill("");
  const reasoner = page.getByRole("option", { name: /Reasoner example\/reasoner/ });
  const plain = page.getByRole("option", { name: /Plain example\/plain/ });
  await expect(reasoner).toHaveAttribute("aria-selected", "true");
  await expect(reasoner.locator("svg")).toBeVisible();
  await reasoner.click();
  await expect(reasoner).toBeVisible();
  await expect(reasoner).toHaveAttribute("aria-selected", "false");
  await search.fill("reasoner");
  await search.press("ArrowDown");
  await expect(page.locator('[data-slot="combobox-item"][data-highlighted]')).toBeVisible();
  await search.press("Enter");
  await expect(reasoner).toHaveAttribute("aria-selected", "true");
  await expect(search).toBeVisible();
  await search.fill("");
  await search.press("ArrowDown");
  await expect(page.locator('[data-slot="combobox-item"][data-highlighted]')).toBeVisible();
  await reasoner.click();
  await plain.click();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await search.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("model scope search auto-focuses and its long result list scrolls", async ({ page }, testInfo) => {
  const manyModels = Array.from({ length: 36 }, (_, index) => ({
    provider: index < 18 ? "alpha" : "beta",
    id: `model-${index + 1}`,
    spec: `${index < 18 ? "alpha" : "beta"}/model-${index + 1}`,
    label: `Model ${String(index + 1).padStart(2, "0")}`,
    thinkingLevels: ["off"],
  }));
  await page.route("**/v0/settings?**", async (route) => {
    await route.fulfill({ json: {
      models: manyModels,
      enabledModels: manyModels.map((item) => item.spec),
      defaultModel: manyModels[0].spec,
    } });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit/ }).click();
  await page.getByRole("menuitem", { name: "Manage settings" }).click();

  const search = page.getByRole("combobox", { name: "Search available models" });
  const list = page.locator('[data-slot="combobox-list"]');
  await expect(search).toBeFocused();
  await expect(list).toBeVisible();
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await list.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await search.click();
  await search.fill("model 31");
  await expect(page.getByRole("option", { name: /Model 31 beta\/model-31/ })).toBeVisible();
});

test("settings adopts a delayed model scope until the user edits", async ({ page }, testInfo) => {
  let releaseSettings;
  const settingsReady = new Promise((resolve) => { releaseSettings = resolve; });
  await page.route("**/v0/settings?**", async (route) => {
    await settingsReady;
    await route.fulfill({ json: {
      models: [model, plainModel],
      enabledModels: [model.spec, plainModel.spec],
      defaultModel: model.spec,
    } });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit/ }).click();
  await page.getByRole("menuitem", { name: "Manage settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByText("Loading models…")).toBeVisible();

  releaseSettings();
  await expect(dialog.getByRole("option", { name: /Reasoner example\/reasoner/ })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("option", { name: /Plain example\/plain/ })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByText("2 enabled")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

test("uploads picker and dropped files through the same attachment surface", async ({ page }, testInfo) => {
  const uploads = [];
  await page.route("**/v0/chats/*/attachments/*?name=*", async (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/").at(-1);
    const name = url.searchParams.get("name");
    uploads.push({ id, name, body: route.request().postDataBuffer()?.toString() });
    await route.fulfill({ status: 201, json: { id, name, storedName: `${id}--${name}`, size: route.request().postDataBuffer()?.length || 0, type: "text/plain" } });
  });
  await page.goto("/");
  const attachmentButton = page.getByRole("button", { name: /^Attach files/ });
  await attachmentButton.click();
  await page.locator('input[type="file"]').setInputFiles({ name: "picker.txt", mimeType: "text/plain", buffer: Buffer.from("picker") });
  await expect(page.getByText("picker.txt", { exact: true })).toBeVisible();
  const attachment = page.locator('[data-slot="attachment-group"] [data-slot="attachment"]');
  await expect(attachment).toHaveCount(1);
  await expect(attachment).toHaveAttribute("data-size", "default");
  const [attachmentBox, mediaBox] = await Promise.all([
    attachment.boundingBox(),
    attachment.locator('[data-slot="attachment-media"]').boundingBox(),
  ]);
  expect(attachmentBox.width).toBeLessThanOrEqual(400);
  expect(mediaBox.width).toBe(40);
  const [trayBox, composerBox] = await Promise.all([
    page.locator(".attachment-tray").boundingBox(),
    page.locator(".composer").boundingBox(),
  ]);
  expect(trayBox.y + trayBox.height).toBeLessThanOrEqual(composerBox.y);
  await expect.poll(() => uploads.some((item) => item.name === "picker.txt" && item.body === "picker")).toBe(true);

  await page.keyboard.press("Escape");
  await page.locator(".chat-main").evaluate((target) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["dropped"], "dropped.txt", { type: "text/plain" }));
    target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: transfer }));
  });
  const overlay = page.getByText("Drop files to attach");
  await expect(overlay).toBeVisible();
  if (testInfo.project.name === "desktop-chromium") {
    const [overlayBox, mainBox, sidebarBox] = await Promise.all([
      page.locator(".chat-drop-overlay").boundingBox(),
      page.locator(".chat-main").boundingBox(),
      page.locator('[data-slot="sidebar-container"]').boundingBox(),
    ]);
    expect(overlayBox).toEqual(mainBox);
    expect(overlayBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width);
  }
  await page.locator(".chat-main").evaluate((target) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["dropped"], "dropped.txt", { type: "text/plain" }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
  });
  await expect(page.getByText("dropped.txt", { exact: true })).toBeVisible();
  await expect.poll(() => uploads.some((item) => item.name === "dropped.txt" && item.body === "dropped")).toBe(true);
  await expect(page.getByText("Drop files to attach")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Message Pi" }).fill("Use these files");
  await page.getByRole("button", { name: "Send message" }).click();
  const messageAttachments = page.getByLabel("Message attachments");
  await expect(messageAttachments).toContainText("picker.txt");
  await expect(messageAttachments).toContainText("dropped.txt");
  await expect(page.locator(".composer-wrap > .attachment-tray")).toHaveCount(0);
});

test("editing from history abandons the current attachment draft cleanly", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    let nextObjectUrl = 0;
    window.__createdObjectUrls = [];
    window.__revokedObjectUrls = [];
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => {
      const value = `blob:conduit-test-${++nextObjectUrl}`;
      window.__createdObjectUrls.push(value);
      return value;
    } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: (value) => window.__revokedObjectUrls.push(value) });
  });
  await page.route("**/v0/sessions/session_existing", async (route) => route.fulfill({ json: {
    id: "session_existing", projectId: "project_chat", status: "active", title: "Existing chat",
    messages: [{ id: "entry-user", role: "user", content: "Edit this prompt", attachments: [
      { id: "transcript-file", name: "transcript-notes.md", type: "text/markdown", size: 42 },
    ] }],
    tools: [], page: { before: null },
  } }));
  const uploads = [];
  const deletes = [];
  await page.route("**/v0/chats/session_existing/attachments/*", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    deletes.push(new URL(route.request().url()).pathname.split("/").at(-1));
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/v0/chats/session_existing/attachments/*?name=*", async (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/").at(-1);
    const name = url.searchParams.get("name");
    uploads.push({ id, name });
    if (name !== "draft-complete.png") await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      await route.fulfill({ status: 201, json: { id, name, storedName: `${id}--${name}`, size: 3, type: "image/png" } });
    } catch {
      // The expected XHR abort closes the intercepted request before fulfillment.
    }
  });

  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Existing chat" }).click();
  const picker = page.locator('input[type="file"]');
  await picker.setInputFiles({ name: "draft-complete.png", mimeType: "image/png", buffer: Buffer.from("one") });
  await expect.poll(() => uploads.map((item) => item.name)).toContain("draft-complete.png");
  await expect(page.getByText("draft-complete.png", { exact: true })).toBeVisible();
  await picker.setInputFiles(["a", "b", "c", "d"].map((name) => ({
    name: `draft-pending-${name}.png`, mimeType: "image/png", buffer: Buffer.from(name),
  })));
  await expect.poll(() => uploads.filter((item) => item.name.startsWith("draft-pending-")).length).toBe(3);

  await page.locator(".user-message-text", { hasText: "Edit this prompt" }).hover();
  await page.getByRole("button", { name: "Edit from here" }).click();
  await expect(page.locator(".composer-wrap > .attachment-tray")).toContainText("transcript-notes.md");
  await expect(page.locator(".composer-wrap > .attachment-tray")).not.toContainText("draft-complete.png");
  await expect.poll(() => deletes.length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__revokedObjectUrls.length)).toBe(5);
  await page.waitForTimeout(1700);
  expect(uploads.map((item) => item.name).sort()).toEqual([
    "draft-complete.png",
    "draft-pending-a.png",
    "draft-pending-b.png",
    "draft-pending-c.png",
  ].sort());
  expect(await page.evaluate(() => ({ created: window.__createdObjectUrls, revoked: window.__revokedObjectUrls }))).toEqual({
    created: ["blob:conduit-test-1", "blob:conduit-test-2", "blob:conduit-test-3", "blob:conduit-test-4", "blob:conduit-test-5"],
    revoked: ["blob:conduit-test-1", "blob:conduit-test-2", "blob:conduit-test-3", "blob:conduit-test-4", "blob:conduit-test-5"],
  });
});

test("stop freezes the visible response and rejects late generation deltas", async ({ page }) => {
  await page.addInitScript(() => {
    class StopWebSocket extends EventTarget {
      static OPEN = 1;
      constructor() {
        super(); this.readyState = 0;
        queueMicrotask(() => { this.readyState = StopWebSocket.OPEN; this.dispatchEvent(new Event("open")); });
      }
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
      send(data) {
        const command = JSON.parse(data);
        if (command.type === "prompt") queueMicrotask(() => {
          this.onmessage?.({ data: JSON.stringify({ type: "generation_started", generationId: "g1", seq: 1 }) });
          this.onmessage?.({ data: JSON.stringify({ type: "assistant_message_started", generationId: "g1", seq: 2, messageId: "m1" }) });
          this.onmessage?.({ data: JSON.stringify({ type: "content_block_started", generationId: "g1", seq: 3, messageId: "m1", block: { type: "text", contentIndex: 0, text: "" } }) });
          this.onmessage?.({ data: JSON.stringify({ type: "content_block_delta", generationId: "g1", seq: 4, messageId: "m1", blockType: "text", contentIndex: 0, delta: "Visible partial" }) });
        });
        if (command.type === "stop_generation") {
          window.__stopCommand = command;
          this.onmessage?.({ data: JSON.stringify({ type: "content_block_delta", generationId: "g1", seq: 5, messageId: "m1", blockType: "text", contentIndex: 0, delta: "LATE OUTPUT" }) });
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "generation_stopped", generationId: "g1", seq: 6, status: "stopped", processTerminated: false }) }), 150);
        }
      }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: StopWebSocket });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Message Pi" }).fill("Start");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("partial")).toBeVisible();
  await page.getByRole("button", { name: "Stop response" }).click();
  // Stopping may resolve quickly; accept either in-flight or completed stop UI.
  await expect(page.getByText(/Stopping…|Stopped/)).toBeVisible();
  await expect(page.getByText("LATE OUTPUT")).toHaveCount(0);
  await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__stopCommand)).toEqual({ type: "stop_generation", generationId: "g1" });
});

test("shows settled provider errors as assistant messages without a busy spinner", async ({ page }) => {
  let sessionReads = 0;
  let promptStarted = false;
  await page.route("**/v0/sessions/550e8400-e29b-41d4-a716-446655440099", async (route) => {
    sessionReads += 1;
    await route.fulfill({ json: {
      id: "550e8400-e29b-41d4-a716-446655440099",
      projectId: "project_chat",
      status: "active",
      title: "New chat",
      messages: promptStarted ? [
        { id: "persisted-user", role: "user", content: "Trigger an error" },
        ...(sessionReads > 1 ? [{
          id: "persisted-error",
          role: "assistant",
          content: "",
          stopReason: "error",
          errorMessage: "429: Free usage limit reached",
          provider: "opencode",
          model: "deepseek-v4-flash-free",
          timestamp: "2026-08-12T09:48:47.341Z",
        }] : []),
      ] : [],
      tools: [],
      page: { before: null },
    } });
  });
  await page.addInitScript(() => {
    class ErrorWebSocket extends EventTarget {
      static OPEN = 1;
      constructor() {
        super();
        this.readyState = 0;
        queueMicrotask(() => { this.readyState = ErrorWebSocket.OPEN; this.dispatchEvent(new Event("open")); });
      }
      close() { this.readyState = 3; }
      send(data) {
        if (JSON.parse(data).type !== "prompt") return;
        queueMicrotask(() => {
          this.onmessage?.({ data: JSON.stringify({ type: "generation_started", generationId: "g_error", seq: 1 }) });
          this.onmessage?.({ data: JSON.stringify({ type: "generation_running", generationId: "g_error", seq: 2 }) });
          this.onmessage?.({ data: JSON.stringify({ type: "assistant_message_started", generationId: "g_error", seq: 3, messageId: "m_error" }) });
          this.onmessage?.({ data: JSON.stringify({
            type: "assistant_message_completed",
            generationId: "g_error",
            seq: 4,
            messageId: "m_error",
            stopReason: "error",
            errorMessage: "429: Free usage limit reached",
            provider: "opencode",
            model: "deepseek-v4-flash-free",
            timestamp: "2026-08-12T09:48:47.341Z",
            blocks: [],
          }) });
          this.onmessage?.({ data: JSON.stringify({ type: "generation_turn_ended", generationId: "g_error", seq: 5, willRetry: false }) });
          this.onmessage?.({ data: JSON.stringify({ type: "generation_settled", generationId: "g_error", seq: 6 }) });
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({
            type: "session_checkpoint",
            generationId: "g_error",
            generationSeq: 6,
            chat: { id: "550e8400-e29b-41d4-a716-446655440099" },
          }) }), 50);
        });
      }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: ErrorWebSocket });
  });
  await page.route("**/v0/live-sessions", async (route) => {
    promptStarted = true;
    const body = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { id: "live_error", chatId: body.chatId, streamUrl: "/v0/live-sessions/live_error/stream" } });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Message Pi" }).fill("Trigger an error");
  await page.getByRole("button", { name: "Send message" }).click();

  const error = page.locator(".assistant-error");
  await expect(error).toContainText("Request failed");
  await expect(error).toContainText("429: Free usage limit reached");
  await expect(error).toContainText("deepseek-v4-flash-free");
  await expect(error).toContainText("opencode");
  await expect(error).toContainText("Assistant");
  await expect(error.locator("time")).toHaveAttribute("datetime", "2026-08-12T09:48:47.341Z");
  await expect.poll(() => sessionReads).toBeGreaterThan(0);
  await expect(error).toContainText("429: Free usage limit reached");
  await expect(page.locator(".composer-status-state")).toContainText("Request failed · Ready to retry");
  await expect(page.locator(".composer-status-state .animate-spin")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Message Pi" }).fill("Try another request");
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();

  await page.goto("/");
  await page.goto("/chat/550e8400-e29b-41d4-a716-446655440099");
  await expect(page.locator(".assistant-error")).toContainText("429: Free usage limit reached");
  await expect(page.locator(".composer-status-state")).toContainText("Request failed · Ready to retry");
  await expect(page.locator(".composer-status-state .animate-spin")).toHaveCount(0);
});

test("keeps streaming visible when a user checkpoint replaces the live placeholder", async ({ page }) => {
  await page.addInitScript(() => {
    class CheckpointWebSocket extends EventTarget {
      static OPEN = 1;
      constructor() {
        super(); this.readyState = 0;
        queueMicrotask(() => { this.readyState = CheckpointWebSocket.OPEN; this.dispatchEvent(new Event("open")); });
      }
      close() { this.readyState = 3; }
      send(data) {
        const command = JSON.parse(data);
        if (command.type !== "prompt") return;
        queueMicrotask(() => {
          this.onmessage?.({ data: JSON.stringify({ type: "generation_started", generationId: "g1", seq: 1 }) });
          this.onmessage?.({ data: JSON.stringify({ type: "assistant_message_started", generationId: "g1", seq: 2, messageId: "m1" }) });
          this.onmessage?.({ data: JSON.stringify({ type: "content_block_started", generationId: "g1", seq: 3, messageId: "m1", block: { type: "text", contentIndex: 0, text: "" } }) });
          this.onmessage?.({ data: JSON.stringify({ type: "session_checkpoint", generationId: "g1", chat: { id: "550e8400-e29b-41d4-a716-446655440099" } }) });
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({
            type: "content_block_delta",
            generationId: "g1",
            seq: 4,
            messageId: "m1",
            blockType: "text",
            contentIndex: 0,
            delta: "Visible after checkpoint",
          }) }), 200);
        });
      }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: CheckpointWebSocket });
  });
  await page.route("**/v0/sessions/550e8400-e29b-41d4-a716-446655440099", async (route) => {
    await route.fulfill({ json: {
      id: "550e8400-e29b-41d4-a716-446655440099",
      projectId: "project_chat",
      status: "active",
      title: "New chat",
      messages: [{ id: "durable-user", role: "user", content: "Start" }],
      tools: [],
      page: { before: null },
    } });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Message Pi" }).fill("Start");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Visible after checkpoint")).toBeVisible();
});

test("a delayed terminal checkpoint cannot clear the next generation", async ({ page }) => {
  await page.addInitScript(() => {
    class CheckpointRaceWebSocket extends EventTarget {
      static OPEN = 1;
      constructor() {
        super(); this.readyState = 0; this.prompts = 0;
        queueMicrotask(() => { this.readyState = CheckpointRaceWebSocket.OPEN; this.dispatchEvent(new Event("open")); });
      }
      close() { this.readyState = 3; }
      emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
      send(data) {
        if (JSON.parse(data).type !== "prompt") return;
        this.prompts += 1;
        if (this.prompts === 1) {
          queueMicrotask(() => {
            this.emit({ type: "generation_started", generationId: "g1", seq: 1 });
            this.emit({ type: "assistant_message_started", generationId: "g1", seq: 2, messageId: "m1" });
            this.emit({ type: "content_block_started", generationId: "g1", seq: 3, messageId: "m1", block: { type: "text", contentIndex: 0, text: "" } });
            this.emit({ type: "content_block_delta", generationId: "g1", seq: 4, messageId: "m1", blockType: "text", contentIndex: 0, delta: "Generation A" });
            this.emit({ type: "assistant_message_completed", generationId: "g1", seq: 5, messageId: "m1", stopReason: "stop", blocks: [{ type: "text", contentIndex: 0, text: "Generation A" }] });
            this.emit({ type: "generation_settled", generationId: "g1", seq: 6 });
            this.emit({ type: "session_checkpoint", generationId: "g1", generationSeq: 6, chat: { id: "550e8400-e29b-41d4-a716-446655440099" } });
          });
          return;
        }
        queueMicrotask(() => {
          this.emit({ type: "generation_started", generationId: "g2", seq: 1 });
          this.emit({ type: "assistant_message_started", generationId: "g2", seq: 2, messageId: "m2" });
          this.emit({ type: "content_block_started", generationId: "g2", seq: 3, messageId: "m2", block: { type: "text", contentIndex: 0, text: "" } });
          this.emit({ type: "content_block_delta", generationId: "g2", seq: 4, messageId: "m2", blockType: "text", contentIndex: 0, delta: "Generation B survives" });
        });
      }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: CheckpointRaceWebSocket });
  });
  let checkpointRequested;
  const checkpointPending = new Promise((resolve) => { checkpointRequested = resolve; });
  let releaseCheckpoint;
  const checkpointResponse = new Promise((resolve) => { releaseCheckpoint = resolve; });
  await page.route("**/v0/sessions/550e8400-e29b-41d4-a716-446655440099", async (route) => {
    checkpointRequested();
    await checkpointResponse;
    await route.fulfill({ headers: { "cache-control": "no-store" }, json: {
      id: "550e8400-e29b-41d4-a716-446655440099", projectId: "project_chat", status: "active", title: "New chat",
      messages: [{ id: "durable-a", role: "assistant", content: "Generation A" }], tools: [], page: { before: null },
    } });
  });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message Pi" });
  await composer.fill("First");
  await page.getByRole("button", { name: "Send message" }).click();
  await checkpointPending;
  await composer.fill("Second");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Generation B survives")).toBeVisible();
  releaseCheckpoint();
  await expect(page.getByText("Generation B survives")).toBeVisible();
});

for (const phase of ["thinking", "tool", "answer", "settlement"]) {
  test(`reconnects a live chat after socket loss during ${phase}`, async ({ page }) => {
    await page.addInitScript((reconnectPhase) => {
      const chatId = "550e8400-e29b-41d4-a716-446655440099";
      const generationId = "reconnect-generation";
      const messageId = "reconnect-assistant";
      const blockType = reconnectPhase === "thinking" ? "thinking" : reconnectPhase === "tool" ? "toolCall" : "text";
      const initialText = reconnectPhase === "thinking" ? "Thinking survives" : reconnectPhase === "answer" ? "Answer survives" : "Terminal live answer";
      const block = {
        type: blockType,
        contentIndex: 0,
        identity: `${generationId}:${messageId}:0`,
        status: reconnectPhase === "settlement" ? "complete" : "streaming",
        ...(blockType === "toolCall" ? { toolCallId: "reconnect-tool", name: "bash", arguments: { command: "pwd" } } : { text: initialText }),
      };
      const resume = {
        id: generationId,
        status: reconnectPhase === "settlement" ? "complete" : "running",
        assistantMessages: [{
          id: messageId,
          status: reconnectPhase === "settlement" ? "complete" : "streaming",
          stopReason: reconnectPhase === "settlement" ? "stop" : null,
          errorMessage: null,
          blocks: [block],
        }],
        toolExecutions: reconnectPhase === "tool" ? {
          "reconnect-tool": {
            toolCallId: "reconnect-tool",
            name: "bash",
            arguments: { command: "pwd" },
            status: "running",
            partialResult: "working",
            result: null,
            isError: false,
          },
        } : {},
        retry: null,
        error: null,
        lastSeq: reconnectPhase === "settlement" ? 6 : 4,
      };
      const runtimeState = () => ({
        type: "runtime_state",
        session: {
          generation: { id: generationId, closed: reconnectPhase === "settlement", settled: reconnectPhase === "settlement" },
          stopping: false,
          active: reconnectPhase !== "settlement",
        },
      });
      class ReconnectingWebSocket extends EventTarget {
        static OPEN = 1;
        static instances = [];
        constructor(url) {
          super();
          this.url = url;
          this.readyState = 0;
          ReconnectingWebSocket.instances.push(this);
          queueMicrotask(() => {
            this.readyState = ReconnectingWebSocket.OPEN;
            this.dispatchEvent(new Event("open"));
            if (ReconnectingWebSocket.instances.length !== 2) return;
            this.emit({ type: "generation_resume", generationId, seq: resume.lastSeq, generation: resume });
            this.emit(runtimeState());
            if (reconnectPhase === "thinking") this.emit({ type: "content_block_delta", generationId, seq: 5, messageId, contentIndex: 0, blockType: "thinking", delta: " recovered" });
            if (reconnectPhase === "tool") this.emit({ type: "tool_execution_completed", generationId, seq: 5, toolCallId: "reconnect-tool", name: "bash", result: "Done after reconnect", isError: false });
            if (reconnectPhase === "answer") this.emit({ type: "content_block_delta", generationId, seq: 5, messageId, contentIndex: 0, blockType: "text", delta: " recovered" });
            if (reconnectPhase === "settlement") this.emit({ type: "session_checkpoint", generationId, generationSeq: 6, chat: { id: chatId } });
          });
        }
        emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
        close() {
          if (this.readyState === 3) return;
          this.readyState = 3;
          this.dispatchEvent(new Event("close"));
        }
        send(payload) {
          if (JSON.parse(payload).type !== "prompt" || ReconnectingWebSocket.instances.length !== 1) return;
          queueMicrotask(() => {
            this.emit({ type: "generation_started", generationId, seq: 1 });
            this.emit({ type: "assistant_message_started", generationId, seq: 2, messageId });
            this.emit({ type: "content_block_started", generationId, seq: 3, messageId, block });
            if (reconnectPhase === "tool") this.emit({ type: "tool_execution_started", generationId, seq: 4, toolCallId: "reconnect-tool", name: "bash", arguments: { command: "pwd" } });
            else if (reconnectPhase === "settlement") {
              this.emit({ type: "assistant_message_completed", generationId, seq: 4, messageId, stopReason: "stop", blocks: [block] });
              this.emit({ type: "generation_settled", generationId, seq: 6 });
            } else this.emit({ type: "content_block_delta", generationId, seq: 4, messageId, contentIndex: 0, blockType, delta: initialText });
            this.close();
          });
        }
      }
      Object.defineProperty(window, "WebSocket", { configurable: true, value: ReconnectingWebSocket });
      Object.defineProperty(window, "__reconnectSockets", { configurable: true, get: () => ReconnectingWebSocket.instances });
    }, phase);

    let sessionReads = 0;
    await page.route("**/v0/live-sessions", async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: {
        id: "live_reconnect",
        chatId: body.chatId,
        streamUrl: "/v0/live-sessions/live_reconnect/stream",
      } });
    });
    await page.route("**/v0/sessions/550e8400-e29b-41d4-a716-446655440099", async (route) => {
      sessionReads += 1;
      await route.fulfill({ json: {
        id: "550e8400-e29b-41d4-a716-446655440099",
        projectId: "project_chat",
        status: "active",
        title: "New chat",
        messages: phase === "settlement" && sessionReads >= 1
          ? [{ id: "persisted-answer", role: "assistant", content: "Persisted after reconnect" }]
          : [],
        tools: [],
        page: { before: null },
      } });
    });

    await page.goto("/");
    await page.getByRole("textbox", { name: "Message Pi" }).fill(`Reconnect during ${phase}`);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect.poll(() => page.evaluate(() => window.__reconnectSockets.length)).toBe(2);

    if (phase === "thinking") await expect(page.locator(".turn-trace-header")).toContainText("Thinking survives recovered");
    if (phase === "tool") {
      await page.locator(".turn-trace-header").click();
      await expect(page.locator(".tool-card")).toHaveAttribute("data-status", "complete");
    }
    if (phase === "answer") await expect(page.locator(".bubble-assistant")).toContainText("Answer survives recovered");
    if (phase === "settlement") await expect(page.locator(".bubble-assistant")).toContainText("Persisted after reconnect");
  });
}

test("global commands and slash suggestions preserve their intended focus models", async ({ page }, testInfo) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message Pi" });
  await composer.fill("/");
  const slashList = page.getByRole("listbox", { name: "Suggestions" });
  await expect(slashList).toBeVisible();
  await expect(slashList.getByRole("option")).toHaveCount(1);
  await expect(slashList.getByRole("option", { name: /\/attach/ })).toBeVisible();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveAttribute("aria-expanded", "true");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles([]);
  await expect(composer).toBeFocused();

  for (const command of ["/settings", "/model", "/stop", "/regenerate", "/continue", "/copy"]) {
    await composer.fill(command);
    await expect(slashList).toHaveCount(0);
    await expect(composer).toHaveValue(command);
  }
  await composer.fill("/att");
  await page.keyboard.press("Escape");
  await expect(composer).toHaveValue("/att");
  await expect(slashList).toHaveCount(0);

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await expect(palette).toBeVisible();
  const [paletteBox, viewport] = await Promise.all([palette.locator(".command-shell").boundingBox(), page.evaluate(() => ({ width: innerWidth, height: innerHeight }))]);
  // ≤480px: full-bleed shell. Wider viewports: centered card (2px epsilon for
  // Mobile Chromium's fractional scrollbar gutter).
  if (viewport.width <= 480 || testInfo.project.name === "mobile-chromium") {
    expect(paletteBox.x).toBeLessThanOrEqual(2);
    expect(paletteBox.y).toBeLessThanOrEqual(2);
    expect(Math.abs(paletteBox.width - viewport.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(paletteBox.height - viewport.height)).toBeLessThanOrEqual(2);
  } else {
    expect(Math.abs(paletteBox.x + paletteBox.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(paletteBox.y + paletteBox.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
  }
  const [statusBox, composerBox] = await Promise.all([page.locator(".composer-status").boundingBox(), page.locator(".composer").boundingBox()]);
  expect(statusBox.width).toBe(composerBox.width);
  await expect(page.locator(".composer-status")).toContainText(/Ready|Responding|Thinking/);
  await expect(palette.getByRole("combobox", { name: "Search commands" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#root")).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(composer).toBeFocused();

  // Settings is a drill-down page: sections live behind it and never leak into
  // the root list. Opening a section from the page opens the Settings dialog.
  await page.keyboard.press("Control+k");
  await expect(palette.getByRole("option", { name: /^Settings…/ })).toBeVisible();
  await expect(palette.getByRole("option", { name: /^Runtime$/ })).toHaveCount(0);
  await palette.getByRole("option", { name: /^Settings…/ }).click();
  await expect(palette.getByText("Settings ›")).toBeVisible();
  await expect(palette.getByRole("option", { name: /^General/ })).toBeVisible();
  await palette.getByRole("option", { name: /^General/ }).click();
  let settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: /General/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");

  // Markdown renderer selection belongs in Settings → UI and updates the
  // active transcript immediately.
  await page.keyboard.press("Control+k");
  await palette.getByRole("option", { name: /^Settings…/ }).click();
  await palette.getByRole("combobox").fill("ui");
  await palette.getByRole("option", { name: /^UI$/ }).click();
  settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await expect(settingsDialog.getByRole("tab", { name: /^UI$/ })).toHaveAttribute("aria-selected", "true");
  const markdownRenderer = settingsDialog.getByRole("combobox", { name: "Markdown renderer" });
  await expect(markdownRenderer).toHaveValue("incremark-synthetic");
  await markdownRenderer.selectOption("incremark-typewriter");
  await expect(page.locator(".transcript")).toHaveAttribute("data-markdown-renderer", "incremark-typewriter");
  await page.keyboard.press("Escape");

  // Runtime is reached by drilling into Settings, then searching within the page.
  await page.keyboard.press("Control+k");
  await palette.getByRole("option", { name: /^Settings…/ }).click();
  await palette.getByRole("combobox").fill("runtime");
  await expect(palette.getByRole("option", { name: /^Runtime$/ })).toBeVisible();
  await palette.getByRole("option", { name: /^Runtime$/ }).click();
  settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: /Runtime/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await palette.getByRole("combobox").fill("new folder");
  await palette.getByRole("option", { name: /^New folder/ }).click();
  await expect(page.getByRole("dialog", { name: "New folder" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await palette.getByRole("combobox").fill("example plain");
  await expect(palette.getByRole("option", { name: /Plain/ })).toBeVisible();
  const settingsRequest = page.waitForRequest((request) => /\/v0\/chats\/[^/]+\/models$/.test(new URL(request.url()).pathname)
    && request.method() === "PATCH");
  await palette.getByRole("option", { name: /Plain/ }).click();
  await settingsRequest;

  await page.keyboard.press("Control+k");
  await palette.getByRole("combobox").fill("delete chat");
  await palette.getByRole("option", { name: /Delete chat/ }).click();
  const deleteDialog = page.getByRole("alertdialog", { name: "Delete this chat?" });
  await expect(deleteDialog).toBeVisible();
  const deleteRequest = page.waitForRequest((request) => request.method() === "DELETE" && /\/v0\/sessions\/[^/]+$/.test(new URL(request.url()).pathname));
  await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await deleteRequest;
  await expect(deleteDialog).toHaveCount(0);
  await page.waitForTimeout(250);
  await expect(page.getByRole("alertdialog", { name: "Delete this chat?" })).toHaveCount(0);
});

test("message actions copy source, edit from a Pi entry, and regenerate via fork", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    class RecordingWebSocket extends EventTarget {
      static OPEN = 1;
      constructor() { super(); this.readyState = 0; queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); }); }
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
      send(data) { (window.__commands ||= []).push(JSON.parse(data)); }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: RecordingWebSocket });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { window.__copiedMessage = value; } } });
  });
  await page.route("**/v0/sessions/session_existing", async (route) => route.fulfill({ json: {
    id: "session_existing", projectId: "project_chat", status: "active", title: "Existing chat",
    messages: [
      { id: "entry-user", role: "user", content: "Original question", attachments: [
        { id: "file-one", name: "source-notes.md", type: "text/markdown", size: 128 },
        { id: "image-one", name: "reference.png", type: "image/png", size: 256 },
      ] },
      { id: "entry-assistant", role: "assistant", content: "**Source Markdown**" },
    ], tools: [], page: { before: null },
  } }));
  // 1x1 PNG so the composer preview keeps the img (onError degrades to icon).
  await page.route("**/v0/chats/session_existing/attachments/image-one?preview=1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Existing chat" }).click();
  await expect(page.getByLabel("Message attachments")).toContainText("source-notes.md");
  await expect(page.getByLabel("Message attachments").locator('[data-slot="attachment"]')).toHaveCount(2);
  expect(await page.getByLabel("Message attachments").evaluate((element) => Boolean(element.closest('[data-slot="bubble"]')))).toBe(false);
  await page.getByText("Source Markdown", { exact: true }).hover();
  await page.getByRole("button", { name: "Copy Markdown" }).click();
  await expect.poll(() => page.evaluate(() => window.__copiedMessage)).toBe("**Source Markdown**");
  await page.locator(".user-message-text", { hasText: "Original question" }).hover();
  await page.getByRole("button", { name: "Edit from here" }).click();
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toHaveValue("Original question");
  await expect(page.locator('[data-slot="bubble"][data-editing="true"]')).toContainText("Original question");
  await expect(page.locator(".composer-wrap > .attachment-tray")).toContainText("source-notes.md");
  await expect(page.locator(".composer-wrap > .attachment-tray img")).toHaveAttribute(
    "src",
    "/v0/chats/session_existing/attachments/image-one?preview=1",
  );
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toHaveValue("");
  await expect(page.locator('[data-slot="bubble"][data-editing="true"]')).toHaveCount(0);
  await expect(page.locator(".composer-wrap > .attachment-tray")).toHaveCount(0);
  await page.getByText("Source Markdown", { exact: true }).hover();
  await page.getByRole("button", { name: "Regenerate response" }).click();
  await expect.poll(() => page.evaluate(() => window.__commands?.find((command) => command.type === "regenerate"))).toEqual({
    type: "regenerate",
    entryId: "entry-user",
    model: "example/reasoner",
    thinkingLevel: "medium",
  });
});

test("settings remains centered with a persistent vertical rail at narrow widths", async ({ page }, testInfo) => {
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit/ }).click();
  await page.getByRole("menuitem", { name: "Manage settings" }).click();
  await page.setViewportSize({ width: 480, height: 720 });
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const rail = dialog.locator('[data-slot="tabs-list"]');
  await expect(rail).toBeVisible();
  const [dialogBox, railBox] = await Promise.all([dialog.boundingBox(), rail.boundingBox()]);
  expect(Math.abs(dialogBox.x + dialogBox.width / 2 - 240)).toBeLessThanOrEqual(2);
  expect(railBox.width).toBeGreaterThan(60);
});

test("generation_limit bounce surfaces an error and keeps the composer usable", async ({ page }) => {
  await page.addInitScript(() => {
    class LimitWebSocket extends EventTarget {
      static OPEN = 1;
      constructor() {
        super();
        this.readyState = 0;
        queueMicrotask(() => {
          this.readyState = LimitWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        });
      }
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
      send(data) {
        const command = JSON.parse(data);
        if (command.type === "prompt") {
          queueMicrotask(() => {
            this.onmessage?.({ data: JSON.stringify({
              type: "client_error",
              code: "generation_limit",
              message: "Too many concurrent generations (max 2). Wait for another chat to finish.",
            }) });
          });
        }
      }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: LimitWebSocket });
  });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message Pi" });
  await composer.fill("Should bounce");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/Too many concurrent generations/i)).toBeVisible();
  await expect(composer).toHaveValue("Should bounce");
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
});

test("runtime settings exposes warm pool and concurrent generation caps", async ({ page }, testInfo) => {
  await page.route("**/v0/runtime/settings", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: {
        maxLiveProcesses: 12,
        maxGeneratingProcesses: 2,
        idleProcessTtlMs: 120_000,
        liveCount: 3,
        generatingCount: 1,
      } });
      return;
    }
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() || {};
      await route.fulfill({ json: {
        maxLiveProcesses: Number(body.maxLiveProcesses) || 12,
        maxGeneratingProcesses: Number(body.maxGeneratingProcesses) || 2,
        idleProcessTtlMs: Number(body.idleProcessTtlMs) || 120_000,
        liveCount: 3,
        generatingCount: 1,
      } });
      return;
    }
    await route.fallback();
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit/ }).click();
  await page.getByRole("menuitem", { name: "Manage settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("tab", { name: /Runtime/ }).click();
  await expect(dialog.getByText("Max warm Pi processes")).toBeVisible();
  await expect(dialog.getByText("Max concurrent generations")).toBeVisible();
  await expect(dialog.getByText("3 live now")).toBeVisible();
  await expect(dialog.getByText("1 generating")).toBeVisible();
});

test("runtime settings reports load failures and recovers on retry", async ({ page }, testInfo) => {
  let failing = true;
  await page.route("**/v0/runtime/settings", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    if (failing) return route.fulfill({ status: 503, json: { message: "Runtime settings unavailable" } });
    return route.fulfill({ json: {
      maxLiveProcesses: 8,
      maxGeneratingProcesses: 2,
      idleProcessTtlMs: 60_000,
      liveCount: 0,
      generatingCount: 0,
    } });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit/ }).click();
  await page.getByRole("menuitem", { name: "Manage settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("tab", { name: /Runtime/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("Runtime settings unavailable");
  await expect(dialog.getByText("Loading runtime settings…")).toHaveCount(0);

  failing = false;
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expect(dialog.getByText("Max warm Pi processes")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save runtime settings" })).toBeDisabled();
});

test("host Pi re-detection immediately updates the Workspace profile menu", async ({ page }, testInfo) => {
  const workspace = {
    id: "project_workspace",
    slug: "workspace",
    name: "Workspace",
    kind: "workspace",
    origin: "linked",
    defaultTemplateId: "workspace",
    sessions: [],
  };
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [...projects, workspace] } }));
  await page.unroute("**/v0/pi-installations");
  await page.route("**/v0/pi-installations", (route) => route.fulfill({ json: { installations: [
    { id: "conduit-pinned", label: "Isolated Pi", version: "0.84.1", available: true },
    { id: "host-pi", label: "Host Pi", version: null, available: false, error: "Host Pi was not found" },
  ] } }));
  await page.route("**/v0/pi-installations/host/detect", (route) => route.fulfill({ json: {
    id: "host-pi", label: "Host Pi", version: "0.80.10", compatible: true, available: true,
  } }));
  await page.unroute("**/v0/chats");
  await page.route("**/v0/chats", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: {
      id: "550e8400-e29b-41d4-a716-446655440077",
      projectId: body.projectId,
      status: "draft",
      title: "New chat",
      templateId: body.templateId,
      runtime: { kind: body.runtimeKind, installationId: "conduit-pinned", profileId: body.templateId },
    } });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit/ }).click();
  await page.getByRole("menuitem", { name: "Manage settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("tab", { name: /Runtime/ }).click();
  await settings.getByRole("button", { name: "Re-detect Host Pi" }).click();
  await expect(settings.getByText("Pi 0.80.10")).toBeVisible();
  await page.keyboard.press("Escape");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Workspace", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "New chat" }).click();
  await page.getByRole("button", { name: "Profile Coding" }).click();
  await expect(page.getByRole("menuitemradio", { name: /Host Pi/ })).toBeEnabled();
});

test("workspace dashboard is a direct routable operator surface", async ({ page }) => {
  const workspace = {
    id: "project_workspace",
    slug: "conduit",
    name: "Conduit",
    kind: "workspace",
    origin: "linked",
    path: "/home/conduit",
    externalPath: "/home/conduit",
    createdAt: "2026-07-20T10:00:00.000Z",
    defaultTemplateId: "workspace",
    workspaceAppearance: { mode: "icon", value: "boxes", color: "mauve" },
    deletesFilesOnRemove: false,
    sessions: [{
      id: "session_workspace",
      projectId: "project_workspace",
      status: "active",
      title: "Build dashboard",
      updatedAt: "2026-07-28T01:00:00.000Z",
    }],
  };
  let releaseDashboard;
  const dashboardGate = new Promise((resolve) => { releaseDashboard = resolve; });
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [...projects, workspace] } }));
  await page.route("**/v0/projects/project_workspace/dashboard", async (route) => {
    await dashboardGate;
    await route.fulfill({ json: {
      identity: { ...workspace, sessions: undefined },
      stats: { totalChats: 1, activeChats: 1, liveChats: 0, liveTerminals: 1, lastActivityAt: "2026-07-28T01:00:00.000Z" },
      git: {
        branch: "agent/issue-40-project-dashboard",
        upstream: "origin/main",
        ahead: 2,
        behind: 0,
        lastCommitAt: "2026-07-28T00:30:00.000Z",
        hasUnstaged: true,
        changedFiles: 4,
      },
      recentChats: [{
        ...workspace.sessions[0],
        lastMessageAt: "2026-07-28T01:00:00.000Z",
        lastMessagePreview: "The route and dashboard payload are wired.",
      }],
    } });
  });
  const profilePatch = page.waitForRequest((request) =>
    request.url().endsWith("/v0/projects/project_workspace") && request.method() === "PATCH");
  await page.route("**/v0/projects/project_workspace", async (route) => {
    if (route.request().method() === "DELETE") return route.fulfill({ status: 204, body: "" });
    const body = route.request().postDataJSON();
    await route.fulfill({ json: {
      ...workspace,
      defaultTemplateId: Object.hasOwn(body, "defaultTemplateId") ? body.defaultTemplateId : workspace.defaultTemplateId,
      workspaceAppearance: Object.hasOwn(body, "workspaceAppearance") ? body.workspaceAppearance : workspace.workspaceAppearance,
    } });
  });

  await page.goto("/workspace/project_workspace");

  await expect(page).toHaveURL(/\/workspace\/project_workspace$/);
  await expect(page.getByRole("heading", { name: "Conduit", level: 1 })).toBeVisible();
  await expect(page.getByText("Linked workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: "/home/conduit" })).toBeVisible();
  await expect(page.locator(".composer")).toHaveCount(0);

  await page.getByRole("button", { name: "Coding", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Assistant" }).click();
  expect((await profilePatch).postDataJSON()).toEqual({ defaultTemplateId: "chat" });
  await expect(page.getByRole("button", { name: "Assistant", exact: true })).toBeVisible();

  // A slower initial dashboard response must not overwrite the confirmed
  // profile choice with its stale identity snapshot.
  releaseDashboard();
  await expect(page.getByText("agent/issue-40-project-dashboard")).toBeVisible();
  await expect(page.locator(".project-chat-row")).toContainText("The route and dashboard payload are wired.");
  await expect(page.getByRole("button", { name: "Assistant", exact: true })).toBeVisible();
  await expect(page.getByText("resident PTY")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open command palette" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy Tailscale workspace link" })).toBeVisible();
  await expect(page.locator('[data-workspace-appearance="editor"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Identity", exact: true }).click();
  const appearanceDialog = page.getByRole("dialog", { name: "Workspace identity" });
  await expect(appearanceDialog.locator('[data-workspace-appearance="editor"]')).toBeVisible();
  await expect(appearanceDialog.getByRole("radio", { name: "Boxes" })).toHaveAttribute("aria-checked", "true");
  await appearanceDialog.getByRole("button", { name: "Browse icons" }).click();
  await appearanceDialog.getByLabel("Search icons").fill("atom");
  await appearanceDialog.getByRole("radio", { name: "Atom" }).click();
  await appearanceDialog.getByRole("button", { name: "More colours" }).click();
  await appearanceDialog.getByLabel("Hex colour").fill("#123456");
  const appearancePatch = page.waitForRequest((request) => request.url().endsWith("/v0/projects/project_workspace")
    && request.method() === "PATCH" && request.postDataJSON()?.workspaceAppearance);
  await appearanceDialog.getByRole("button", { name: "Save identity" }).click();
  expect((await appearancePatch).postDataJSON()).toEqual({ workspaceAppearance: { mode: "icon", value: "atom", color: "#123456" } });
  await expect(appearanceDialog).toBeHidden();
  await expect(page.locator(".project-kind-icon .workspace-glyph")).toHaveAttribute("data-mode", "icon");
  await page.getByText("Danger zone").click();
  await page.getByRole("button", { name: "Delete Workspace and files" }).click();
  const destructiveDialog = page.getByRole("alertdialog");
  await expect(destructiveDialog.getByRole("button", { name: "Delete Workspace and files" })).toBeDisabled();
  await destructiveDialog.getByLabel("Workspace name").fill("Conduit");
  const destructiveRequest = page.waitForRequest((request) => request.url().endsWith("/v0/projects/project_workspace") && request.method() === "DELETE");
  await destructiveDialog.getByRole("button", { name: "Delete Workspace and files" }).click();
  expect((await destructiveRequest).postDataJSON()).toEqual({ mode: "destroy_workspace", confirmation: "Conduit" });
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  await expect(page.getByRole("complementary", { name: "Workspace panel" })).toBeVisible();
});

test("dashboard history preserves a new draft for browser forward navigation", async ({ page }) => {
  const workspace = {
    id: "project_workspace",
    slug: "conduit",
    name: "Conduit",
    kind: "workspace",
    origin: "linked",
    path: "/home/conduit",
    defaultTemplateId: "workspace",
    deletesFilesOnRemove: false,
    sessions: [],
  };
  const draft = {
    id: "session_workspace_draft",
    projectId: workspace.id,
    status: "draft",
    title: "New chat",
    templateId: "workspace",
  };
  let draftDeletes = 0;
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [...projects, workspace] } }));
  await page.route("**/v0/projects/project_workspace/dashboard", (route) => route.fulfill({ json: {
    identity: workspace,
    stats: { totalChats: 0, activeChats: 0, liveChats: 0, lastActivityAt: null },
    git: null,
    recentChats: [],
  } }));
  await page.unroute("**/v0/chats");
  await page.route("**/v0/chats", (route) => route.fulfill({ status: 201, json: draft }));
  await page.route("**/v0/sessions/session_workspace_draft", (route) => route.fulfill({ json: {
    ...draft,
    messages: [],
    tools: [],
    page: { before: null },
  } }));
  await page.route("**/v0/chats/session_workspace_draft?ifEmpty=true", (route) => {
    draftDeletes += 1;
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/workspace/project_workspace");
  await page.locator(".project-identity-actions").getByRole("button", { name: "New chat" }).click();
  await expect(page).toHaveURL(/\/chat\/session_workspace_draft$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/workspace\/project_workspace$/);
  await expect(page.getByRole("heading", { name: "Conduit", level: 1 })).toBeVisible();
  expect(draftDeletes).toBe(0);

  await page.goForward();
  await expect(page).toHaveURL(/\/chat\/session_workspace_draft$/);
  await expect(page.locator(".composer")).toBeVisible();
  expect(draftDeletes).toBe(0);
});

test("project chevron expands independently and project name navigates", async ({ page }, testInfo) => {
  const research = {
    ...projects[1],
    path: "/data/chat/files/research",
    createdAt: "2026-07-21T10:00:00.000Z",
    sessions: [{
      id: "session_research",
      projectId: "project_research",
      status: "active",
      title: "Research chat",
      updatedAt: "2026-07-27T01:00:00.000Z",
    }],
  };
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [projects[0], research] } }));
  await page.route("**/v0/projects/project_research/dashboard", (route) => route.fulfill({ json: {
    identity: { ...research, sessions: undefined },
    stats: { totalChats: 1, activeChats: 1, liveChats: 0, lastActivityAt: research.sessions[0].updatedAt },
    git: null,
    recentChats: [{ ...research.sessions[0], lastMessagePreview: "A recent research result." }],
  } }));

  await page.goto("/chat/session_existing");
  await openSidebar(page, testInfo);
  const block = page.locator(".sidebar-project-block").filter({ hasText: "Research" });
  await expect(block.getByRole("button", { name: "Research", exact: true })).toBeVisible();
  await expect(block.getByRole("button", { name: "Research chat" })).toBeVisible();

  await block.getByRole("button", { name: "Collapse chat list" }).click();
  await expect(block.getByRole("button", { name: "Research chat" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/chat\/session_existing$/);

  await block.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page).toHaveURL(/\/project\/project_research$/);
  await expect(page.getByRole("heading", { name: "Research", level: 1 })).toBeVisible();
  if (testInfo.project.name === "mobile-chromium") {
    await expect(page.locator(".conduit-sidebar")).toHaveAttribute("data-mobile-open", "false");
  }
});
