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

async function openChatSurface(page) {
  await page.goto("/");
  const modelsLoaded = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/models"));
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await modelsLoaded;
}

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
  await openChatSurface(page);
  await openPalette(page);

  await expect(page.getByRole("option", { name: /^New chat/ })).toBeVisible();
  await expect(page.getByText("Commands", { exact: true })).toBeVisible();
  await expect(page.getByText("Danger zone", { exact: true })).toBeVisible();
  const hints = page.getByRole("note", { name: "Keyboard shortcuts" });
  await expect(hints).toBeVisible();
  await expect(hints).toContainText("Navigate");
  await expect(hints).toContainText("Open");
  await expect(hints).toContainText("Esc");
});

