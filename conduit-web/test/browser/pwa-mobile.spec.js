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
const mobileOverlapTranscript = Array.from({ length: 18 }, (_, index) =>
  `Transcript paragraph ${index + 1} keeps enough content in the narrow viewport to exercise the glass overlap at the bottom of the chat.`,
).join("\n\n");

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
      messages: [
        { id: "u1", role: "user", content: "Hello" },
        { id: "a1", role: "assistant", content: mobileOverlapTranscript },
      ],
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

test("acceptance: mobile header hides identity and groups chat actions in More", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "phone header chrome");
  await openApp(page);

  await expect(page.locator(".chat-header-title")).toBeHidden();
  await expect(page.locator(".chat-profile-posture")).toBeHidden();
  const controls = [".mobile-sidebar-trigger", ".search-trigger", ".palette-trigger", ".chat-header-more"];
  for (const selector of controls) {
    const control = page.locator(selector);
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(38);
    expect(box.width).toBeLessThanOrEqual(40);
    expect(box.height).toBeGreaterThanOrEqual(38);
    expect(box.height).toBeLessThanOrEqual(40);
  }

  const more = page.getByRole("button", { name: "More chat options" });
  await more.tap();
  const menu = page.locator('[data-slot="menu-content"].chat-header-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator(".chat-header-menu-title")).toHaveText("New chat");
  await expect(menu.locator(".chat-header-menu-meta")).toContainText("Chats");
  await expect(menu.locator(".chat-header-menu-context")).toBeVisible();
  await expect(menu.locator(".chat-header-menu-context")).toContainText("Context metrics");
  await expect(menu.locator(".chat-header-menu-context")).toContainText("No context metrics available yet.");
  for (const label of ["Update app", "Workspace panel", "Share", "Rename", "Delete"]) {
    await expect(menu.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  }
  const [menuBox, viewport] = await Promise.all([
    menu.boundingBox(),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  ]);
  expect(menuBox.x).toBeGreaterThanOrEqual(-2);
  expect(menuBox.y).toBeGreaterThanOrEqual(-2);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width + 2);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height + 2);
  const beforeUrl = page.url();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await more.tap();
  await menu.getByRole("menuitem", { name: "Workspace panel", exact: true }).tap();
  await expect(page.getByRole("complementary", { name: "Workspace panel" })).toBeVisible();
  await expect(page).toHaveURL(beforeUrl);
  await page.getByRole("button", { name: "Close workspace panel" }).tap();
  await expect(page.getByRole("complementary", { name: "Workspace panel" })).toBeHidden();
});

test("acceptance: update app checks the service worker before reloading", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "phone app update control");
  await openApp(page);

  const result = await page.evaluate(async () => {
    const updateCalls = [];
    const registration = {
      installing: null,
      waiting: null,
      update: async () => { updateCalls.push("update"); },
    };
    Object.defineProperty(navigator.serviceWorker, "getRegistration", {
      configurable: true,
      value: async () => registration,
    });
    const { forcePwaUpdate } = await import("/src/client/pwa-update.ts");
    let reloads = 0;
    await forcePwaUpdate(() => { reloads += 1; });
    return { updateCalls, reloads };
  });

  expect(result).toEqual({ updateCalls: ["update"], reloads: 1 });
});

test("acceptance: mobile runtime status stays quiet and context metrics live in More", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "phone runtime status rail");
  await openApp(page);

  const status = page.locator(".chat-status-line");
  await expect(status).toBeVisible();
  await expect(status).toContainText("Ready");
  await expect(page.locator(".composer-status")).toBeHidden();
  const [statusBox, composerBox] = await Promise.all([
    status.boundingBox(),
    page.locator(".composer").boundingBox(),
  ]);
  expect(statusBox.height).toBeGreaterThanOrEqual(38);
  expect(statusBox.height).toBeLessThanOrEqual(40);
  expect(composerBox.height).toBeLessThan(180);

  await expect(page.getByRole("dialog", { name: "Runtime status" })).toHaveCount(0);
  await page.getByRole("button", { name: "More chat options" }).tap();
  const menu = page.locator('[data-slot="menu-content"].chat-header-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator(".chat-header-menu-context")).toContainText("Context metrics");
  await expect(menu.locator(".chat-header-menu-context")).toContainText("No context metrics available yet.");
});

