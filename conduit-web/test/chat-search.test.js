import assert from "node:assert/strict";
import test from "node:test";
import { chatDateSection, resolvePaletteCommands } from "../src/client/palette/command-registry.ts";

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

test("chat date sections use local calendar boundaries", () => {
  const now = new Date();
  const localDate = (daysAgo) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12).toISOString();
  assert.equal(chatDateSection(localDate(0)), "Today");
  assert.equal(chatDateSection(localDate(1)), "Yesterday");
  assert.equal(chatDateSection(localDate(3)), "Previous 7 days");
  assert.equal(chatDateSection(localDate(10)), "Older");
  assert.equal(chatDateSection(undefined), "Older");
});
