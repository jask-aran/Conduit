import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import test from "node:test";
import { registerChatRoutes } from "../src/server/routes/chats.js";

const chatId = "c".repeat(24);

async function fixture(status) {
  const app = express();
  registerChatRoutes(app, {
    backends: {
      forChat: () => ({
        getCapabilities: () => ({ history: "tree" }),
        readHistory: async () => ({ mode: "tree", leafId: "leaf", tree: [] }),
      }),
      getByChatId: () => null,
    },
    findChatContext: async () => ({
      chat: { id: chatId, status, runtime: { kind: "conduit_profile" } },
    }),
  });
  app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    get: () => fetch(`http://127.0.0.1:${port}/v0/chats/${chatId}/history`),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("history is empty before a draft starts its live session", async () => {
  const server = await fixture("draft");
  try {
    const response = await server.get();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { leafId: null, tree: [] });
  } finally {
    await server.close();
  }
});

test("history can load from the adapter without a resident session", async () => {
  const server = await fixture("active");
  try {
    const response = await server.get();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { mode: "tree", leafId: "leaf", tree: [] });
  } finally {
    await server.close();
  }
});

async function recentFixture(t, { chats, readTranscript, adapter }) {
  const app = express();
  registerChatRoutes(app, {
    projects: { list: async () => [{ id: "one", name: "One" }, { id: "two", name: "Two" }] },
    registry: { list: () => chats },
    backends: { list: () => [{ chatId: "new", status: "working" }], getByChatId: () => null,
      forChat: () => adapter || { readTranscript } },
  });
  app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (query = "") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v0/chats/recent${query}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return (await response.json()).chats;
  };
}

test("recent chats span projects, sort by activity and return only assistant text", async (t) => {
  const reads = [];
  const get = await recentFixture(t, {
    chats: [
      { id: "old", projectId: "one", status: "active", title: "Old", lastMessageAt: "2026-01-01" },
      { id: "child", projectId: "one", status: "subagent", lastMessageAt: "2026-12-01" },
      { id: "hidden", projectId: "one", untracked: true, status: "active", lastMessageAt: "2026-12-01" },
      { id: "new", projectId: "two", status: "active", title: "New", lastMessageAt: "2026-02-01" },
    ],
    readTranscript: async ({ chatId }) => {
      reads.push(chatId);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(reads.length, 2, "selected transcript reads run in parallel");
      return { messages: chatId === "old" ? [] : [
        { role: "assistant", content: "Previous reply", timestamp: "2026-01-01" },
        { role: "assistant", content: "x".repeat(2100), timestamp: "2026-02-01" },
        { role: "assistant", content: "thinking", streaming: true },
        { role: "tool", content: "tool output" }, { role: "user", content: "next prompt" },
      ] };
    },
  });
  assert.deepEqual(await get(), [
    { chatId: "new", title: "New", projectId: "two", projectName: "Two", lastMessageAt: "2026-02-01",
      liveStatus: "working", latestReply: { text: "x".repeat(2000), at: "2026-02-01" } },
    { chatId: "old", title: "Old", projectId: "one", projectName: "One", lastMessageAt: "2026-01-01", liveStatus: null, latestReply: null },
  ]);
  assert.deepEqual(reads.sort(), ["new", "old"]);
});

test("recent chats apply default and maximum limits before reading transcripts", async (t) => {
  let reads = 0;
  const get = await recentFixture(t, {
    chats: Array.from({ length: 55 }, (_, index) => ({ id: String(index), projectId: "one", status: "active", createdAt: String(index).padStart(2, "0") })),
    readTranscript: async () => { reads++; return { messages: [] }; },
  });
  assert.equal((await get()).length, 20);
  assert.equal(reads, 20);
  reads = 0;
  assert.equal((await get("?limit=500")).length, 50);
  assert.equal(reads, 50);
  assert.equal((await get("?limit=1"))[0].chatId, "54");
  assert.equal((await get("?limit=bad")).length, 20);
});

test("recent durable replies read backward in pages without a full transcript parse", async (t) => {
  const queries = [];
  const get = await recentFixture(t, {
    chats: [{ id: "durable", projectId: "one", status: "active", backend: { implementation: "conduit-runtime", opaqueSession: "42" } }],
    adapter: {
      context: "context",
      readTranscript: () => assert.fail("must use bounded entry reads"),
      runtime: { open: async () => ({ conversation: async (id, context) => {
        assert.equal(id, 42); assert.equal(context, "context");
        return { entries: async (query, limit, cursor) => {
          queries.push({ query, limit, cursor });
          return cursor ? { items: [{ id: 1, conversationId: 42, kind: "pi.assistant", model: [{ role: "assistant",
            content: [{ type: "thinking", thinking: "secret" }, { type: "text", text: "The reply" }], timestamp: 1_700_000_000_000 }] }] }
            : { items: [{ kind: "pi.tool-result" }], next: "older" };
        } };
      } }) },
    },
  });
  const [chat] = await get();
  assert.deepEqual(chat.latestReply, { text: "The reply", at: new Date(1_700_000_000_000).toISOString() });
  assert.deepEqual(queries, [
    { query: { order: "descending" }, limit: 100, cursor: undefined },
    { query: { order: "descending" }, limit: 100, cursor: "older" },
  ]);
});

test("recent chats use the transcript page cursor when the latest page has no reply", async (t) => {
  const reads = [];
  const get = await recentFixture(t, {
    chats: [{ id: "paged", projectId: "one", status: "active" }],
    readTranscript: async ({ before }) => {
      reads.push(before);
      return before ? { messages: [{ role: "assistant", content: "Last reply", timestamp: "2026-01-01" }] }
        : { messages: [{ role: "user", content: "New prompt" }], page: { before: "older" } };
    },
  });
  assert.equal((await get())[0].latestReply.text, "Last reply");
  assert.deepEqual(reads, [undefined, "older"]);
});