test("acceptance: mobile composer is one row with Plus-owned message options", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "phone composer options");
  await openApp(page);

  const composer = page.locator(".composer");
  const composerBox = await composer.boundingBox();
  expect(composerBox.height).toBeLessThanOrEqual(72);
  const input = page.getByRole("textbox", { name: "Message Pi" });
  await expect(input).toHaveAttribute("data-has-text", "false");
  await input.fill("Hello");
  await expect(input).toHaveAttribute("data-has-text", "true");
  await expect(input).toHaveCSS("padding-top", "8px");
  const filledComposerBox = await composer.boundingBox();
  expect(filledComposerBox.height).toBeLessThanOrEqual(52);
  await input.fill("");
  await expect(input).toHaveAttribute("data-has-text", "false");
  await expect(page.locator(".composer-plus-trigger")).toBeVisible();
  await expect(page.locator(".dictation-trigger")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await expect(page.locator(".composer-desktop-attachment")).toBeHidden();
  await expect(page.locator(".composer-desktop-setting")).toHaveCount(2);
  for (const setting of await page.locator(".composer-desktop-setting").all()) await expect(setting).toBeHidden();

  await input.focus();
  await page.evaluate(() => {
    if (window.visualViewport) Object.defineProperty(window.visualViewport, "height", { configurable: true, value: innerHeight - 300 });
  });
  await page.getByRole("button", { name: "Message options" }).tap();
  await expect(input).toBeFocused();
  const menu = page.locator('[data-slot="menu-content"].composer-options-menu');
  await expect(menu).toBeVisible();
  const [menuBox, plusBox, viewport] = await Promise.all([
    menu.boundingBox(),
    page.locator(".composer-plus-trigger").boundingBox(),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  ]);
  expect(menuBox.width).toBeLessThan(viewport.width - 80);
  expect(Math.abs(menuBox.x - plusBox.x)).toBeLessThan(16);
  expect(menuBox.y).toBeLessThanOrEqual(plusBox.y + 2);
  for (const label of ["Model", "Profile", "Attach files"]) {
    await expect(menu.getByRole("menuitem", { name: new RegExp(`^${label}`) })).toBeVisible();
  }
  await expect(menu.getByText("Effort", { exact: true })).toBeVisible();
  for (const level of ["Off", "Medium", "High"]) {
    await expect(menu.getByRole("menuitemradio", { name: level })).toBeVisible();
  }

  await page.getByRole("button", { name: "Message options" }).tap();
  await expect(menu).toHaveCount(0);
  await expect(input).toBeFocused();
  await page.getByRole("button", { name: "Message options" }).tap();
  await expect(menu).toBeVisible();
  await expect(input).toBeFocused();

  await menu.getByRole("menuitem", { name: /^Model/ }).tap();
  const modelPanel = menu.locator(".composer-model-menu");
  await expect(modelPanel).toBeVisible();
  await expect(menu).toBeVisible();
  await expect(input).toBeFocused();
  const modelPanelBox = await modelPanel.boundingBox();
  expect(modelPanelBox.x).toBeGreaterThanOrEqual(0);
  expect(modelPanelBox.x + modelPanelBox.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(modelPanelBox.y + modelPanelBox.height).toBeLessThanOrEqual(viewport.height + 1);
  await expect(modelPanel.getByText("Model", { exact: true })).toBeVisible();
  await expect(modelPanel.getByText("Thinking", { exact: true })).toHaveCount(0);
  await expect(modelPanel.getByRole("menuitemradio").first()).toBeVisible();
  await modelPanel.getByRole("menuitem", { name: "Message options" }).tap();
  await expect(modelPanel).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(input).toBeFocused();

  await menu.getByRole("menuitem", { name: /^Model/ }).tap();
  await expect(modelPanel).toBeVisible();
  await modelPanel.getByRole("menuitemradio").first().tap();
  await expect(modelPanel).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(input).toBeFocused();
  await menu.getByRole("menuitemradio", { name: "High" }).tap();
  await expect(menu).toBeVisible();
  await expect(input).toBeFocused();

  await menu.getByRole("menuitem", { name: /^Profile/ }).tap();
  const profilePanel = menu.locator(".composer-profile-menu");
  await expect(profilePanel).toBeVisible();
  await expect(input).toBeFocused();
  await expect(profilePanel.getByRole("menuitemradio", { name: "Assistant" })).toBeVisible();
  await profilePanel.getByRole("menuitemradio", { name: "Assistant" }).tap();
  await expect(profilePanel).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(input).toBeFocused();

  await menu.getByRole("menuitem", { name: /^Model/ }).tap();
  await expect(modelPanel).toBeVisible();
  await page.getByRole("button", { name: "Message options" }).tap();
  await expect(menu).toHaveCount(0);
  await expect(input).toBeFocused();
  await page.getByRole("button", { name: "Message options" }).tap();
  await expect(menu).toBeVisible();
  await expect(modelPanel).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: /^Model/ })).toBeVisible();
  await expect(input).toBeFocused();
});

