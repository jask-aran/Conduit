import assert from "node:assert/strict";
import test from "node:test";
import {
  availableComposerCommands,
  availablePaletteCommands,
  groupPaletteCommands,
  paletteCommands,
  paletteSources,
  resolvePaletteCommands,
  SETTINGS_SECTIONS,
} from "../src/client/command-registry.js";
import { detectCommandToken, replaceCommandToken } from "../src/client/slash-token.js";
import { mergeContinuation } from "../src/continuation.js";

test("slash tokens are limited to the first token and preserve unknown commands as text", () => {
  assert.deepEqual(detectCommandToken("  /atta rest", 7), { trigger: "/", query: "atta", start: 2, end: 7 });
  assert.equal(detectCommandToken("say /attach", 11), null);
  assert.deepEqual(detectCommandToken("$future", 7), { trigger: "$", query: "future", start: 0, end: 7 });
  const token = detectCommandToken("  /attach hello", 9);
  assert.equal(replaceCommandToken("  /attach hello", token), "   hello");
});

test("palette root browse keeps settings and go-to behind portals", () => {
  const empty = availablePaletteCommands({ chatId: null, streaming: false, projects: [] });
  const emptyIds = empty.map((command) => command.id);
  assert.ok(emptyIds.includes("new-chat"));
  assert.ok(emptyIds.includes("new-folder"));
  assert.ok(emptyIds.includes("toggle-sidebar"));
  assert.ok(emptyIds.includes("page:settings"));
  assert.ok(emptyIds.includes("page:goto"));
  assert.ok(emptyIds.every((id) => !["attach", "rename", "move", "delete", "copy-transcript"].includes(id)));
  assert.ok(SETTINGS_SECTIONS.every((section) => !emptyIds.includes(`settings:${section.id}`)));

  const composer = availableComposerCommands({ chatId: "chat-id" });
  assert.deepEqual(composer.map((command) => command.slash), ["attach"]);
  assert.deepEqual(availableComposerCommands({ chatId: null }), []);
});

test("root search never leaks page children", () => {
  const projects = [{
    id: "project_chat",
    name: "Chats",
    slug: "chat",
    sessions: [{ id: "chat-a", title: "Alpha" }],
  }];
  const root = resolvePaletteCommands({ chatId: null, projects });
  const ids = root.map((command) => command.id);
  assert.ok(ids.includes("page:settings"));
  assert.ok(ids.includes("page:goto"));
  assert.ok(SETTINGS_SECTIONS.every((section) => !ids.includes(`settings:${section.id}`)));
  assert.ok(!ids.includes("open-chat:chat-a"));
  assert.ok(!ids.includes("new-chat-in:project_chat"));
});

test("settings page lists sections only", () => {
  const page = resolvePaletteCommands({}, { page: "settings" });
  assert.deepEqual(page.map((command) => command.id), SETTINGS_SECTIONS.map((section) => `settings:${section.id}`));
});

test("palette exposes chat actions only when a chat is selected", () => {
  const withChat = resolvePaletteCommands({
    chatId: "chat-1",
    streaming: false,
    canCopy: true,
    canRegenerate: true,
    projects: [],
  });
  const ids = withChat.map((command) => command.id);
  assert.ok(ids.includes("attach"));
  assert.ok(ids.includes("rename"));
  assert.ok(ids.includes("move"));
  assert.ok(ids.includes("copy"));
  assert.ok(ids.includes("copy-transcript"));
  assert.ok(ids.includes("delete"));
  assert.ok(!ids.includes("stop"));
});

test("go-to page lists chats and folders; root hides them until search", () => {
  const projects = [{
    id: "project_chat",
    name: "Chats",
    slug: "chat",
    sessions: [{ id: "chat-a", title: "Alpha" }, { id: "chat-b", title: "Beta" }],
  }, {
    id: "project_research",
    name: "Research",
    slug: "research",
    sessions: [{ id: "chat-c", title: "Notes" }],
  }];
  const root = resolvePaletteCommands({ chatId: "chat-a", projects, thinkingLevels: ["off", "high"], effort: "high" });
  const rootIds = root.map((command) => command.id);
  assert.ok(rootIds.includes("page:goto"));
  assert.ok(!rootIds.includes("open-chat:chat-b"));
  assert.ok(rootIds.includes("thinking:high"));

  const goto = resolvePaletteCommands({ chatId: "chat-a", projects }, { page: "goto" });
  const gotoIds = goto.map((command) => command.id);
  assert.ok(gotoIds.includes("open-chat:chat-b"));
  assert.ok(gotoIds.includes("open-chat:chat-c"));
  assert.ok(!gotoIds.includes("open-chat:chat-a"));
  assert.ok(gotoIds.includes("new-chat-in:project_chat"));
  assert.ok(gotoIds.includes("new-chat-in:project_research"));
});

test("named folder context unlocks folder rename and delete", () => {
  const commands = resolvePaletteCommands({
    chatId: "chat-1",
    project: { id: "p1", name: "Research", slug: "research" },
    projects: [],
  });
  const ids = commands.map((command) => command.id);
  assert.ok(ids.includes("rename-folder"));
  assert.ok(ids.includes("delete-folder"));
});

test("groupPaletteCommands preserves group order and danger zone", () => {
  const grouped = groupPaletteCommands(resolvePaletteCommands({
    chatId: "chat-1",
    streaming: true,
    projects: [],
    connectivity: "offline",
  }));
  assert.deepEqual(grouped.map((group) => group.id), ["commands", "danger"]);
  assert.ok(grouped.find((group) => group.id === "commands").items.some((item) => item.id === "stop"));
  assert.ok(grouped.find((group) => group.id === "commands").items.some((item) => item.id === "reload"));
  assert.ok(grouped.find((group) => group.id === "commands").items.some((item) => item.id === "page:settings"));
  assert.ok(grouped.find((group) => group.id === "danger").items.some((item) => item.id === "delete"));
});

test("palette registry stays extensible via static commands and sources", () => {
  assert.ok(paletteCommands.length >= 10);
  assert.ok(paletteSources.some((source) => source.id === "chats"));
  assert.ok(paletteSources.some((source) => source.id === "settings-sections"));
  assert.ok(paletteSources.every((source) => "page" in source));
  for (const command of paletteCommands) {
    assert.equal(typeof command.id, "string");
    assert.equal(typeof command.label, "string");
    assert.equal(typeof command.group, "string");
    assert.equal(typeof command.isAvailable, "function");
    assert.equal(typeof command.run, "function");
  }
});

test("continuation removes only exact normalized overlap", () => {
  assert.equal(mergeContinuation("First line\r\nsecond", "second and third"), "First line\nsecond and third");
  assert.equal(mergeContinuation("Answer", "Different"), "AnswerDifferent");
  assert.equal(mergeContinuation("aaaaab", "aaab plus"), "aaaaab plus");
  assert.equal(mergeContinuation("abcabc", "abc again"), "abcabc again");
});
