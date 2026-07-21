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
  label: "General",
  version: 1,
  defaultable: true,
  tools: ["read", "write", "edit", "bash"],
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
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class IdleWebSocket extends EventTarget {
      static OPEN = 1;
      constructor() {
        super();
        this.readyState = 0;
        queueMicrotask(() => { this.readyState = IdleWebSocket.OPEN; this.dispatchEvent(new Event("open")); });
      }
      send() {}
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
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
  await page.route("**/v0/runtime", async (route) => {
    await route.fulfill({ json: { type: "runtime_global_snapshot", processes: [], at: new Date().toISOString() } });
  });
  await page.route("**/v0/pi-installations", async (route) => {
    await route.fulfill({ json: { installations: [
      { id: "conduit-pinned", label: "Isolated Pi", version: "0.80.6", available: true },
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
    await route.fulfill({ json: { id: "live_existing", streamUrl: "/v0/live-sessions/live_existing/stream" } });
  });
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
  await expect(dialog).toHaveAttribute("data-state", "closed");
});

test("keeps the native textarea composer bounded in a thread", async ({ page }, testInfo) => {
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Existing chat" }).click();
  await expect(page.getByText("Previous question")).toBeVisible();
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
  await expect(dialog).toHaveAttribute("data-state", "closed");
});

test("repairs unfinished Markdown while an assistant response streams", async ({ page }) => {
  await page.addInitScript(() => {
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
        setTimeout(() => {
          this.onmessage?.({ data: JSON.stringify({
            type: "generation_started",
            generationId: "g1",
          }) });
          this.onmessage?.({ data: JSON.stringify({
            type: "message_start",
            generationId: "g1",
            message: { role: "assistant" },
          }) });
          this.onmessage?.({ data: JSON.stringify({
            type: "assistant_stream_delta",
            generationId: "g1",
            delta: "## Live response\n\n",
          }) });
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({
            type: "assistant_stream_delta",
            generationId: "g1",
            delta: "**still streaming**\n\n",
          }) }), 150);
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({
            type: "assistant_stream_delta",
            generationId: "g1",
            delta: "```javascript\nconst answer = 42;\n```\n\n",
          }) }), 300);
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({
            type: "assistant_stream_delta",
            generationId: "g1",
            delta: "$$\nE = mc^2\n$$",
          }) }), 450);
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({
            type: "assistant_stream_delta",
            generationId: "g1",
            delta: "\n\n- first item\n\n  continued first item\n\n- second item",
          }) }), 550);
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({
            type: "assistant_stream_final",
            generationId: "g1",
            content: "## Live response\n\n**still streaming**\n\n```javascript\nconst answer = 42;\n```\n\n$$\nE = mc^2\n$$\n\n- first item\n\n  continued first item\n\n- second item",
            html: '<div class="server-markdown">Bogus legacy HTML</div>',
          }) }), 800);
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({
            type: "agent_end",
            generationId: "g1",
            willRetry: false,
          }) }), 900);
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({
            type: "session_checkpoint",
            chat: { id: "550e8400-e29b-41d4-a716-446655440099" },
          }) }), 1100);
        }, 0);
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: MockWebSocket,
    });
  });
  const streamedContent = "## Live response\n\n**still streaming**\n\n```javascript\nconst answer = 42;\n```\n\n$$\nE = mc^2\n$$\n\n- first item\n\n  continued first item\n\n- second item";
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
  await expect(page.locator(".chat-markdown li")).toHaveCount(2);
  await expect(page.locator(".chat-markdown li").first()).toContainText("continued first item");
  await expect(page.locator("[data-stable-stream-node]")).toHaveCount(1);
  expect(await liveHeadingNode.evaluate((node) => node.isConnected && node === document.querySelector("[data-stable-stream-node]"))).toBe(true);
  await expect(page.getByRole("button", { name: "Copy Markdown" })).toBeVisible();
  await expect(page.locator(".chat-markdown[data-before-final]")).toHaveCount(1);
  expect(await liveMarkdownNode.evaluate((node) => node.isConnected && node === document.querySelector(".chat-markdown"))).toBe(true);
  await expect(page.locator(".server-markdown")).toHaveCount(0);
  await expect(page.locator('[data-language="javascript"]')).toBeVisible();
  await expect(page.locator(".katex-display")).toBeVisible();

  // The durable checkpoint reload must reconcile in place: the tagged DOM node
  // survives (no remount), and the welcome screen never flashes.
  await checkpointReload;
  await expect(page.locator(".chat-markdown[data-before-final]")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "How can I help you today?" })).toHaveCount(0);
  expect(await liveMarkdownNode.evaluate((node) => node.isConnected && node === document.querySelector(".chat-markdown"))).toBe(true);
  expect(await liveHeadingNode.evaluate((node) => node.isConnected && node === document.querySelector("[data-stable-stream-node]"))).toBe(true);
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
    handler({ data: JSON.stringify({ type: "generation_started", generationId: "stale-generation" }) });
    handler({ data: JSON.stringify({ type: "message_start", generationId: "stale-generation", message: { role: "assistant" } }) });
    handler({ data: JSON.stringify({ type: "assistant_stream_delta", generationId: "stale-generation", delta: "STALE OUTPUT" }) });
  });
  await expect(page.getByText("STALE OUTPUT")).toHaveCount(0);
  await expect(page.getByText("Second body")).toBeVisible();
});