test("acceptance: mobile transcript fades behind the frosted composer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "phone transcript/composer overlap");
  await openApp(page);
  await page.locator(".mobile-sidebar-trigger").tap();
  await page.getByText("Existing chat", { exact: true }).tap();
  await expect.poll(async () => (await page.locator(".conduit-sidebar").boundingBox())?.x ?? -Infinity).toBeLessThan(-400);
  await expect(page.locator(".bubble-user")).toContainText("Hello");
  await expect(page.locator(".chat-main:not(.chat-main-empty) article.message-assistant")).toContainText("Transcript paragraph 1");
  const messageViewport = page.locator(".chat-main:not(.chat-main-empty) .message-scroller-viewport");
  await messageViewport.evaluate((element) => {
    const composer = document.querySelector(".chat-main:not(.chat-main-empty) .composer");
    const paragraphs = [...element.querySelectorAll("article.message-assistant p")];
    const target = paragraphs.find((candidate) => candidate.getBoundingClientRect().top >= (composer?.getBoundingClientRect().top ?? Infinity)) || paragraphs.at(-1);
    if (!target || !composer) throw new Error("Expected transcript paragraph and composer overlap targets");
    target.setAttribute("data-test-glass-target", "true");
    target.style.background = "repeating-linear-gradient(90deg, #ff5c8a 0 8px, #56d7ff 8px 16px, #ffd166 16px 24px)";
    target.style.color = "#f8fafc";
    target.style.minHeight = "52px";
    target.style.padding = "4px";
  });
  await expect.poll(async () => page.evaluate(() => {
    const element = document.querySelector(".chat-main:not(.chat-main-empty) .message-scroller-viewport");
    const target = document.querySelector('[data-test-glass-target="true"]');
    const composer = document.querySelector(".chat-main:not(.chat-main-empty) .composer");
    if (!element || !target || !composer) return 0;
    const targetBox = target.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    const overlap = Math.max(0, Math.min(targetBox.bottom, composerBox.bottom) - Math.max(targetBox.top, composerBox.top));
    if (overlap > 8) return overlap;
    element.scrollTop += targetBox.top - composerBox.top + 10;
    return 0;
  })).toBeGreaterThan(8);
  await expect.poll(async () => page.evaluate(() => {
    const target = document.querySelector('[data-test-glass-target="true"]');
    const composer = document.querySelector(".chat-main:not(.chat-main-empty) .composer");
    if (!target || !composer) return 0;
    const targetBox = target.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    return Math.max(0, Math.min(targetBox.bottom, composerBox.bottom) - Math.max(targetBox.top, composerBox.top));
  })).toBeGreaterThan(8);

  const layout = await page.evaluate(() => {
    const header = document.querySelector(".chat-main:not(.chat-main-empty) .chat-header");
    const workArea = document.querySelector(".chat-main:not(.chat-main-empty) .work-area");
    const stack = document.querySelector(".chat-main:not(.chat-main-empty) .composer-stack");
    const composer = document.querySelector(".chat-main:not(.chat-main-empty) .composer");
    const transcript = document.querySelector(".chat-main:not(.chat-main-empty) .transcript");
    const thread = document.querySelector(".chat-main:not(.chat-main-empty) .thread");
    if (!header || !workArea || !stack || !composer || !transcript || !thread) throw new Error("Expected a non-empty chat layout");
    const headerBox = header.getBoundingClientRect();
    const workAreaBox = workArea.getBoundingClientRect();
    const transcriptBox = transcript.getBoundingClientRect();
    const stackStyle = getComputedStyle(stack);
    const stackFadeStyle = getComputedStyle(stack, "::before");
    const headerStyle = getComputedStyle(header);
    const threadStyle = getComputedStyle(thread);
    const target = document.querySelector('[data-test-glass-target="true"]');
    if (!target) throw new Error("Expected a long assistant paragraph");
    const targetBox = target.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    return {
      workAreaTop: workAreaBox.top,
      transcriptTop: transcriptBox.top,
      headerHeight: headerBox.height,
      headerBackgroundImage: headerStyle.backgroundImage,
      headerBorderTopWidth: headerStyle.borderTopWidth,
      headerBoxShadow: headerStyle.boxShadow,
      stackMarginTop: stackStyle.marginTop,
      stackPaddingTop: stackStyle.paddingTop,
      stackBackgroundColor: stackStyle.backgroundColor,
      stackBackgroundImage: stackStyle.backgroundImage,
      stackFadeBackgroundImage: stackFadeStyle.backgroundImage,
      stackPointerEvents: stackStyle.pointerEvents,
      headerBackdropFilter: headerStyle.backdropFilter,
      transcriptUnderComposer: targetBox.top < composerBox.bottom && targetBox.bottom > composerBox.top,
      transcriptComposerOverlap: Math.max(0, Math.min(targetBox.bottom, composerBox.bottom) - Math.max(targetBox.top, composerBox.top)),
      composerTranscriptOverlap: Math.max(0, Math.min(composerBox.bottom, transcriptBox.bottom) - Math.max(composerBox.top, transcriptBox.top)),
      threadPaddingTop: threadStyle.paddingTop,
      threadPaddingBottom: threadStyle.paddingBottom,
    };
  });
  expect(layout).toMatchObject({
    workAreaTop: 0,
    transcriptTop: 0,
    headerHeight: 52,
    stackMarginTop: "0px",
    stackPaddingTop: "10px",
    stackBackgroundColor: "rgba(0, 0, 0, 0)",
    stackPointerEvents: "none",
    threadPaddingTop: "52px",
    threadPaddingBottom: "220px",
    headerBorderTopWidth: "0px",
    headerBoxShadow: "none",
  });
  expect(layout.headerBackgroundImage).toContain("linear-gradient");
  expect(layout.stackBackgroundImage).toBe("none");
  expect(layout.stackFadeBackgroundImage).toBe("none");
  expect(layout.headerBackdropFilter).toContain("blur");
  expect(layout.transcriptUnderComposer).toBe(true);
  expect(layout.transcriptComposerOverlap).toBeGreaterThan(8);
  expect(layout.composerTranscriptOverlap).toBeGreaterThan(8);
  await expect(page.locator(".chat-main:not(.chat-main-empty) .composer")).toHaveScreenshot("composer-frost-mobile.png", {
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });
  if (process.env.COMPOSER_GLASS_CAPTURE === "1") {
    await page.locator(".chat-main:not(.chat-main-empty) .composer").screenshot({ path: "/tmp/conduit-composer-basic-mobile.png" });
  }
});

