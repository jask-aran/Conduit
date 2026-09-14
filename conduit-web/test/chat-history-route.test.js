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
      manifestFor: () => ({ history: "tree" }),
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

test("history still requires a resident session for an active chat", async () => {
  const server = await fixture("active");
  try {
    const response = await server.get();
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "live_session_required" });
  } finally {
    await server.close();
  }
});
