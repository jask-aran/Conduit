import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSession, MemoryStorage } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { PersistentAgent } from "../../src/agent/agent.js";
import { AgentDoc } from "../../src/agent/agent-doc.js";
import { ChatStore } from "../../src/chat-store.js";

// Real agent and document commits; no server, connector connection, or model.
export async function agentFixture(t, settings = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-agent-test-"));
  const previous = Object.fromEntries(["CONDUIT_DATA_ROOT", "CONDUIT_ADVERTISE_ON_LAN", "CONDUIT_PORT"].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { CONDUIT_DATA_ROOT: root, CONDUIT_ADVERTISE_ON_LAN: "false", CONDUIT_PORT: "0" });
  const session = createSession(new MemoryStorage());
  const runtime = { dataRoot: root, context: BACKGROUND_CONTEXT, open: async () => session };
  const registry = new ChatStore(path.join(root, "chats.json"));
  const agent = new PersistentAgent({ runtime, registry });
  agent.project = { id: "agent-project", workingRoot: root };
  agent.cached = { timezone: "UTC", quietHours: { enabled: false }, ...settings };
  const chat = await registry.create(agent.project);
  await agent.update((doc) => { doc.home = { chatId: chat.id, conversationId: "home-conversation" }; });
  t.after(async () => {
    await runtime.messageLog?.writing;
    await session.close(BACKGROUND_CONTEXT);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, agent, session, api: {
    conversationId: "home-conversation",
    commit: (change) => session.commit(change, BACKGROUND_CONTEXT),
    snapshot: () => session.snapshot(AgentDoc, BACKGROUND_CONTEXT),
  } };
}
