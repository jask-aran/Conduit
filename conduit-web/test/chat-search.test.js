import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_IDS } from "../src/client/commands/command-registry.ts";
import { chatDateSection, resolvePaletteCommands } from "../src/client/palette/command-registry.ts";
import {
  parseChatQuery, removeChatQueryFilter, resolveChatQueryScope, serializeChatQuery,
} from "../src/client/palette/chat-query.ts";

function context(projects, chatId = null) {
  return {
    chatId,
    projects,
    templates: [],
    templateId: null,
    chatStatus: "active",
    streaming: false,
    connectivity: "online",
    effort: "medium",
    thinkingLevels: [],
    canRegenerate: false,
    canContinue: false,
    canCopy: false,
  };
}

test("chat search includes every catalogue chat, including the selected chat", () => {
  const sessions = Array.from({ length: 31 }, (_, index) => ({
    id: `session_${index}`,
    projectId: "project_chat",
    status: "active",
    title: `Chat ${index}`,
    createdAt: new Date(Date.now() - index * 86_400_000).toISOString(),
  }));
  const projects = [{ id: "project_chat", slug: "chat", name: "Chats", sessions }];
  const commands = resolvePaletteCommands(context(projects, "session_30"), { page: "chat-search" });
  const chats = commands.filter((command) => command.entity === "chat");
  assert.equal(chats.length, 31);
  assert.ok(chats.some((command) => command.chat?.id === "session_30"));
  assert.equal(chats[0]?.chat?.id, "session_0");
});

test("Go to remains an alias for the first-class chat search source", () => {
  const projects = [{
    id: "project_chat", slug: "chat", name: "Chats",
    sessions: [{ id: "session_one", projectId: "project_chat", status: "active", title: "One" }],
  }];
  const direct = resolvePaletteCommands(context(projects), { page: "chat-search" });
  const legacy = resolvePaletteCommands(context(projects), { page: "goto" });
  assert.deepEqual(legacy.map((command) => command.id), direct.map((command) => command.id));
});

test("root palette exposes app update and cache reset actions", () => {
  const commands = resolvePaletteCommands(context([]));
  const update = commands.find((command) => command.id === COMMAND_IDS.updateApp);
  const reset = commands.find((command) => command.id === COMMAND_IDS.resetAppCache);
  let updates = 0;
  let resets = 0;
  assert.equal(update?.label, "Update app");
  assert.equal(reset?.label, "Reset app cache");
  update?.run({ updateApp: () => { updates += 1; } });
  reset?.run({ resetAppCache: () => { resets += 1; } });
  assert.equal(updates, 1);
  assert.equal(resets, 1);
});

test("chat date sections use local calendar boundaries", () => {
  const now = new Date();
  const localDate = (daysAgo) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12).toISOString();
  assert.equal(chatDateSection(localDate(0)), "Today");
  assert.equal(chatDateSection(localDate(1)), "Yesterday");
  assert.equal(chatDateSection(localDate(3)), "Previous 7 days");
  assert.equal(chatDateSection(localDate(10)), "Older");
  assert.equal(chatDateSection(undefined), "Older");
});

test("chat query parser separates filters from free text and round-trips them", () => {
  const parsed = parseChatQuery('invoice scope:chats in:"Design notes"');
  assert.equal(parsed.text, "invoice");
  assert.deepEqual(parsed.filters.map(({ kind, value }) => ({ kind, value })), [
    { kind: "scope", value: "chats" },
    { kind: "in", value: "Design notes" },
  ]);
  assert.equal(serializeChatQuery(parsed.filters, parsed.text), 'scope:chats in:"Design notes" invoice');
  assert.equal(removeChatQueryFilter(parsed, 0), 'in:"Design notes" invoice');
});

test("chat query parser keeps unknown colon text and resolves scopes by project metadata", () => {
  const projects = [
    { id: "project_chat", slug: "chat", name: "Chats", sessions: [] },
    { id: "project_design", slug: "design", name: "Design notes", sessions: [] },
  ];
  assert.equal(parseChatQuery("url:https://example.test/in:box").text, "url:https://example.test/in:box");
  assert.equal(parseChatQuery("scope:other invoice").text, "scope:other invoice");
  assert.equal(resolveChatQueryScope(parseChatQuery("scope:chats"), projects).kind, "project");
  assert.equal(resolveChatQueryScope(parseChatQuery("IN:DESIGN"), projects).kind, "project");
  assert.equal(resolveChatQueryScope(parseChatQuery("in:missing"), projects).kind, "unresolved");
  assert.equal(resolveChatQueryScope(parseChatQuery("scope:all"), projects).kind, "all");
});

test("chat query parser makes duplicate filters deterministic", () => {
  const parsed = parseChatQuery("scope:chats scope:all scope:chats in:design in:design");
  assert.deepEqual(parsed.filters.map(({ kind, value }) => ({ kind, value })), [
    { kind: "scope", value: "chats" },
    { kind: "in", value: "design" },
  ]);
});