test("acceptance: desktop transcript stays behind the basic composer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop basic composer overlap");
  await openApp(page);
  await page.locator(".sidebar-chat").filter({ hasText: "Existing chat" }).click();
  await expect(page.locator(".chat-main:not(.chat-main-empty) article.message-assistant")).toContainText("Transcript paragraph 1");
  const messageViewport = page.locator(".chat-main:not(.chat-main-empty) .message-scroller-viewport");
  await messageViewport.evaluate((element) => {
    const composer = document.querySelector(".chat-main:not(.chat-main-empty) .composer");
    const paragraphs = [...element.querySelectorAll("article.message-assistant p")];
    const target = paragraphs.find((candidate) => candidate.getBoundingClientRect().top >= (composer?.getBoundingClientRect().top ?? Infinity)) || paragraphs.at(-1);
    if (!target || !composer) throw new Error("Expected transcript paragraph and composer overlap targets");
    target.setAttribute("data-test-desktop-basic-target", "true");
    const viewportBox = element.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    const targetTopInContent = targetBox.top - viewportBox.top + element.scrollTop;
    const composerTopInViewport = composerBox.top - viewportBox.top;
    const desiredScrollTop = targetTopInContent - composerTopInViewport + 12;
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = Math.max(0, Math.min(maxScrollTop, desiredScrollTop));
  });
  const layout = await page.evaluate(() => {
    const stack = document.querySelector(".chat-main:not(.chat-main-empty) .composer-stack");
    const composer = document.querySelector(".chat-main:not(.chat-main-empty) .composer");
    const target = document.querySelector('[data-test-desktop-basic-target="true"]');
    if (!stack || !composer || !target) throw new Error("Expected desktop basic composer layout");
    const stackStyle = getComputedStyle(stack);
    const fadeStyle = getComputedStyle(stack, "::before");
    const composerBox = composer.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    return {
      stackBackgroundColor: stackStyle.backgroundColor,
      stackBackgroundImage: stackStyle.backgroundImage,
      stackFadeBackgroundImage: fadeStyle.backgroundImage,
      transcriptComposerOverlap: Math.max(0, Math.min(targetBox.bottom, composerBox.bottom) - Math.max(targetBox.top, composerBox.top)),
    };
  });
  expect(layout.stackBackgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(layout.stackBackgroundImage).toBe("none");
  expect(layout.stackFadeBackgroundImage).toBe("none");
  expect(layout.transcriptComposerOverlap).toBeGreaterThan(8);
});

