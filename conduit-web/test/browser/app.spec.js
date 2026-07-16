import { expect, test } from "@playwright/test";

const projects = [{
  id: "project_chat",
  slug: "chat",
  name: "Chats",
  sessions: [{ id: "session_existing", title: "Existing chat" }],
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

async function openSidebar(page, testInfo) {
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  }
}

test.beforeEach(async ({ page }) => {
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
    await route.fulfill({ json: { models: [model], enabledModels: [model.spec] } });
  });
  await page.route("**/v0/settings", async (route) => {
    await route.fulfill({ json: { models: [model], enabledModels: [model.spec] } });
  });
  await page.route("**/v0/sessions/session_existing", async (route) => {
    await route.fulfill({ json: {
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
  await page.route("**/v0/sessions/session_existing/duplicate", async (route) => {
    await route.fulfill({ status: 201, json: { id: "session_duplicate", title: "Existing chat copy" } });
  });
  await page.route("**/v0/sessions/session_existing/move", async (route) => {
    await route.fulfill({ json: { id: "session_moved", title: "Existing chat", projectId: "project_research" } });
  });
  await page.route("**/v0/projects/project_research", async (route) => {
    await route.fulfill({ json: { ...projects[1], name: route.request().postDataJSON()?.name || projects[1].name } });
  });
  await page.route("**/v0/projects/project_research/open", async (route) => {
    await route.fulfill({ status: 202, json: { opened: true, path: "/tmp/research" } });
  });
  await page.route("**/v0/projects/project_research/move-sessions", async (route) => {
    await route.fulfill({ json: { moved: [] } });
  });
  await page.route("**/v0/live-sessions", async (route) => {
    await route.fulfill({ json: { id: "live_existing", streamUrl: "/v0/live-sessions/live_existing/stream" } });
  });
});

test("renders the primary chat surface", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "How can I help you today?" })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message Pi" });
  await expect(composer).toHaveAttribute("placeholder", "Send a message...");
  await expect(composer).toHaveJSProperty("tagName", "INPUT");

  const composerGroup = page.locator(".composer");
  const sendButton = page.getByRole("button", { name: "Send message" });
  const [groupBox, inputBox, sendBox] = await Promise.all([
    composerGroup.boundingBox(),
    composer.boundingBox(),
    sendButton.boundingBox(),
  ]);
  expect(groupBox.height).toBe(44);
  expect(Math.abs(inputBox.y + inputBox.height / 2 - sendBox.y - sendBox.height / 2)).toBeLessThanOrEqual(1);
  await expect(composerGroup).toHaveCSS("opacity", "1");
  await expect(page.getByRole("button", { name: "Voice input" })).toHaveCount(0);
  await expect(sendButton).toHaveAttribute("aria-disabled", "true");
  await expect(sendButton).toHaveAttribute("data-variant", "default");
  await composer.fill("Hello");
  await expect(sendButton).toHaveAttribute("aria-disabled", "false");
  await expect(sendButton).toHaveAttribute("data-variant", "default");
});

test("opens and dismisses the new folder dialog", async ({ page }, testInfo) => {
  await page.goto("/");

  await openSidebar(page, testInfo);
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create folder" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("keeps the thread composer on one line", async ({ page }, testInfo) => {
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
  expect(groupBox.height).toBe(44);
  expect(Math.abs(inputBox.y + inputBox.height / 2 - sendBox.y - sendBox.height / 2)).toBeLessThanOrEqual(1);
  await expect(composerWrap).toHaveCSS("position", "static");
  await expect(page.locator(".chat-meteors")).toBeVisible();
});

test("renders persisted assistant Markdown with safe interactive controls", async ({ page }, testInfo) => {
  const markdown = [
    "## Markdown sample",
    "",
    "This is **strong**, *emphasized*, and `inline code`.",
    "Inline math: $$E = mc^2$$.",
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
  await expect(page.locator('[data-streamdown="strong"]')).toHaveText("strong");
  await expect(page.locator('[data-streamdown="unordered-list"] li')).toHaveCount(2);
  await expect(page.locator('[data-streamdown="blockquote"]')).toContainText("useful quotation");
  await expect(page.locator('[data-streamdown="table"]')).toContainText("Tables");
  await expect(page.locator('[data-streamdown="inline-code"]')).toHaveText("inline code");
  await expect(page.locator(".katex")).toHaveCount(2);
  await expect(page.locator(".katex-display")).toHaveCount(1);
  await expect(page.locator('[data-streamdown="code-block-copy-button"]')).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.getByText("Tracking image", { exact: true })).toBeVisible();
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator('a[href^="irc:"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__markdownXss)).toBeUndefined();

  await page.getByRole("button", { name: "External documentation" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Open external link?" });
  await expect(dialog).toContainText("https://example.com/docs");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
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
            type: "message_start",
            message: { role: "assistant" },
          }) });
          this.onmessage?.({ data: JSON.stringify({
            type: "assistant_stream_block",
            block: 0,
            content: "## Live response\n\n",
            html: "<h2>Live response</h2>",
            tail: "**still streaming",
          }) });
          this.onmessage?.({ data: JSON.stringify({
            type: "assistant_stream_tail",
            content: "**still streaming",
          }) });
        }, 0);
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: MockWebSocket,
    });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Message Pi" }).fill("Start streaming");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("heading", { name: "Live response" })).toBeVisible();
  await expect(page.locator('[data-streamdown="strong"]')).toHaveText("still streaming");
  await expect(page.locator(".chat-markdown")).toContainText("still streaming");
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
    "Duplicate",
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
  const duplicateRequest = page.waitForRequest((request) => request.url().endsWith("/v0/sessions/session_existing/duplicate"));
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await duplicateRequest;

  await page.getByRole("button", { name: "Existing chat" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy transcript" }).click();
  await expect.poll(() => page.evaluate(() => window.__copiedTranscript)).toBe("## User\n\nPrevious question");

  await page.getByRole("button", { name: "Research" }).click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText([
    "New chat",
    "Rename folder",
    "Open working directory",
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
  await expect(page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit Local workspace/ })).toBeVisible();
  await expect(page.locator('[data-sidebar="group-label"]')).toHaveText(["Chats", "Projects"]);
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

test("model picker exposes model and thinking selectors", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Reasoner medium/ }).click();
  await expect(page.getByText("Model", { exact: true })).toBeVisible();
  await expect(page.getByText("Thinking", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Reasoner example" })).toBeChecked();
  await expect(page.getByRole("menuitemradio", { name: "Pi default" })).toHaveCount(0);
  await expect(page.getByRole("menuitemradio", { name: "High" })).toBeVisible();
});

test("persists a selected model as Pi's next-chat default", async ({ page }) => {
  const settingsRequest = page.waitForRequest((request) =>
    request.url().endsWith("/v0/settings") && request.method() === "PATCH");
  await page.goto("/");

  await page.getByRole("button", { name: /Reasoner medium/ }).click();
  await page.getByRole("menuitemradio", { name: "Plain example" }).click();

  const request = await settingsRequest;
  expect(request.postDataJSON()).toEqual({
    projectId: "project_chat",
    enabledModels: ["example/reasoner", "example/plain"],
    defaultModel: "example/plain",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Plain off/ })).toBeVisible();
});

test("opens model scope settings from the sidebar", async ({ page }, testInfo) => {
  await page.goto("/");
  await openSidebar(page, testInfo);

  await page.locator('[data-sidebar="footer"]').getByRole("button", { name: /Conduit Local workspace/ }).click();
  await page.getByRole("menuitem", { name: "Manage settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Scoped models")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Reasoner/ })).toBeChecked();
});