test("opens a viewport-filling thread pinned to the true bottom without an upward flash", async ({ page }, testInfo) => {
  const paragraph = (n) => `Paragraph ${n} carries enough words to wrap across more than one line of the transcript column so the assistant answer grows well beyond ten rem in height.`;
  const tallBody = Array.from({ length: 24 }, (_, index) => paragraph(index + 1)).join("\n\n");
  await page.route("**/v0/projects", async (route) => {
    await route.fulfill({ json: { projects: [{
      id: "project_chat", slug: "chat", name: "Chats",
      sessions: [
        { id: "session_small", projectId: "project_chat", status: "active", title: "Small chat" },
        { id: "session_tall", projectId: "project_chat", status: "active", title: "Tall chat" },
      ],
    }, projects[1]] } });
  });
  await page.route("**/v0/sessions/session_small", async (route) => {
    await route.fulfill({ json: {
      id: "session_small", projectId: "project_chat", status: "active", title: "Small chat",
      messages: [
        { id: "small-user", role: "user", content: "Hi" },
        { id: "small-assistant", role: "assistant", content: "**Hello there**" },
      ], tools: [], page: { before: null },
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
  await page.goto("/");
  await openSidebar(page, testInfo);
  // Open a small thread first so the lazy chat-markdown chunk is already resolved
  // and the tall thread renders its real heights synchronously on mount.
  await page.getByRole("button", { name: "Small chat" }).click();
  await expect(page.getByText("Hello there")).toBeVisible();

  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "Tall chat" }).click();
  // Sample the viewport every frame across the mount + settle window so a buggy
  // pre-paint scroll (last message snapping down from its top) is captured as a
  // frame far from the bottom. Bounded loop: no lingering background work.
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

  // The usage-site override must win the tailwind-merge dedupe, so items lay out
  // at real height (not a content-visibility placeholder) during pre-paint scroll.
  const contentVisibility = await page.locator('[data-slot="message-scroller-item"]').first()
    .evaluate((element) => getComputedStyle(element).contentVisibility);
  expect(contentVisibility).toBe("visible");

  const tall = samples.filter((sample) => sample.height - sample.client > 200);
  expect(tall.length).toBeGreaterThan(0);
  const worstDistanceFromBottom = Math.max(...tall.map((sample) => sample.height - sample.client - sample.top));
  expect(worstDistanceFromBottom).toBeLessThanOrEqual(32);
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
  await page.getByRole("menuitemradio", { name: "Research" }).click();
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

test("uses the sidebar-08 groups and native icon collapse", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.goto("/");

  const sidebar = page.locator('[data-slot="sidebar"][data-state]');
  const main = page.locator('[data-slot="sidebar-inset"]');
  const mainBox = await main.boundingBox();

  await expect(page.locator('[data-sidebar="header"]').getByRole("button", { name: "Conduit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New folder" })).toBeVisible();
  await expect(page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit/ })).toBeVisible();
  await expect(page.locator('[data-sidebar="footer"]')).toContainText(/Server connected|Connecting|Reconnecting|unavailable/);
  await expect(page.locator('[data-sidebar="group-label"]')).toHaveText(["Chats", "Projects", "Workspaces"]);
  await expect(page.locator('[data-sidebar="group-label"]').first()).toHaveCSS("font-size", "13px");
  await expect(page.getByRole("button", { name: "Existing chat" })).toHaveCSS("font-size", "15px");
  await expect(page.locator('[data-sidebar="header"] span', { hasText: "Conduit" })).toHaveCSS("font-size", "24px");
  await expect(page.locator('[data-sidebar="header"] svg')).toHaveCSS("width", "24px");

  await expect(page.getByRole("button", { name: "Existing chat" })).toBeVisible();
  await expect(page.locator('[data-sidebar="rail"]')).toHaveCount(1);

  const [expandedSidebarBox, expandedTriggerBox] = await Promise.all([
    page.locator('[data-slot="sidebar-container"]').boundingBox(),
    page.locator('[data-sidebar="trigger"]:visible').boundingBox(),
  ]);
  expect(expandedTriggerBox.x).toBeGreaterThanOrEqual(expandedSidebarBox.x + expandedSidebarBox.width);

  await page.locator('[data-sidebar="trigger"]:visible').click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect.poll(async () => (await main.boundingBox()).x).toBeLessThan(mainBox.x);
  await expect(page.locator('[data-sidebar="header"] span', { hasText: "Conduit" })).toBeHidden();

  const [collapsedSidebarBox, collapsedTriggerBox] = await Promise.all([
    page.locator('[data-slot="sidebar-container"]').boundingBox(),
    page.locator('[data-sidebar="trigger"]:visible').boundingBox(),
  ]);
  expect(collapsedTriggerBox.x).toBeGreaterThanOrEqual(collapsedSidebarBox.x + collapsedSidebarBox.width);

  await page.locator('[data-sidebar="trigger"]:visible').click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await expect.poll(async () => (await main.boundingBox()).x).toBe(mainBox.x);
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
  await expect(page.locator('[data-sidebar="group-label"]')).toHaveText(["Chats", "Projects", "Workspaces"]);
  await expect(page.getByRole("button", { name: "JaskFish" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New workspace" })).toBeVisible();
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
  await settings.getByRole("combobox", { name: "Default profile" }).click();
  await expect(page.getByRole("option", { name: "Inherit global (General)" })).toBeVisible();
  const updateRequest = page.waitForRequest((request) => request.url().endsWith("/v0/projects/project_workspace")
    && request.method() === "PATCH");
  await page.getByRole("option", { name: "Coding" }).click();
  expect((await updateRequest).postDataJSON()).toEqual({ defaultTemplateId: "workspace" });
  await expect(settings.getByText("Override: Coding")).toBeVisible();
  await settings.getByRole("combobox", { name: "Default profile" }).click();
  const hostRequest = page.waitForRequest((request) => request.url().endsWith("/v0/projects/project_workspace")
    && request.method() === "PATCH" && request.postDataJSON()?.defaultTemplateId === "host-pi");
  await page.getByRole("option", { name: "Host Pi" }).click();
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
      runtime: { kind: body.runtimeKind, installationId: "conduit-pinned", binaryVersion: "0.80.6", profileId: body.templateId },
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
  await expect(page.getByRole("button", { name: "Profile General" })).toBeVisible();
  await page.getByRole("button", { name: "Profile General" }).click();
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
  await expect(page.getByRole("button", { name: "Profile General" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toHaveValue("");
});

test("clone workspace requires a repository and absolute target location", async ({ page }, testInfo) => {
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: {
        id: "project_clone",
        slug: "cloned-repo",
        name: body.name || "cloned-repo",
        kind: "workspace",
        origin: "cloned",
        externalPath: body.path,
        path: body.path,
        defaultTemplateId: null,
        deletesFilesOnRemove: false,
        sessions: [],
      } });
      return;
    }
    await route.fulfill({ json: { projects } });
  });
  await page.goto("/");
  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "New workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "New workspace" });
  await dialog.locator("#folder-mode").selectOption("cloned");
  await expect(dialog.getByLabel("Clone location")).toBeVisible();
  await dialog.getByLabel("Git URL").fill("https://github.com/example/repo.git");
  await expect(dialog.getByRole("button", { name: "Clone workspace" })).toBeDisabled();
  await dialog.getByLabel("Clone location").fill("/home/user/code/repo");
  const requestPromise = page.waitForRequest((request) => request.url().endsWith("/v0/projects") && request.method() === "POST");
  await dialog.getByRole("button", { name: "Clone workspace" }).click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({
    mode: "cloned",
    cloneUrl: "https://github.com/example/repo.git",
    path: "/home/user/code/repo",
  });
});

test("sizes the meteor field with the chat viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.goto("/");

  const main = page.locator('[data-slot="sidebar-inset"]');
  const meteorField = page.locator(".chat-meteors");
  const meteor = meteorField.locator(":scope > span").first();
  const meteors = meteorField.locator(":scope > span");
  await expect(meteors).toHaveCount(30);

  const [initialMain, initialField, initialLeft, delays, durations] = await Promise.all([
    main.boundingBox(),
    meteorField.boundingBox(),
    meteor.evaluate((element) => element.style.left),
    meteors.evaluateAll((elements) => elements.map((element) => Number.parseFloat(element.style.animationDelay))),
    meteors.evaluateAll((elements) => elements.map((element) => Number.parseFloat(element.style.animationDuration))),
  ]);
  expect(initialField).toEqual(initialMain);
  expect(initialLeft.includes("dvh")).toBe(true);
  expect(delays.some((delay) => delay < 0)).toBe(true);
  expect(new Set(delays).size).toBeGreaterThan(20);
  expect(Math.min(...durations)).toBeGreaterThanOrEqual(12);
  expect(Math.max(...durations)).toBeLessThanOrEqual(20);

  await page.setViewportSize({ width: 1600, height: 900 });
  const [resizedMain, resizedField] = await Promise.all([
    main.boundingBox(),
    meteorField.boundingBox(),
  ]);
  expect(resizedField).toEqual(resizedMain);
  expect(resizedField.width).toBeGreaterThan(initialField.width);
  expect(resizedField.height).toBeGreaterThan(initialField.height);
});

test("composer model picker exposes model and thinking selectors", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Reasoner medium/ }).click();
  await expect(page.getByText("Model", { exact: true })).toBeVisible();
  await expect(page.getByText("Thinking", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Reasoner example" })).toBeChecked();
  await expect(page.getByRole("menuitemradio", { name: "High" })).toBeVisible();
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
  expect(uploads.map((item) => item.name)).toEqual([
    "draft-complete.png",
    "draft-pending-a.png",
    "draft-pending-b.png",
    "draft-pending-c.png",
  ]);
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
          this.onmessage?.({ data: JSON.stringify({ type: "generation_started", generationId: "g1" }) });
          this.onmessage?.({ data: JSON.stringify({ type: "message_start", generationId: "g1", message: { role: "assistant" } }) });
          this.onmessage?.({ data: JSON.stringify({ type: "assistant_stream_delta", generationId: "g1", delta: "Visible partial" }) });
        });
        if (command.type === "stop_generation") {
          window.__stopCommand = command;
          this.onmessage?.({ data: JSON.stringify({ type: "assistant_stream_delta", generationId: "g1", delta: "LATE OUTPUT" }) });
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "generation_stopped", generationId: "g1", status: "stopped", processTerminated: false }) }), 150);
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

