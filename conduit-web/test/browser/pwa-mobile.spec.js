import { expect, test } from "@playwright/test";

/**
 * Issue #27 acceptance harness — mobile chrome + palette entry paths.
 * Desktop project runs only the cases that assert desktop is unchanged.
 */

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

const templates = [{
  id: "chat",
  label: "Assistant",
  version: 5,
  defaultable: true,
  tools: ["read", "write", "edit", "bash", "web_search", "fetch_content", "get_search_content", "source_check"],
}];

const newChatId = "550e8400-e29b-41d4-a716-446655440099";

async function openApp(page) {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toBeVisible();
}

async function openSidebar(page, testInfo) {
  if (testInfo.project.name === "mobile-chromium") {
    await page.locator(".mobile-sidebar-trigger").click();
  }
}

async function sampleTranslateX(page, selector, count = 8) {
  return page.evaluate(({ selector: targetSelector, count: frameCount }) => new Promise((resolve, reject) => {
    const target = document.querySelector(targetSelector);
    if (!target) {
      reject(new Error(`Missing mobile motion target: ${targetSelector}`));
      return;
    }
    const samples = [];
    const sample = () => {
      const transform = getComputedStyle(target).transform;
      samples.push(transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41);
      if (samples.length === frameCount) resolve(samples);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), { selector, count });
}

async function expectInsetPalette(page, palette, inset = 8) {
  const [shellBox, viewport] = await Promise.all([
    palette.locator(".command-shell").boundingBox(),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  ]);
  expect(Math.abs(shellBox.x - inset)).toBeLessThanOrEqual(2);
  expect(Math.abs(shellBox.y - inset)).toBeLessThanOrEqual(2);
  expect(Math.abs(shellBox.width - (viewport.width - inset * 2))).toBeLessThanOrEqual(2);
  expect(Math.abs(shellBox.height - (viewport.height - inset * 2))).toBeLessThanOrEqual(2);
}

test("acceptance: mobile chat shell fills the visual viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "phone shell geometry");
  await openApp(page);

  const shell = page.locator("main.chat-main");
  const transcript = page.locator(".message-scroller-viewport");
  const composer = page.locator(".composer-stack");
  const [shellBox, transcriptBox, composerBox, viewport, styles] = await Promise.all([
    shell.boundingBox(),
    transcript.boundingBox(),
    composer.boundingBox(),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight, visualWidth: visualViewport?.width, visualHeight: visualViewport?.height })),
    shell.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { margin: computed.margin, borderRadius: computed.borderRadius, boxShadow: computed.boxShadow };
    }),
  ]);

  expect(Math.abs(shellBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(shellBox.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(shellBox.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(shellBox.height - viewport.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(shellBox.width - viewport.visualWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(shellBox.height - viewport.visualHeight)).toBeLessThanOrEqual(1);
  expect(styles).toEqual({ margin: "0px", borderRadius: "0px", boxShadow: "none" });

  expect(transcriptBox.y).toBeGreaterThanOrEqual(shellBox.y - 1);
  expect(transcriptBox.y + transcriptBox.height).toBeLessThanOrEqual(composerBox.y + 1);
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(shellBox.y + shellBox.height + 1);
});

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
      constructor(url) {
        super();
        this.url = url;
        this.readyState = 0;
        this.onerror = null;
        this.onmessage = null;
        queueMicrotask(() => {
          if (this.readyState === 2) return;
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          const payload = { data: JSON.stringify({ type: "runtime_global_snapshot", processes: [], at: new Date().toISOString() }) };
          this.onmessage?.(payload);
          this.dispatchEvent(new MessageEvent("message", payload));
        });
      }
      close() { this.readyState = 2; }
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: MockEventSource });
  });

  await page.route("**/v0/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/v0/templates", (route) => route.fulfill({ json: { templates, defaultTemplateId: "chat" } }));
  await page.route("**/v0/workspaces/suggestions", (route) => route.fulfill({ json: {
    root: "/home/user", allowlist: ["/home/user"], defaultRoot: "/home/user", defaultInputPath: "~",
    suggestionRoot: "/home/user", modes: ["managed", "linked", "created", "cloned"], folders: [],
  } }));
  await page.route("**/v0/capabilities", (route) => route.fulfill({ json: { partialContinue: true } }));
  await page.route("**/v0/pi-installations", (route) => route.fulfill({ json: { installations: [] } }));
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects } }));
  await page.route("**/v0/models?**", (route) => route.fulfill({
    json: { models: [model], defaultModel: model.spec, defaultThinkingLevel: "medium", requiresAuthentication: false },
  }));
  await page.route("**/v0/chats/*/models", (route) => route.fulfill({
    json: {
      installationId: "conduit-pinned",
      runtimeKind: "conduit_profile",
      models: [model],
      model: model.spec,
      thinkingLevel: "medium",
      defaultModel: model.spec,
      defaultThinkingLevel: "medium",
      requiresAuthentication: false,
    },
  }));
  await page.route("**/v0/chats/*/attachments", (route) => route.fulfill({ json: { attachments: [] } }));
  await page.route("**/v0/chats", (route) => route.fulfill({
    status: 201,
    json: { id: newChatId, projectId: "project_chat", status: "draft", title: "New chat" },
  }));
  await page.route(`**/v0/chats/${newChatId}`, (route) => route.fulfill({
    json: { id: newChatId, projectId: "project_chat", status: "draft", title: "New chat" },
  }));
  await page.route(`**/v0/sessions/${newChatId}`, (route) => route.fulfill({
    json: { id: newChatId, projectId: "project_chat", status: "draft", title: "New chat", messages: [], tools: [], page: { before: null } },
  }));
  await page.route("**/v0/sessions/session_existing", (route) => route.fulfill({
    json: {
      id: "session_existing",
      projectId: "project_chat",
      status: "active",
      title: "Existing chat",
      messages: [{ id: "u1", role: "user", content: "Hello" }],
      tools: [],
      page: { before: null },
    },
  }));
  await page.route("**/v0/projects/*/tree?*", (route) => route.fulfill({
    json: { path: "", entries: [{ name: "README.md", path: "README.md", type: "file" }] },
  }));
  await page.route("**/v0/projects/*/diff*", (route) => route.fulfill({
    json: { repository: true, branch: "main", files: [], commits: [], diff: "" },
  }));
});

