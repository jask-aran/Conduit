import express from "express";

// A draft may hold 128 KiB of text; the app-wide JSON parser caps bodies at
// that same size, so quoting alone would push a full draft over the limit.
const draftBody = express.json({ limit: "256kb" });

export function registerDraftRoutes(app, { drafts, knownChat }) {
  app.get("/v0/drafts", (_request, response) => response.json(drafts.snapshot()));

  app.put("/v0/chats/:id/draft", draftBody, async (request, response) => {
    // A save can be in the air when its chat is deleted; the late write would recreate its draft and hold its attachments.
    if (!await knownChat(request.params.id)) return response.status(404).json({ error: "chat_not_found" });
    const saved = await drafts.saveDraft(request.params.id, {
      text: request.body?.text,
      attachmentIds: request.body?.attachmentIds,
    });
    response.json({ draft: saved });
  });

  app.post("/v0/stash", draftBody, async (request, response) => {
    response.status(201).json({ entry: await drafts.pushStash({
      chatId: request.body?.chatId,
      text: request.body?.text,
      attachmentIds: request.body?.attachmentIds,
    }) });
  });

  // Restoring hands the entry back and removes it: the client owns the draft
  // from that point, so leaving a copy behind would duplicate it on the next save.
  app.post("/v0/stash/:id/restore", async (request, response) => {
    response.json({ entry: await drafts.removeStash(request.params.id) });
  });

  app.delete("/v0/stash/:id", async (request, response) => {
    await drafts.removeStash(request.params.id);
    response.status(204).end();
  });
}