test("global commands and slash suggestions preserve their intended focus models", async ({ page }) => {
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
  await expect(palette.getByRole("group", { name: "Commands" })).toBeVisible();
  await expect(palette.getByRole("option", { name: /Settings…/ })).toBeVisible();
  await expect(palette.getByRole("option", { name: /Go to…/ })).toBeVisible();
  await expect(palette.getByRole("option", { name: /^Runtime$/ })).toHaveCount(0);
  await palette.getByRole("option", { name: /Settings…/ }).click();
  await expect(palette.locator("[data-slot='command-input-prefix']")).toHaveText("Settings ›");
  await expect(palette.getByRole("option", { name: /^Back$/ })).toBeVisible();
  await expect(palette.getByRole("option", { name: /^Runtime$/ })).toBeVisible();
  await expect(palette.getByRole("option", { name: /^Workspaces$/ })).toBeVisible();
  await palette.getByRole("combobox").fill("work");
  await expect(palette.getByRole("option", { name: /^Workspaces$/ })).toHaveAttribute("data-selected", "true");
  await palette.getByRole("combobox").fill("");
  await palette.getByRole("option", { name: /^Runtime$/ }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: /Runtime/ })).toHaveAttribute("aria-selected", "true");
  await expect(settingsDialog.getByRole("heading", { name: "Runtime" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await palette.getByPlaceholder("Search commands…").fill("runtime");
  await expect(palette.getByRole("option", { name: /^Runtime$/ })).toHaveCount(0);
  await palette.getByPlaceholder("Search commands…").fill("settings");
  await palette.getByRole("option", { name: /Settings…/ }).click();
  await expect(palette.locator("[data-slot='command-input-prefix']")).toHaveText("Settings ›");
  await palette.getByRole("option", { name: /^Runtime$/ }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await palette.getByPlaceholder("Search commands…").fill("new folder");
  await palette.getByRole("option", { name: /^New folder/ }).click();
  await expect(page.getByRole("dialog", { name: "New folder" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await palette.getByPlaceholder("Search commands…").fill("example plain");
  await expect(palette.getByRole("group", { name: "Models" })).toBeVisible();
  await expect(palette.getByRole("option", { name: /Plain/ })).toBeVisible();
  const settingsRequest = page.waitForRequest((request) => /\/v0\/chats\/[^/]+\/models$/.test(new URL(request.url()).pathname)
    && request.method() === "PATCH");
  await palette.getByRole("option", { name: /Plain/ }).click();
  await settingsRequest;

  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Search commands…").fill("delete chat");
  await page.getByRole("option", { name: /Delete chat/ }).click();
  await expect(page.getByRole("alertdialog", { name: "Delete this chat?" })).toBeVisible();
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
  await expect.poll(() => page.evaluate(() => window.__commands?.find((command) => command.type === "regenerate"))).toEqual({ type: "regenerate", entryId: "entry-user" });
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
    { id: "conduit-pinned", label: "Isolated Pi", version: "0.80.6", available: true },
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
