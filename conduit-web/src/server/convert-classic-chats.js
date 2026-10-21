import fs from "node:fs";
import { templateBackend } from "../chat-backend.js";
import { resolveTemplate } from "../config.js";
import { convertPiSession } from "../pi-to-durable.js";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

/**
 * Conduit's own chats run on the Conduit durable agent (plan, milestone 5,
 * 2026-10-22: no dual support). At start, every chat still on classic Pi is
 * converted once: its session's active branch becomes a durable conversation
 * and the chat points at it, keeping its template as its profile. A draft
 * with no session just changes backend. Chats of the old "Conduit runtime"
 * profile become Assistant chats. A chat whose conversion fails is left as it
 * was and reported, so one bad session does not stop the server.
 */
export async function convertClassicChats({ registry, projects, backends, config, log = console }) {
  const durable = backends.adapters.get("conduit-runtime");
  if (!durable?.runtime) return { converted: 0, failed: 0 };
  const fallback = resolveTemplate(config, "assistant") || config.piTemplates[0];
  let converted = 0;
  let failed = 0;
  for (const chat of registry.list({ includeHidden: true, includeUntracked: true })) {
    const backend = chat.backend || {};
    if (backend.implementation === "conduit-runtime" && backend.profileId === "conduit-runtime") {
      await registry.update(chat.id, { templateId: fallback.id, templateVersion: fallback.version,
        backend: { ...templateBackend(fallback), model: backend.model, opaqueSession: backend.opaqueSession } });
      continue;
    }
    if (backend.protocol && backend.protocol !== "pi_rpc") continue;
    const template = resolveTemplate(config, chat.templateId) || fallback;
    const sessionFile = backend.opaqueSession && fs.existsSync(backend.opaqueSession) ? backend.opaqueSession : null;
    try {
      let opaqueSession = null;
      if (sessionFile) {
        const project = await projects.get(chat.projectId);
        const harness = await durable.runtime.open();
        const result = await convertPiSession({ harness, sessionFile, chatId: chat.id, cwd: project?.workingRoot || null,
          model: null, thinkingLevel: null, context: BACKGROUND_CONTEXT });
        // The template's tools and prompt, as a new chat on it would have.
        const conversation = await harness.conversation(result.conversationId, BACKGROUND_CONTEXT);
        await conversation?.configure(await durable.runtime.agentFor(template.id), BACKGROUND_CONTEXT);
        opaqueSession = String(result.conversationId);
      }
      await registry.update(chat.id, { templateId: template.id, templateVersion: template.version, runtime: null,
        backend: { ...templateBackend(template), opaqueSession } });
      converted += 1;
    } catch (error) {
      failed += 1;
      log.warn?.(`[conduit] could not convert classic chat ${chat.id}:`, error?.message || error);
    }
  }
  if (converted || failed) log.log?.(`Conduit converted ${converted} classic Pi chat${converted === 1 ? "" : "s"} to the durable agent${failed ? ` (${failed} failed)` : ""}`);
  return { converted, failed };
}
