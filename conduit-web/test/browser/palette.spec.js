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

const model = { provider: "example", id: "reasoner", spec: "example/reasoner", label: "Reasoner", thinkingLevels: ["off", "medium", "high"] };
const plainModel = { provider: "example", id: "plain", spec: "example/plain", label: "Plain", thinkingLevels: ["off"] };
const templates = [
  { id: "chat", label: "Assistant", version: 5, defaultable: true, tools: ["read", "write", "edit", "bash", "web_search", "fetch_content", "get_search_content", "source_check"] },
  { id: "workspace", label: "Coding", defaultable: true, tools: ["read", "write"] },
];

const newChatId = "550e8400-e29b-41d4-a716-446655440099";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class IdleWebSocket extends EventTarget {
      static OPEN = 1;
      constructor() { super(); this.readyState = 0; queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); }); }
      send() {}
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: IdleWebSocket });
    class MockEventSource extends EventTarget {
      constructor(url) {
        super(); this.url = url; this.readyState = 0; this.onerror = null; this.onmessage = null;
        queueMicrotask(() => {
          if (this.readyState === 2) return;
          this.readyState = 1; this.dispatchEvent(new Event("open"));
          const payload = { data: JSON.stringify({ type: "runtime_global_snapshot", processes: [], at: new Date().toISOString() }) };
          this.onmessage?.(payload); this.dispatchEvent(new MessageEvent("message", payload));
        });
      }
      close() { this.readyState = 2; }
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: MockEventSource });
  });

  // Catch-all first; specific routes registered after take precedence (last-registered wins).
  await page.route("**/v0/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/v0/templates", (route) => route.fulfill({ json: { templates, defaultTemplateId: "chat" } }));
  await page.route("**/v0/workspaces/suggestions", (route) => route.fulfill({ json: {
    root: "/home/user", allowlist: ["/home/user"], defaultRoot: "/home/user", defaultInputPath: "~",
    suggestionRoot: "/home/user", modes: ["managed", "linked", "created", "cloned"], folders: [],
  } }));
  await page.route("**/v0/capabilities", (route) => route.fulfill({ json: { partialContinue: true } }));
  await page.route("**/v0/pi-installations", (route) => route.fulfill({ json: { installations: [] } }));
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects } }));
  await page.route("**/v0/models?**", (route) => route.fulfill({ json: { models: [model, plainModel], defaultModel: model.spec, defaultThinkingLevel: "medium", requiresAuthentication: false } }));
  await page.route("**/v0/settings?**", (route) => route.fulfill({ json: { models: [model, plainModel], enabledModels: [model.spec, plainModel.spec], defaultModel: model.spec } }));
  await page.route("**/v0/search/settings", (route) => route.fulfill({ json: {
    workflow: "none",
    providers: [
      { id: "brave", label: "Brave Search", description: "Fallback", docsUrl: "https://example.test/brave", enabled: true, editable: true, configured: false, stored: false, source: null, removable: false },
      { id: "exa", label: "Exa", description: "Neural search", docsUrl: "https://example.test/exa", enabled: false, editable: false, configured: false, stored: false, source: null, removable: false },
    ],
  } }));
  await page.route("**/v0/chats/*/models", (route) => route.fulfill({ json: {
    installationId: "conduit-pinned", runtimeKind: "conduit_profile", models: [model, plainModel],
    model: model.spec, thinkingLevel: "medium", defaultModel: model.spec, defaultThinkingLevel: "medium", requiresAuthentication: false,
  } }));
  await page.route("**/v0/chats/*/attachments", (route) => route.fulfill({ json: { attachments: [] } }));
  await page.route(`**/v0/chats/${newChatId}`, (route) => route.fulfill({ json: { id: newChatId, projectId: "project_chat", status: "draft", title: "New chat" } }));
  await page.route("**/v0/chats", (route) => route.fulfill({ status: 201, json: { id: newChatId, projectId: "project_chat", status: "draft", title: "New chat" } }));
  await page.route(`**/v0/sessions/${newChatId}`, (route) => route.fulfill({ json: { id: newChatId, projectId: "project_chat", status: "draft", title: "New chat", messages: [], tools: [], page: { before: null } } }));
});

async function openPalette(page) {
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeVisible();
}

async function openShortcutsSettings(page) {
  await openPalette(page);
  await page.getByRole("option", { name: /^Settings…/ }).click();
  await page.getByRole("option", { name: /^Shortcuts/ }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("tab", { name: "Shortcuts" })).toHaveAttribute("aria-selected", "true");
  return settings;
}