test("acceptance: header launchers distinguish chat search from the command palette", async ({ page }, testInfo) => {
  await openApp(page);
  const searchTrigger = page.locator(".search-trigger");
  const paletteTrigger = page.locator(".palette-trigger");
  await expect(searchTrigger).toBeVisible();
  await expect(paletteTrigger).toBeVisible();
  await expect(searchTrigger.locator("svg.lucide-search")).toBeVisible();
  await expect(paletteTrigger.locator("svg.lucide-terminal")).toBeVisible();

  await searchTrigger.click();
  let palette = page.getByRole("dialog", { name: "Command Palette" });
  await expect(palette.getByText("Search ›")).toBeVisible();
  await palette.getByRole("button", { name: "Close command palette" }).click();
  await expect(palette).toHaveCount(0);

  await paletteTrigger.click();
  palette = page.getByRole("dialog", { name: "Command Palette" });
  await expect(palette).toBeVisible();
  await expect(palette.getByText("Search ›")).toHaveCount(0);
  const hints = palette.getByRole("note", { name: "Keyboard shortcuts" });
  await expect(hints).toBeVisible();
  if (testInfo.project.name === "mobile-chromium" || (page.viewportSize()?.width || 0) <= 520) {
    await expect(hints.getByText("More shortcuts", { exact: true })).toBeVisible();
  }
  const shell = palette.locator(".command-shell");
  const [shellBox, viewport] = await Promise.all([
    shell.boundingBox(),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  ]);
  if (testInfo.project.name === "mobile-chromium" || viewport.width <= 760) {
    await expectInsetPalette(page, palette);
  } else {
    expect(Math.abs(shellBox.x + shellBox.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(shellBox.y + shellBox.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
  }
  await palette.getByRole("button", { name: "Close command palette" }).click();
  await expect(palette).toHaveCount(0);
});

test("acceptance: tall narrow command and chat palettes fill the inset mobile frame", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "exact 523px responsive boundary");
  await page.setViewportSize({ width: 523, height: 1100 });
  await openApp(page);
  await page.locator(".palette-trigger").click();
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await expectInsetPalette(page, palette);
  await palette.getByRole("option", { name: /^Search chats/ }).click();
  await expect(palette.getByText("Search ›")).toBeVisible();
  await expectInsetPalette(page, palette);
});

test("acceptance: mobile chat edit footer stays bounded and supports touch actions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "touch palette actions");
  await openApp(page);
  await page.locator(".palette-trigger").tap();
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await palette.getByRole("option", { name: /^Search chats/ }).tap();

  const hints = palette.getByRole("note", { name: "Keyboard shortcuts" });
  await hints.getByRole("button", { name: /Edit chats/ }).tap();
  await expect(palette.getByText("1 selected")).toBeVisible();
  const done = hints.getByRole("button", { name: /Done/ });
  const remove = hints.getByRole("button", { name: /Delete/ });
  const move = hints.getByRole("button", { name: /Move/ });
  await expect(done).toBeVisible();
  await expect(remove).toBeVisible();
  await expect(move).toBeVisible();

  const footerSize = await hints.evaluate((footer) => ({
    clientWidth: footer.clientWidth,
    scrollWidth: footer.scrollWidth,
  }));
  expect(footerSize.scrollWidth).toBeLessThanOrEqual(footerSize.clientWidth + 1);
  const viewport = page.viewportSize();
  for (const action of [done, remove, move]) {
    const box = await action.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  }

  await remove.tap();
  const confirmation = page.getByRole("alertdialog", { name: "Delete 1 chats?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).tap();
  await expect(palette.getByText("1 selected")).toBeVisible();

  await move.tap();
  await expect(hints).toContainText("Back");
  await palette.getByRole("option", { name: /^Research/ }).tap();
  await expect(palette).toHaveCount(0);
});

test("acceptance: mobile sidebar is a full-bleed exclusive overlay", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "phone overlay chrome");
  await openApp(page);
  await page.locator(".mobile-sidebar-trigger").click();
  const sidebar = page.locator(".conduit-sidebar");
  const opening = await sampleTranslateX(page, ".conduit-sidebar");
  await expect(sidebar).toHaveAttribute("data-mobile-open", "true");
  await expect(page.locator("html")).toHaveAttribute("data-mobile-overlay", "sidebar");
  const box = await sidebar.boundingBox();
  expect(Math.abs(box.width - page.viewportSize().width)).toBeLessThanOrEqual(2);
  expect(new Set(opening.map((value) => Math.round(value))).size).toBeGreaterThan(2);
  expect(opening.every((value, index) => index === 0 || value >= opening[index - 1] - 0.5)).toBe(true);
  await sidebar.locator('[data-sidebar="trigger"]').click();
  const closing = await sampleTranslateX(page, ".conduit-sidebar");
  await expect(sidebar).toHaveAttribute("data-mobile-open", "false");
  await expect(page.locator("html")).not.toHaveAttribute("data-mobile-overlay", "sidebar");
  expect(new Set(closing.map((value) => Math.round(value))).size).toBeGreaterThan(2);
  expect(closing.every((value, index) => index === 0 || value <= closing[index - 1] + 0.5)).toBe(true);
});

