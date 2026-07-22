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
  { id: "chat", label: "General", defaultable: true, tools: ["read", "write"] },
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
  await page.route("**/v0/workspaces/suggestions", (route) => route.fulfill({ json: { folders: [] } }));
  await page.route("**/v0/capabilities", (route) => route.fulfill({ json: { partialContinue: true } }));
  await page.route("**/v0/pi-installations", (route) => route.fulfill({ json: { installations: [] } }));
  await page.route("**/v0/projects", (route) => route.fulfill({ json: { projects } }));
  await page.route("**/v0/models?**", (route) => route.fulfill({ json: { models: [model, plainModel], defaultModel: model.spec, defaultThinkingLevel: "medium", requiresAuthentication: false } }));
  await page.route("**/v0/settings?**", (route) => route.fulfill({ json: { models: [model, plainModel], enabledModels: [model.spec, plainModel.spec], defaultModel: model.spec } }));
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

  await page.keyboard.press("Escape");
  // Escape on a page returns to root (does not close the palette).
  await expect(page.getByText("Settings ›")).toHaveCount(0);
  await expect(page.getByRole("option", { name: /^Go to…/ })).toBeVisible();

  await page.screenshot({ path: "/home/jask/.claude/jobs/a9046fd1/tmp/command-palette.png" });
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