test("browses grouped commands and models", async ({ page }) => {
  await page.goto("/");
  await openPalette(page);

  await expect(page.getByRole("option", { name: /^New chat/ })).toBeVisible();
  await expect(page.getByText("Commands", { exact: true })).toBeVisible();
  await expect(page.getByText("Danger zone", { exact: true })).toBeVisible();
  // Models loaded into context appear grouped by provider.
  await expect(page.getByRole("option", { name: /Reasoner/ })).toBeVisible();
  const hints = page.getByRole("note", { name: "Keyboard shortcuts" });
  await expect(hints).toBeVisible();
  await expect(hints).toContainText("Navigate");
  await expect(hints).toContainText("Open");
  await expect(hints).toContainText("Esc");
});

test("browser-local overrides drive root dispatch and palette keycaps", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("conduit:shortcuts:v1", JSON.stringify({
      version: 1,
      overrides: {
        "open-command-palette": [{
          strokes: [{ code: "KeyJ", key: "J", modifiers: ["primary"] }],
        }],
        "new-chat": [{
          strokes: [{ code: "KeyY", key: "Y", modifiers: ["primary", "shift"] }],
        }],
      },
    }));
  });
  await page.goto("/");
  await page.keyboard.press("Control+j");
  const dialog = page.getByRole("dialog", { name: "Command Palette" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("option", { name: /^New chat/ }).locator(".command-shortcut")).toHaveText("Ctrl Shift Y");
  await page.keyboard.press("Control+j");
  await expect(dialog).toHaveCount(0);
});

test("ranks search results and hides non-matches", async ({ page }) => {
  await page.goto("/");
  await openPalette(page);

  await page.getByRole("combobox", { name: "Search commands" }).fill("model");
  await expect(page.getByRole("option", { name: /Reasoner/ })).toBeVisible();
  // "Move chat" is available but the ranker drops it for a "model" query.
  await expect(page.getByRole("option", { name: /^Move chat/ })).toHaveCount(0);
});

test("drills into the Settings page and steps back with Escape", async ({ page }) => {
  await page.goto("/");
  await openPalette(page);

  await page.getByRole("option", { name: /^Settings…/ }).click();
  await expect(page.getByText("Settings ›")).toBeVisible();
  await expect(page.getByRole("option", { name: /^Models/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^Back/ })).toBeVisible();

  await page.keyboard.press("Backspace");
  await expect(page.getByText("Settings ›")).toBeVisible();
  await page.keyboard.press("Escape");
  // Escape on a page returns to root (does not close the palette).
  await expect(page.getByText("Settings ›")).toHaveCount(0);
  await expect(page.getByRole("option", { name: /^Search chats…/ })).toHaveCount(1);
  await expect(page.getByRole("option", { name: /^Go to…/ })).toHaveCount(0);

  await page.screenshot({ path: "/home/jask/.claude/jobs/a9046fd1/tmp/command-palette.png" });
});

test("opens the Search settings surface with Brave active and future providers disabled", async ({ page }) => {
  await page.goto("/");
  await openPalette(page);
  await page.getByRole("option", { name: /^Settings…/ }).click();
  await page.getByRole("option", { name: /^Search$/ }).click();

  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("tab", { name: "Search" })).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByLabel("Brave Search API key")).toBeVisible();
  await expect(settings.getByLabel("Exa API key")).toBeDisabled();
  await expect(settings.getByText("No Brave key configured")).toBeVisible();
});

