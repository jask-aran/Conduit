import express from "express";

// A draft may hold 128 KiB of text; the app-wide JSON parser caps bodies at
// that same size, so quoting alone would push a full draft over the limit.
const draftBody = express.json({ limit: "256kb" });

export function registerDraftRoutes(app, { drafts, knownChat }) {
  app.get("/v0/drafts", (_request, response) => response.json(drafts.snapshot()));

  app.put("/v0/chats/:id/draft", draftBody, async (request, response, next) => {
    try {
      // A save can be in the air when its chat is deleted, and this route once
      // took any non-empty id -- so the late write recreated a draft for a
      // chat that no longer existed, holding its attachments with it.
      if (!await knownChat(request.params.id)) return response.status(404).json({ error: "chat_not_found" });
      const saved = await drafts.saveDraft(request.params.id, {
        text: request.body?.text,
        attachmentIds: request.body?.attachmentIds,
      });
      response.json({ draft: saved });
    } catch (error) { next(error); }
  });

  app.post("/v0/stash", draftBody, async (request, response, next) => {
    try {
      response.status(201).json({ entry: await drafts.pushStash({
        chatId: request.body?.chatId,
        text: request.body?.text,
        attachmentIds: request.body?.attachmentIds,
      }) });
    } catch (error) { next(error); }
  });

  // Restoring hands the entry back and removes it: the client owns the draft
  // from that point, so leaving a copy behind would duplicate it on the next save.
  app.post("/v0/stash/:id/restore", async (request, response, next) => {
    try {
      response.json({ entry: await drafts.removeStash(request.params.id) });
    } catch (error) { next(error); }
  });

  app.delete("/v0/stash/:id", async (request, response, next) => {
    try {
      await drafts.removeStash(request.params.id);
      response.status(204).end();
    } catch (error) { next(error); }
  });
}
