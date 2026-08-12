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
  await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(0);

  await page.keyboard.press("Backspace");
  await expect(dialog.getByText("Search ›")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Control+Shift+o");
  await expect(page.getByRole("dialog", { name: "Command Palette" }).getByText("Search ›")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("Tab enters the highlighted page and Ctrl-E starts chat selection mode", async ({ page }) => {
  await page.goto("/");
  await openPalette(page);
  const input = page.getByRole("combobox", { name: "Search commands" });
  const settings = page.getByRole("option", { name: /^Settings…/ });
  await settings.hover();
  await input.press("Tab");
  await expect(page.getByText("Settings ›")).toBeVisible();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+p");
  await page.keyboard.press("Control+e");
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("1 selected")).toHaveCount(0);
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
  await page.getByRole("button", { name: "View all chats" }).click();
  const dialog = page.getByRole("dialog", { name: "Command Palette" });
  await expect(dialog.getByText("Search ›")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove Chats filter" })).toBeVisible();
  await expect(dialog.getByRole("option", { name: /Research chat/ })).toHaveCount(0);
  const input = dialog.getByRole("combobox", { name: "Search commands" });
  await input.press("Backspace");
  await expect(dialog.getByRole("button", { name: "Remove Chats filter" })).toHaveCount(0);
  await expect(dialog.getByRole("option", { name: /Research chat/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Close command palette" }).click();
  await page.getByRole("button", { name: "View all chats" }).click();
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

test("chat selection mode supports rename, copy links, and move destinations", async ({ page }) => {
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
  await page.keyboard.press("Control+e");
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.keyboard.press("r");
  const rename = page.getByRole("textbox", { name: "Rename Existing chat" });
  await expect(rename).toBeVisible();
  await rename.fill("Renamed chat");
  await rename.press("Enter");
  await expect.poll(() => renames).toEqual([{ name: "Renamed chat" }]);

  await page.locator(".command-list").focus();
  await page.keyboard.press("c");
  await expect.poll(() => page.evaluate(() => window.__copiedChatLinks)).toBe("https://conduit.example/chat/session_existing");
  await page.keyboard.press("m");
  await expect(page.getByRole("option", { name: /^Research/ })).toBeVisible();
  await page.getByRole("option", { name: /^Research/ }).click();
  await expect.poll(() => moves).toEqual([{ projectId: "project_research" }]);
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toHaveCount(0);
});

test("chat deletion from selection mode requires confirmation", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+p");
  await page.keyboard.press("Control+e");
  await page.keyboard.press("Delete");
  const confirmation = page.getByRole("alertdialog", { name: "Delete 1 chats?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("permanently deletes");
  await confirmation.getByRole("button", { name: "Delete chats" }).click();
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