test("acceptance: mobile workspace is full-bleed and closes via panel X only", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "phone overlay chrome");
  await openApp(page);
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  const opening = await sampleTranslateX(page, ".workspace-panel");
  await expect(panel).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-mobile-overlay", "workspace");
  const box = await panel.boundingBox();
  expect(Math.abs(box.width - page.viewportSize().width)).toBeLessThanOrEqual(2);
  expect(new Set(opening.map((value) => Math.round(value))).size).toBeGreaterThan(2);
  expect(opening.every((value, index) => index === 0 || value <= opening[index - 1] + 0.5)).toBe(true);
  await expect(page.getByRole("button", { name: "Toggle workspace panel" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close workspace panel" }).click();
  const closing = await sampleTranslateX(page, ".workspace-panel");
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Toggle workspace panel" })).toBeVisible();
  expect(new Set(closing.map((value) => Math.round(value))).size).toBeGreaterThan(2);
  expect(closing.every((value, index) => index === 0 || value >= closing[index - 1] - 0.5)).toBe(true);
});

test("acceptance: long-press sidebar chat opens a viewport-bounded menu without navigating", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "touch long-press");
  await openApp(page);
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

test("acceptance: desktop keeps a docked sidebar and resizable workspace panel", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  await openApp(page);
  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await expect(sidebar).not.toHaveCSS("position", "fixed");
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("separator", { name: "Resize workspace panel" })).toBeVisible();
  // Backdrop nodes may exist for the open panel but stay CSS-hidden on desktop.
  await expect(page.locator('[data-mobile-backdrop]:visible')).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-mobile-overlay");
});
