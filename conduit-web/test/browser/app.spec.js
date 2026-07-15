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
    await page.getByRole("button", { name: "Conduit", exact: true }).click();
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

test("hides transient new chats and provides right-click menus without row actions", async ({ page }, testInfo) => {
  await page.goto("/");
  await openSidebar(page, testInfo);

  await expect(page.locator('[data-sidebar="content"]').getByText("New chat", { exact: true })).toHaveCount(0);
  await expect(page.locator('button[aria-current="page"]')).toHaveCount(0);
  await expect(page.getByLabel("Actions for Existing chat")).toHaveCount(0);

  await page.getByRole("button", { name: "Existing chat" }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Delete chat" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Research" }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Delete folder" })).toBeVisible();
});

test("keeps a fixed sidebar with the base button group", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.goto("/");

  const sidebar = page.locator('[data-slot="sidebar"][data-state]');
  const sidebarInner = page.locator('[data-slot="sidebar-inner"]');
  const main = page.locator('[data-slot="sidebar-inset"]');
  const footerGroup = page.locator('[data-sidebar="footer"] > [data-slot="button-group"]');
  const footerButtons = footerGroup.locator(':scope > [data-slot="button"]');
  const brand = page.locator(".sidebar-brand");
  const brandIcon = brand.locator("svg");
  const brandTitle = brand.locator("span");

  const [mainBox, footerBox, innerBox, iconBox, lastAction] = await Promise.all([
    main.boundingBox(),
    footerGroup.boundingBox(),
    sidebarInner.boundingBox(),
    brandIcon.boundingBox(),
    footerButtons.last().boundingBox(),
  ]);
  expect(Math.abs(footerBox.x - (mainBox.x - footerBox.x - footerBox.width))).toBeLessThanOrEqual(1);
  expect(innerBox.y + innerBox.height - lastAction.y - lastAction.height).toBe(8);
  await expect(footerButtons).toHaveCount(3);
  expect(iconBox.width).toBe(24);
  expect(iconBox.height).toBe(24);
  await expect(brandTitle).toHaveCSS("font-size", "24px");
  await expect(brandTitle).toHaveCSS("line-height", "24px");

  await page.keyboard.press("Control+b");
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

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Scoped models")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Reasoner/ })).toBeChecked();
});
