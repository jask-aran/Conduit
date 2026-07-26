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
  label: "General",
  version: 1,
  defaultable: true,
  tools: ["read", "write", "edit", "bash"],
}];

const newChatId = "550e8400-e29b-41d4-a716-446655440099";

async function openSidebar(page, testInfo) {
  if (testInfo.project.name === "mobile-chromium") {
    await page.locator(".mobile-sidebar-trigger").click();
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
  await page.route("**/v0/workspaces/suggestions", (route) => route.fulfill({ json: { folders: [] } }));
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

test("acceptance: header search opens palette; close control dismisses without a selection", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator(".palette-trigger")).toBeVisible();
  await page.locator(".palette-trigger").click();
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await expect(palette).toBeVisible();
  const shell = palette.locator(".command-shell");
  const [shellBox, viewport] = await Promise.all([
    shell.boundingBox(),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  ]);
  if (testInfo.project.name === "mobile-chromium" || viewport.width <= 480) {
    expect(shellBox.x).toBeLessThanOrEqual(2);
    expect(shellBox.y).toBeLessThanOrEqual(2);
    expect(Math.abs(shellBox.width - viewport.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(shellBox.height - viewport.height)).toBeLessThanOrEqual(2);
  } else {
    expect(Math.abs(shellBox.x + shellBox.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(shellBox.y + shellBox.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
  }
  await palette.getByRole("button", { name: "Close command palette" }).click();
  await expect(palette).toHaveCount(0);
});

test("acceptance: mobile sidebar is a full-bleed exclusive overlay", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "phone overlay chrome");
  await page.goto("/");
  await page.locator(".mobile-sidebar-trigger").click();
  const sidebar = page.locator(".conduit-sidebar");
  await expect(sidebar).toHaveAttribute("data-mobile-open", "true");
  await expect(page.locator("html")).toHaveAttribute("data-mobile-overlay", "sidebar");
  const box = await sidebar.boundingBox();
  expect(Math.abs(box.width - page.viewportSize().width)).toBeLessThanOrEqual(2);
  await sidebar.locator('[data-sidebar="trigger"]').click();
  await expect(sidebar).toHaveAttribute("data-mobile-open", "false");
  await expect(page.locator("html")).not.toHaveAttribute("data-mobile-overlay", "sidebar");
});

test("acceptance: mobile workspace is full-bleed and closes via panel X only", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "phone overlay chrome");
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle workspace panel" }).click();
  const panel = page.getByRole("complementary", { name: "Workspace panel" });
  await expect(panel).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-mobile-overlay", "workspace");
  const box = await panel.boundingBox();
  expect(Math.abs(box.width - page.viewportSize().width)).toBeLessThanOrEqual(2);
  await expect(page.getByRole("button", { name: "Toggle workspace panel" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close workspace panel" }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Toggle workspace panel" })).toBeVisible();
});

test("acceptance: long-press sidebar chat opens a viewport-bounded menu without navigating", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "touch long-press");
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

test("acceptance: desktop keeps a docked sidebar and resizable workspace panel", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  await page.goto("/");
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
