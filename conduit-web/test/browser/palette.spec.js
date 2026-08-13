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

test("Control-P opens direct chat search and Backspace stays inside the mode", async ({ page }) => {
  await page.addInitScript(() => {
    window.__printCalls = 0;
    window.print = () => { window.__printCalls += 1; };
  });
  await page.goto("/");
  await page.keyboard.press("Control+p");
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
  await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(0);

  await page.keyboard.press("Backspace");
  await expect(dialog.getByText("Search ›")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Control+Shift+o");
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
  await page.keyboard.press("Control+p");
  const dialog = page.getByRole("dialog", { name: "Command Palette" });
  const hints = dialog.getByRole("note", { name: "Keyboard shortcuts" });
  await hints.getByRole("button", { name: /Edit chats/ }).click();
  await expect(page.getByText("1 selected")).toBeVisible();
  const chatList = dialog.getByRole("listbox", { name: "Chats" });
  await expect(chatList).toBeFocused();
  await expect(chatList).toHaveCSS("outline-style", "none");
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
  await expect(chatList).toHaveCSS("box-shadow", /inset/);
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
  await page.keyboard.press("Control+p");

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
  await page.keyboard.press("Control+p");

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
  await expect(viewAll).toHaveCSS("outline-style", "none");
  await expect(viewAll).toHaveCSS("box-shadow", /inset/);
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
  await page.keyboard.press("Control+p");
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
  await page.keyboard.press("Control+p");
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
  await page.keyboard.press("Control+p");
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
  await page.keyboard.press("Control+p");
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

  await page.keyboard.press("Control+p");
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