test("acceptance: desktop transcript passes behind the static glassmorphism composer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop transcript/composer overlap");
  await openApp(page);
  await page.locator(".sidebar-chat").filter({ hasText: "Existing chat" }).click();
  await expect(page.locator(".chat-main:not(.chat-main-empty) article.message-assistant")).toContainText("Transcript paragraph 1");
  const messageViewport = page.locator(".chat-main:not(.chat-main-empty) .message-scroller-viewport");
  await messageViewport.evaluate((element) => {
    const composer = document.querySelector(".chat-main:not(.chat-main-empty) .composer");
    const paragraphs = [...element.querySelectorAll("article.message-assistant p")];
    const target = paragraphs.find((candidate) => candidate.getBoundingClientRect().top >= (composer?.getBoundingClientRect().top ?? Infinity)) || paragraphs.at(-1);
    if (!target || !composer) throw new Error("Expected transcript paragraph and composer overlap targets");
    target.setAttribute("data-test-desktop-glass-target", "true");
    const viewportBox = element.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    const targetTopInContent = targetBox.top - viewportBox.top + element.scrollTop;
    const composerTopInViewport = composerBox.top - viewportBox.top;
    const desiredScrollTop = targetTopInContent - composerTopInViewport + 12;
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = Math.max(0, Math.min(maxScrollTop, desiredScrollTop));
  });
  await expect.poll(async () => page.evaluate(() => {
    const target = document.querySelector('[data-test-desktop-glass-target="true"]');
    const composer = document.querySelector(".chat-main:not(.chat-main-empty) .composer");
    if (!target || !composer) return 0;
    const targetBox = target.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    return Math.max(0, Math.min(targetBox.bottom, composerBox.bottom) - Math.max(targetBox.top, composerBox.top));
  })).toBeGreaterThan(8);

  const layout = await page.evaluate(() => {
    const stack = document.querySelector(".chat-main:not(.chat-main-empty) .composer-stack");
    const composer = document.querySelector(".chat-main:not(.chat-main-empty) .composer");
    const thread = document.querySelector(".chat-main:not(.chat-main-empty) .thread");
    const target = document.querySelector('[data-test-desktop-glass-target="true"]');
    if (!stack || !composer || !thread || !target) throw new Error("Expected a desktop chat layout");
    const stackStyle = getComputedStyle(stack);
    const stackFadeStyle = getComputedStyle(stack, "::before");
    const composerStyle = getComputedStyle(composer);
    const frostFilter = composer.querySelector(".composer-frost-filter");
    const frostChrome = composer.querySelector(".composer-frost-chrome");
    if (!frostFilter || !frostChrome) throw new Error("Expected basic frost layers");
    const frostFilterStyle = getComputedStyle(frostFilter);
    const frostChromeStyle = getComputedStyle(frostChrome);
    const threadStyle = getComputedStyle(thread);
    const targetBox = target.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    return {
      stackBackgroundColor: stackStyle.backgroundColor,
      stackBackgroundImage: stackStyle.backgroundImage,
      stackFadeBackgroundImage: stackFadeStyle.backgroundImage,
      composerBackgroundColor: composerStyle.backgroundColor,
      composerBackdropFilter: composerStyle.backdropFilter,
      composerOverflow: composerStyle.overflow,
      frostBackgroundImage: frostChromeStyle.backgroundImage,
      frostBackdropFilter: frostFilterStyle.backdropFilter,
      frostBoxShadow: frostChromeStyle.boxShadow,
      svgDefinitions: document.querySelectorAll(".liquid-glass-definitions").length,
      glassFilters: document.querySelectorAll(".composer-glass-filter").length,
      threadPaddingBottom: threadStyle.paddingBottom,
      composerClass: composer.className,
      transcriptComposerOverlap: Math.max(0, Math.min(targetBox.bottom, composerBox.bottom) - Math.max(targetBox.top, composerBox.top)),
    };
  });
  expect(layout.stackBackgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(layout.stackBackgroundImage).toBe("none");
  expect(layout.stackFadeBackgroundImage).toBe("none");
  expect(layout.composerBackgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(layout.composerBackdropFilter).toBe("none");
  expect(layout.composerOverflow).toBe("visible");
  expect(layout.frostBackdropFilter).toContain("blur(36px)");
  expect(layout.frostBackgroundImage).toContain("radial-gradient");
  expect(layout.frostBoxShadow).toContain("inset");
  expect(layout.svgDefinitions).toBe(0);
  expect(layout.glassFilters).toBe(0);
  expect(layout.threadPaddingBottom).toBe("128px");
  expect(layout.composerClass).toBe("composer");
  expect(layout.transcriptComposerOverlap).toBeGreaterThan(8);
  if (process.env.COMPOSER_GLASS_CAPTURE === "1") {
    await page.locator(".chat-main:not(.chat-main-empty) .composer").screenshot({ path: "/tmp/conduit-composer-basic-desktop.png" });
  }
});