test("keyboard navigation moves the active option and Escape closes root", async ({ page }) => {
  await page.goto("/");
  await openPalette(page);

  const input = page.getByRole("combobox", { name: "Search commands" });
  await input.press("ArrowDown");
  // aria-activedescendant tracks the highlighted row.
  await expect(input).toHaveAttribute("aria-activedescendant", /command-option-\d+/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toHaveCount(0);
});

test("Control-Shift-K toggles direct chat search and Backspace stays inside the mode", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+Shift+k");
  const dialog = page.getByRole("dialog", { name: "Command Palette" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Search ›")).toBeVisible();
  await expect(dialog.getByRole("option", { name: /Existing chat/ })).toBeVisible();
  const hints = dialog.getByRole("note", { name: "Keyboard shortcuts" });
  await expect(hints).toContainText("Edit chats");
  await expect(hints).toContainText(/⌘ E|Ctrl E/);
  await expect(hints).toContainText("Rename");
  await expect(hints).toContainText("Delete");
  await expect(hints).toContainText("Move");
  await expect(hints).toContainText(/⌘ K|Ctrl K/);
  await expect(hints).not.toContainText("⌘⇧");
  await expect(hints).not.toContainText("⌥⇧");

  await page.keyboard.press("Backspace");
  await expect(dialog.getByText("Search ›")).toBeVisible();
  await page.keyboard.press("Control+Shift+k");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Control+Shift+k");
  await expect(page.getByRole("dialog", { name: "Command Palette" }).getByText("Search ›")).toBeVisible();
  await page.keyboard.press("Control+e");
  await expect(dialog.getByText("1 selected")).toBeVisible();
  await page.keyboard.press("Control+Shift+k");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Control+Shift+k");
  await expect(page.getByRole("dialog", { name: "Command Palette" }).getByText("Search ›")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("Tab enters the highlighted page and the footer toggles chat selection mode", async ({ page }) => {
  await page.goto("/");
  await openPalette(page);
  const input = page.getByRole("combobox", { name: "Search commands" });
  const settings = page.getByRole("option", { name: /^Settings…/ });
  await settings.hover();
  await input.press("Tab");
  await expect(page.getByText("Settings ›")).toBeVisible();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+k");
  const dialog = page.getByRole("dialog", { name: "Command Palette" });
  const hints = dialog.getByRole("note", { name: "Keyboard shortcuts" });
  await hints.getByRole("button", { name: /Edit chats/ }).click();
  await expect(page.getByText("1 selected")).toBeVisible();
  const chatList = dialog.getByRole("listbox", { name: "Chats" });
  await expect(chatList).toBeFocused();
  await expect(hints).toContainText("Done");
  await expect(hints).toContainText("Click");
  await expect(hints).toContainText("Space");
  await expect(hints).toContainText("Delete");
  await expect(hints).toContainText("Move");
  await expect(hints).not.toContainText("Rename");
  await hints.getByRole("button", { name: /Done/ }).click();
  await expect(page.getByText("1 selected")).toHaveCount(0);
  await expect(dialog.getByRole("combobox", { name: "Search commands" })).toBeFocused();
  await expect(hints).toContainText("Rename");
  await page.keyboard.press("Control+e");
  await expect(page.getByText("1 selected")).toBeVisible();
  await expect(chatList).toBeFocused();
  await page.keyboard.press("Control+e");
  await expect(page.getByText("1 selected")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toHaveCount(0);
});

test("Control-click enters edit mode and ordinary clicks toggle more chats", async ({ page }) => {
  const sessions = [
    { id: "session_existing", projectId: "project_chat", status: "active", title: "Existing chat", createdAt: "2026-08-13T02:00:00.000Z" },
    { id: "session_second", projectId: "project_chat", status: "active", title: "Second chat", createdAt: "2026-08-13T01:00:00.000Z" },
  ];
  await page.route("**/v0/projects", (route) => route.fulfill({ json: {
    projects: [{ ...projects[0], sessions }, projects[1]],
  } }));
  await page.goto("/");
  await page.keyboard.press("Control+Shift+k");

  const dialog = page.getByRole("dialog", { name: "Command Palette" });
  const input = dialog.getByRole("combobox", { name: "Search commands" });
  const existing = dialog.getByRole("option", { name: /Existing chat/ });
  const second = dialog.getByRole("option", { name: /Second chat/ });
  const initialUrl = page.url();

  await second.click({ modifiers: ["Control"] });
  await expect(dialog.getByText("1 selected")).toBeVisible();
  await expect(second).toHaveAttribute("data-chat-selected", "true");
  await expect(dialog.getByRole("listbox", { name: "Chats" })).toBeFocused();
  expect(page.url()).toBe(initialUrl);

  await existing.click();
  await expect(dialog.getByText("2 selected")).toBeVisible();
  await expect(existing).toHaveAttribute("data-chat-selected", "true");
  expect(page.url()).toBe(initialUrl);

  await input.fill("Second");
  await expect(existing).toHaveCount(0);
  await expect(dialog.getByText("2 selected")).toBeVisible();
  await input.fill("");
  await expect(page.getByRole("alertdialog", { name: /Delete/ })).toHaveCount(0);
  await expect(existing).toHaveAttribute("data-chat-selected", "true");
  await expect(second).toHaveAttribute("data-chat-selected", "true");

  await existing.click();
  await expect(dialog.getByText("1 selected")).toBeVisible();
  await expect(existing).not.toHaveAttribute("data-chat-selected", "true");
});

test("edit footer buttons open bulk delete and move flows", async ({ page }) => {
  const sessions = [
    { id: "session_existing", projectId: "project_chat", status: "active", title: "Existing chat", createdAt: "2026-08-13T02:00:00.000Z" },
    { id: "session_second", projectId: "project_chat", status: "active", title: "Second chat", createdAt: "2026-08-13T01:00:00.000Z" },
  ];
  const moves = [];
  await page.route("**/v0/projects", (route) => route.fulfill({ json: {
    projects: [{ ...projects[0], sessions }, projects[1]],
  } }));
  await page.route("**/v0/sessions/*/move", async (route) => {
    moves.push({
      id: new URL(route.request().url()).pathname.split("/").at(-2),
      ...route.request().postDataJSON(),
    });
    await route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.keyboard.press("Control+Shift+k");

  const dialog = page.getByRole("dialog", { name: "Command Palette" });
  const hints = dialog.getByRole("note", { name: "Keyboard shortcuts" });
  await dialog.getByRole("option", { name: /Second chat/ }).click({ modifiers: ["Control"] });
  await dialog.getByRole("option", { name: /Existing chat/ }).click();
  await expect(dialog.getByText("2 selected")).toBeVisible();
  const actionLabelColors = await hints.locator(".command-hint-action .command-hint-label").evaluateAll(
    (labels) => labels.map((label) => getComputedStyle(label).color),
  );
  expect(actionLabelColors).toHaveLength(3);
  expect(new Set(actionLabelColors).size).toBe(1);

  await hints.getByRole("button", { name: /Delete/ }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Delete 2 chats?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog.getByText("2 selected")).toBeVisible();

  await hints.getByRole("button", { name: /Move/ }).click();
  await expect(hints).toContainText("Back");
  await dialog.getByRole("option", { name: /^Research/ }).click();
  await expect.poll(() => moves.sort((left, right) => left.id.localeCompare(right.id))).toEqual([
    { id: "session_existing", projectId: "project_research" },
    { id: "session_second", projectId: "project_research" },
  ]);
  await expect(dialog).toHaveCount(0);
});

test("sidebar View all opens a Chats-scoped search after the twenty-row limit", async ({ page }) => {
  const sessions = Array.from({ length: 24 }, (_, index) => ({
    id: `session_many_${index}`,
    projectId: "project_chat",
    status: "active",
    title: `Many chat ${index}`,
    createdAt: new Date(Date.now() - index * 60_000).toISOString(),
  }));
  await page.unroute("**/v0/projects");
  const researchChat = { id: "session_research", projectId: "project_research", status: "active", title: "Research chat", createdAt: new Date().toISOString() };
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects: [{ id: "project_chat", slug: "chat", name: "Chats", sessions }, { ...projects[1], sessions: [researchChat] }] } }));
  await page.goto("/");
  const chatsGroup = page.locator(".sidebar-group").filter({ has: page.getByText("Chats", { exact: true }) }).first();
  await expect(chatsGroup.locator(".sidebar-chat")).toHaveCount(20);
  const viewAll = page.getByRole("button", { name: "View all chats" });
  await viewAll.click();
  const dialog = page.getByRole("dialog", { name: "Command Palette" });
  await expect(dialog.getByText("Search ›")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove Chats filter" })).toBeVisible();
  const input = dialog.getByRole("combobox", { name: "Search commands" });
  await expect(input).toBeFocused();
  await input.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", /command-option-\d+/);
  const hints = dialog.getByRole("note", { name: "Keyboard shortcuts" });
  await hints.getByRole("button", { name: /Edit chats/ }).click();
  await expect(dialog.getByText("1 selected")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove Chats filter" })).toBeVisible();
  await hints.getByRole("button", { name: /Done/ }).click();
  await expect(input).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Remove Chats filter" })).toBeVisible();
  await expect(dialog.getByRole("option", { name: /Research chat/ })).toHaveCount(0);
  await input.press("Backspace");
  await expect(dialog.getByRole("button", { name: "Remove Chats filter" })).toHaveCount(0);
  await expect(dialog.getByRole("option", { name: /Research chat/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Close command palette" }).click();
  await expect(viewAll).toBeFocused();
  await viewAll.click();
  const scopedDialog = page.getByRole("dialog", { name: "Command Palette" });
  await expect(scopedDialog.getByRole("button", { name: "Remove Chats filter" })).toBeVisible();
  await scopedDialog.getByRole("combobox", { name: "Search commands" }).fill("Many chat 23");
  await expect(scopedDialog.getByRole("button", { name: "Remove Chats filter" })).toBeVisible();
  await expect(scopedDialog.getByRole("option", { name: /Many chat 23/ })).toBeVisible();
  await scopedDialog.getByRole("button", { name: "Remove Chats filter" }).click();
  await scopedDialog.getByRole("combobox", { name: "Search commands" }).fill("");
  await expect(scopedDialog.getByRole("option", { name: /Research chat/ })).toBeVisible();
  await scopedDialog.getByRole("combobox", { name: "Search commands" }).fill('in:"Research"');
  await expect(scopedDialog.getByRole("option", { name: /Research chat/ })).toBeVisible();
  await expect(scopedDialog.getByRole("option", { name: /Many chat 23/ })).toHaveCount(0);
  await scopedDialog.getByRole("combobox", { name: "Search commands" }).fill("scope:all");
  await expect(scopedDialog.getByRole("button", { name: "Remove All chats filter" })).toBeVisible();
  await expect(scopedDialog.getByRole("option", { name: /Many chat 23/ })).toBeVisible();
  await expect(scopedDialog.getByRole("option", { name: /Research chat/ })).toBeVisible();
});

test("Settings UI exposes and persists the sidebar chat limit", async ({ page }) => {
  await page.goto("/");
  await openPalette(page);
  await page.getByRole("option", { name: /^Settings…/ }).click();
  await page.getByRole("option", { name: /^UI$/ }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const limit = settings.getByLabel("Chats shown in sidebar");
  await expect(limit).toHaveValue("20");
  await limit.fill("8");
  await limit.blur();
  await expect(limit).toHaveValue("8");
  await settings.getByRole("button", { name: "Close" }).click();
  await page.keyboard.press("Control+k");
  await page.getByRole("option", { name: /^Settings…/ }).click();
  await page.getByRole("option", { name: /^UI$/ }).click();
  await expect(page.getByRole("dialog", { name: "Settings" }).getByLabel("Chats shown in sidebar")).toHaveValue("8");
});

test("Settings UI toggles and persists the ambient meteor field", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("conduit:meteor-field-test-initialized") === "true") return;
    localStorage.removeItem("conduit:meteor-field");
    sessionStorage.setItem("conduit:meteor-field-test-initialized", "true");
  });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toBeVisible();
  await expect(page.locator(".chat-meteors")).toHaveCount(1);

  await openPalette(page);
  await page.getByRole("option", { name: /^Settings…/ }).click();
  await page.getByRole("option", { name: /^UI$/ }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const toggle = settings.getByLabel("Ambient meteor field");
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator(".chat-meteors")).toHaveCount(0);

  await settings.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toBeVisible();
  await expect(page.locator(".chat-meteors")).toHaveCount(0);

  await openPalette(page);
  await page.getByRole("option", { name: /^Settings…/ }).click();
  await page.getByRole("option", { name: /^UI$/ }).click();
  const reloadedSettings = page.getByRole("dialog", { name: "Settings" });
  const reloadedToggle = reloadedSettings.getByLabel("Ambient meteor field");
  await expect(reloadedToggle).not.toBeChecked();
  await reloadedToggle.check();
  await expect(page.locator(".chat-meteors")).toHaveCount(1);
});

test("Settings UI selects and persists all composer surfaces", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("conduit:composer-surface-test-initialized") === "true") return;
    localStorage.removeItem("conduit:composer-surface");
    localStorage.removeItem("conduit:liquid-glass-surface");
    sessionStorage.setItem("conduit:composer-surface-test-initialized", "true");
  });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toBeVisible();
  await expect(page.locator(".composer")).toHaveAttribute("data-composer-surface", "frost");

  await openPalette(page);
  await page.getByRole("option", { name: /^Settings…/ }).click();
  await page.getByRole("option", { name: /^UI$/ }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const surface = settings.getByLabel("Composer surface");
  await expect(surface).toHaveValue("frost");

  await surface.selectOption("static");
  await expect(page.locator(".composer")).toHaveAttribute("data-composer-surface", "static");
  const backing = page.locator(".composer-static-backing");
  await expect(backing).toHaveCount(1);
  expect(await page.evaluate(() => {
    const composer = document.querySelector(".composer");
    const backing = document.querySelector(".composer-static-backing");
    if (!composer || !backing) return false;
    const composerBox = composer.getBoundingClientRect();
    const backingBox = backing.getBoundingClientRect();
    return Math.abs(composerBox.left - backingBox.left) < 0.5
      && Math.abs(composerBox.top - backingBox.top) < 0.5
      && Math.abs(composerBox.width - backingBox.width) < 0.5
      && Math.abs(composerBox.height - backingBox.height) < 0.5;
  })).toBe(true);

  await surface.selectOption("liquid");
  await expect(page.locator(".composer")).toHaveAttribute("data-composer-surface", "liquid");
  const layer = page.locator(".composer-glass-filter");
  await expect(layer).toHaveAttribute("data-liquid-glass-ready", "true");
  await expect(page.locator(".liquid-glass-definitions feGaussianBlur")).toHaveCount(1);

  await surface.selectOption("frost");
  await expect(page.locator(".composer")).toHaveAttribute("data-composer-surface", "frost");
  await expect(page.locator(".composer-static-backing")).toHaveCount(0);

  await surface.selectOption("static");
  await settings.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toBeVisible();
  await expect(page.locator(".composer")).toHaveAttribute("data-composer-surface", "static");
  await expect(page.locator(".composer-static-backing")).toHaveCount(1);
});

test("shortcut recording suppresses commands and updates chat-search hints immediately", async ({ page }) => {
  await page.goto("/");
  const settings = await openShortcutsSettings(page);
  const editRow = settings.locator(".shortcut-command").filter({ hasText: "Edit chats" });
  await editRow.getByRole("button", { name: /Replace Ctrl E/ }).click();
  const recorder = editRow.locator(".shortcut-recorder-capture");
  await expect(recorder).toBeFocused();

  // The command being replaced must be recorded, not executed.
  await recorder.dispatchEvent("keydown", { key: "e", code: "KeyE", ctrlKey: true });
  await expect(recorder).toContainText("Ctrl E");
  await expect(settings).toBeVisible();
  await recorder.dispatchEvent("keydown", { key: "Backspace", code: "Backspace" });
  await recorder.dispatchEvent("keydown", { key: "u", code: "KeyU", ctrlKey: true });
  await editRow.getByRole("button", { name: "Save shortcut" }).click();
  await expect(editRow.getByRole("button", { name: /Replace Ctrl U/ })).toBeVisible();

  await settings.getByRole("button", { name: "Close" }).click();
  await page.keyboard.press("Control+Shift+k");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  const hints = palette.getByRole("note", { name: "Keyboard shortcuts" });
  await expect(hints).toContainText("Ctrl U");
  await expect(hints).not.toContainText("Ctrl E");
  await page.keyboard.press("Control+u");
  await expect(palette.getByText("1 selected")).toBeVisible();
});

test("shortcut settings block overlaps, warn about browser ownership, and reset safely", async ({ page }) => {
  await page.goto("/");
  const settings = await openShortcutsSettings(page);
  const commandPaletteRow = settings.locator(".shortcut-command").filter({ hasText: "Open command palette" });
  await commandPaletteRow.getByRole("button", { name: /Replace Ctrl K/ }).click();
  let recorder = commandPaletteRow.locator(".shortcut-recorder-capture");
  await recorder.dispatchEvent("keydown", { key: "b", code: "KeyB", ctrlKey: true });
  await expect(commandPaletteRow).toContainText(/Toggle sidebar already uses this shortcut/);
  await expect(commandPaletteRow.getByRole("button", { name: "Save shortcut" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(settings).toBeVisible();
  await expect(recorder).toHaveCount(0);

  const searchRow = settings.locator(".shortcut-command").filter({ hasText: "Search chats…" });
  await searchRow.getByRole("button", { name: /Replace Ctrl Shift K/ }).click();
  recorder = searchRow.locator(".shortcut-recorder-capture");
  await recorder.dispatchEvent("keydown", { key: "p", code: "KeyP", ctrlKey: true });
  await expect(searchRow).toContainText("Print");
  await recorder.dispatchEvent("keydown", { key: "Backspace", code: "Backspace" });
  await recorder.dispatchEvent("keydown", { key: "d", code: "KeyD", ctrlKey: true, shiftKey: true });
  await expect(searchRow).toContainText("Bookmark all tabs");
  await searchRow.getByRole("button", { name: "Cancel" }).click();

  const bulkMoveRow = settings.locator(".shortcut-command").filter({ hasText: "Move selected chats" });
  await bulkMoveRow.getByRole("button", { name: /Replace M/ }).click();
  recorder = bulkMoveRow.locator(".shortcut-recorder-capture");
  await recorder.dispatchEvent("keydown", { key: "r", code: "KeyR", altKey: true });
  await expect(bulkMoveRow).toContainText("separate context");
  await expect(bulkMoveRow.getByRole("button", { name: "Save shortcut" })).toBeEnabled();
  await bulkMoveRow.getByRole("button", { name: "Save shortcut" }).click();
  await expect(bulkMoveRow).toContainText("Custom");
  await settings.getByRole("button", { name: "Reset all" }).click();
  await expect(bulkMoveRow.getByRole("button", { name: /Replace M/ })).toBeVisible();
  await expect(bulkMoveRow.getByText("Custom")).toHaveCount(0);

  const content = settings.locator(".settings-content");
  expect(await content.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
});

test("chat edit mode leaves query text keys local and an expired prefix returns to typing", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+Shift+k");
  const dialog = page.getByRole("dialog", { name: "Command Palette" });
  const input = dialog.getByRole("combobox", { name: "Search commands" });
  await input.fill("abc");
  await page.keyboard.press("Control+e");
  await input.focus();
  await input.press("End");
  await input.press("d");
  await expect(input).toHaveValue("abcd");
  await input.evaluate((element) => element.setSelectionRange(0, 0));
  await input.press("Delete");
  await expect(input).toHaveValue("bcd");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await page.keyboard.press("Control+e");
  await input.fill("");
  await input.focus();
  await page.keyboard.press("Control+k");
  await expect(dialog.getByRole("note", { name: "Keyboard shortcuts" })).toContainText("Cancel");
  await page.waitForTimeout(1_650);
  await page.keyboard.press("d");
  await expect(input).toHaveValue("d");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("single-chat rename stays outside bulk selection mode", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { window.__copiedChatLinks = text; } },
    });
  });
  await page.route("**/v0/share-origin", (route) => route.fulfill({ json: { origin: "https://conduit.example" } }));
  const renames = [];
  await page.route("**/v0/sessions/session_existing", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    renames.push(route.request().postDataJSON());
    await route.fulfill({ json: { ...projects[0].sessions[0], title: "Renamed chat" } });
  });
  const moves = [];
  await page.route("**/v0/sessions/session_existing/move", async (route) => {
    moves.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });

  await page.goto("/");
  await page.keyboard.press("Control+Shift+k");
  const hints = page.getByRole("note", { name: "Keyboard shortcuts" });
  await page.keyboard.press("Alt+r");
  await expect(page.getByText("1 selected")).toHaveCount(0);
  const rename = page.getByRole("textbox", { name: "Rename Existing chat" });
  await expect(rename).toBeVisible();
  await expect(hints).toContainText("Save");
  await expect(hints).toContainText("Cancel");
  await rename.fill("Renamed chat");
  await rename.press("Enter");
  await expect.poll(() => renames).toEqual([{ name: "Renamed chat" }]);
  await expect(hints).toContainText("Edit chats");
  await page.keyboard.press("Control+k");
  await page.keyboard.press("r");
  await expect(rename).toBeVisible();
  await rename.press("Escape");

  await page.keyboard.press("Control+e");
  await expect(page.getByText("1 selected")).toBeVisible();
  await expect(hints).toContainText("Done");
  await expect(hints).toContainText("Delete");
  await expect(hints).toContainText("Move");
  await expect(hints).not.toContainText("Rename");

  await page.locator(".command-list").focus();
  await page.keyboard.press("c");
  await expect.poll(() => page.evaluate(() => window.__copiedChatLinks)).toBe("https://conduit.example/chat/session_existing");
  await page.keyboard.press("m");
  await expect(hints).toContainText("Move");
  await expect(hints).toContainText("Back");
  await expect(page.getByRole("option", { name: /^Research/ })).toBeVisible();
  await page.getByRole("option", { name: /^Research/ }).click();
  await expect.poll(() => moves).toEqual([{ projectId: "project_research" }]);
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toHaveCount(0);
});

test("single-chat move and delete shortcuts stay outside bulk selection mode", async ({ page }) => {
  const moves = [];
  await page.route("**/v0/sessions/session_existing/move", async (route) => {
    moves.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });

  await page.goto("/");
  await page.keyboard.press("Control+Shift+k");
  const hints = page.getByRole("note", { name: "Keyboard shortcuts" });
  await page.keyboard.press("Control+k");
  await page.keyboard.press("m");
  await expect(page.getByText("1 selected")).toHaveCount(0);
  await expect(hints).toContainText("Move");
  await expect(hints).toContainText("Back");
  await page.getByRole("option", { name: /^Research/ }).click();
  await expect.poll(() => moves).toEqual([{ projectId: "project_research" }]);

  await page.locator(".palette-trigger").click();
  const dialog = page.getByRole("dialog", { name: "Command Palette" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("option", { name: /^Search chats/ }).click();
  await expect(dialog.getByText("Search ›")).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.keyboard.press("d");
  const confirmation = page.getByRole("alertdialog", { name: "Delete 1 chats?" });
  await expect(confirmation).toBeVisible();
  await expect(page.getByText("1 selected")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("combobox", { name: "Search commands" })).toBeFocused();
  await page.keyboard.press("Control+k");
  await page.keyboard.press("d");
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("combobox", { name: "Search commands" })).toBeFocused();
  await expect(page.getByRole("note", { name: "Keyboard shortcuts" })).toContainText("Rename");
});

test("chat actions have an app-owned chord fallback after browser shortcut collisions", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+Shift+k");
  const dialog = page.getByRole("dialog", { name: "Command Palette" });
  await dialog.getByRole("combobox", { name: "Search commands" }).focus();
  await page.keyboard.press("Control+k");
  await expect(dialog.getByRole("note", { name: "Keyboard shortcuts" })).toContainText("Cancel");
  await page.keyboard.press("d");
  const confirmation = page.getByRole("alertdialog", { name: "Delete 1 chats?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog.getByRole("combobox", { name: "Search commands" })).toBeFocused();
});

test("chat deletion from selection mode requires confirmation", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+Shift+k");
  await page.keyboard.press("Control+e");
  await page.keyboard.press("Delete");
  const confirmation = page.getByRole("alertdialog", { name: "Delete 1 chats?" });
  const cancel = confirmation.getByRole("button", { name: "Cancel" });
  const confirm = confirmation.getByRole("button", { name: "Delete chats" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("permanently deletes");
  await expect(cancel).toBeFocused();
  await expect(confirm).toHaveAttribute("data-variant", "outline");
  await page.keyboard.press("ArrowRight");
  await expect(confirm).toBeFocused();
  await expect(confirm).toHaveAttribute("data-variant", "destructive");
  await page.keyboard.press("ArrowLeft");
  await expect(cancel).toBeFocused();
  await expect(confirm).toHaveAttribute("data-variant", "outline");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toHaveCount(0);
});

test("opening a chat from search expands its collapsed parent folder", async ({ page }) => {
  const researchChat = { id: "session_research", projectId: "project_research", status: "active", title: "Research chat", createdAt: new Date().toISOString() };
  await page.addInitScript((chatId) => {
    class WorkingEventSource extends EventTarget {
      constructor(url) {
        super(); this.url = url; this.readyState = 0; this.onerror = null; this.onmessage = null;
        queueMicrotask(() => {
          if (this.readyState === 2) return;
          this.readyState = 1;
          const payload = { data: JSON.stringify({
            type: "runtime_global_snapshot",
            processes: [{ chatId, status: "running", active: true, activity: "working" }],
            at: new Date().toISOString(),
          }) };
          this.onmessage?.(payload);
          this.dispatchEvent(new MessageEvent("message", payload));
        });
      }
      close() { this.readyState = 2; }
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: WorkingEventSource });
  }, researchChat.id);
  await page.unroute("**/v0/projects");
  await page.route("**/v0/projects", (route) => route.fulfill({ json: {
    projects: [projects[0], { ...projects[1], sessions: [researchChat] }],
  } }));
  await page.route("**/v0/chats/session_research", (route) => route.fulfill({ json: researchChat }));
  await page.route("**/v0/sessions/session_research", (route) => route.fulfill({ json: { ...researchChat, messages: [], tools: [], page: { before: null } } }));
  await page.goto("/");
  const block = page.locator(".sidebar-project-block").filter({ hasText: "Research" });
  await block.getByRole("button", { name: "Collapse chat list" }).click();
  await expect(block.getByRole("button", { name: "Research chat" })).toHaveCount(0);

  await page.keyboard.press("Control+Shift+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Research chat");
  await page.getByRole("option", { name: /Research chat/ }).click();
  await expect(page).toHaveURL(/\/chat\/session_research$/);
  await expect(block.getByRole("button", { name: "Research chat" })).toBeVisible();
  const projectLink = block.locator(".sidebar-project-link");
  await expect(projectLink.locator(".runtime-indicator-active")).toBeVisible();
  await block.getByRole("button", { name: "Collapse chat list" }).click();
  await expect(block.getByRole("button", { name: "Research chat" })).toHaveCount(0);
  await expect(projectLink.locator(".runtime-indicator-active")).toBeVisible();
});