test("acceptance: desktop opt-in liquid glass uses the precomputed SVG path", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop liquid glass path");
  await page.addInitScript(() => localStorage.setItem("conduit:liquid-glass-surface", "true"));
  await openApp(page);
  await page.locator(".sidebar-chat").filter({ hasText: "Existing chat" }).click();
  await expect(page.locator(".chat-main:not(.chat-main-empty) article.message-assistant")).toContainText("Transcript paragraph 1");
  const layer = page.locator(".composer-glass-filter");
  await expect(layer).toHaveAttribute("data-liquid-glass-ready", "true");
  const messageViewport = page.locator(".chat-main:not(.chat-main-empty) .message-scroller-viewport");
  await messageViewport.evaluate((element) => {
    const composer = document.querySelector(".chat-main:not(.chat-main-empty) .composer");
    const paragraphs = [...element.querySelectorAll("article.message-assistant p")];
    const target = paragraphs.find((candidate) => candidate.getBoundingClientRect().top >= (composer?.getBoundingClientRect().top ?? Infinity)) || paragraphs.at(-1);
    if (!target || !composer) throw new Error("Expected transcript paragraph and composer overlap targets");
    target.setAttribute("data-test-liquid-target", "true");
    const viewportBox = element.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    const targetTopInContent = targetBox.top - viewportBox.top + element.scrollTop;
    const composerTopInViewport = composerBox.top - viewportBox.top;
    const desiredScrollTop = targetTopInContent - composerTopInViewport + 12;
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = Math.max(0, Math.min(maxScrollTop, desiredScrollTop));
  });
  const graph = await page.evaluate(() => {
    const composer = document.querySelector(".chat-main:not(.chat-main-empty) .composer");
    const layer = document.querySelector(".composer-glass-filter");
    const chrome = document.querySelector(".composer-glass-chrome");
    const filter = document.querySelector(".liquid-glass-definitions filter");
    if (!composer || !layer || !chrome || !filter) throw new Error("Expected liquid glass surface");
    const composerStyle = getComputedStyle(composer);
    const chromeStyle = getComputedStyle(chrome);
    return {
      composerBackground: composerStyle.backgroundColor,
      composerBackdropFilter: composerStyle.backdropFilter,
      composerOverflow: composerStyle.overflow,
      composerHeight: Math.round(composer.getBoundingClientRect().height),
      chromeBackgroundImage: chromeStyle.backgroundImage,
      layerBackdropFilter: getComputedStyle(layer).backdropFilter,
      primitives: [...filter.children].map((node) => node.tagName),
      blur: filter.querySelector("feGaussianBlur")?.getAttribute("stdDeviation"),
      assetKey: layer.getAttribute("data-liquid-glass-asset-key"),
      displacementHref: filter.querySelector("feImage")?.getAttribute("href"),
      transcriptComposerOverlap: (() => {
        const target = document.querySelector('[data-test-liquid-target="true"]');
        const targetBox = target?.getBoundingClientRect();
        const composerBox = composer.getBoundingClientRect();
        return targetBox ? Math.max(0, Math.min(targetBox.bottom, composerBox.bottom) - Math.max(targetBox.top, composerBox.top)) : 0;
      })(),
    };
  });
  expect(graph.composerBackground).toBe("rgba(0, 0, 0, 0)");
  expect(graph.composerBackdropFilter).toBe("none");
  expect(graph.composerOverflow).toBe("visible");
  expect(graph.composerHeight).toBeLessThan(120);
  expect(graph.chromeBackgroundImage).toContain("radial-gradient");
  expect(graph.layerBackdropFilter).toContain("url(\"#conduit-liquid-glass-");
  expect(graph.primitives).toEqual(["feGaussianBlur", "feImage", "feDisplacementMap", "feColorMatrix", "feImage", "feComposite", "feComponentTransfer", "feBlend", "feBlend"]);
  expect(graph.blur).toBe("8");
  expect(graph.assetKey).toBe("desktop:88");
  expect(graph.displacementHref).toBe("/glass/composer-desktop-88.png");
  expect(graph.transcriptComposerOverlap).toBeGreaterThan(8);
  if (process.env.COMPOSER_GLASS_CAPTURE === "1") {
    await page.locator(".chat-main:not(.chat-main-empty) .composer").screenshot({ path: "/tmp/conduit-composer-liquid-desktop.png" });
  }
});

test("acceptance: final transcript remains reachable above the composer", async ({ page }, testInfo) => {
  await openApp(page);
  if (testInfo.project.name === "mobile-chromium") {
    await page.locator(".mobile-sidebar-trigger").tap();
    await page.getByText("Existing chat", { exact: true }).tap();
  } else {
    await page.locator(".sidebar-chat").filter({ hasText: "Existing chat" }).click();
  }
  await expect(page.locator(".chat-main:not(.chat-main-empty) article.message-assistant")).toContainText("Transcript paragraph 1");
  const reachability = await page.locator(".chat-main:not(.chat-main-empty) .message-scroller-viewport").evaluate((element) => {
    const composer = document.querySelector(".chat-main:not(.chat-main-empty) .composer");
    const lastParagraph = [...element.querySelectorAll("article.message-assistant p")].at(-1);
    if (!composer || !lastParagraph) throw new Error("Expected final transcript and composer");
    element.scrollTop = element.scrollHeight;
    const lastBox = lastParagraph.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    return { lastBottom: lastBox.bottom, composerTop: composerBox.top, viewportBottom: element.getBoundingClientRect().bottom };
  });
  expect(reachability.lastBottom).toBeLessThanOrEqual(reachability.composerTop + 1);
  expect(reachability.lastBottom).toBeLessThanOrEqual(reachability.viewportBottom + 1);
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
  await page.getByRole("button", { name: "More chat options" }).tap();
  await page.locator('[data-slot="menu-content"].chat-header-menu').getByRole("menuitem", { name: "Workspace panel", exact: true }).tap();
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
  await expect(page.getByRole("button", { name: "More chat options" })).toBeVisible();
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
