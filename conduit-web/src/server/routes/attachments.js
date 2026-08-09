import { readAnnouncedAttachmentIds } from "../../session-store.js";

export function registerAttachmentRoutes(app, { attachments, findChatContext }) {
  app.put("/v0/chats/:chatId/attachments/:attachmentId", async (request, response, next) => {
    try {
      const contentLength = Number(request.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > attachments.maxBytes) {
        return response.status(413).json({ error: "attachment_too_large", message: `Attachment exceeds the ${attachments.maxBytes} byte limit`, maxBytes: attachments.maxBytes });
      }
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const attachment = await attachments.write(
        context.project,
        context.chat.id,
        request.params.attachmentId,
        request.query.name,
        request,
      );
      response.status(201).json(attachment);
    } catch (error) {
      if (error.code === "EEXIST") return response.status(409).json({ error: "attachment_exists" });
      next(error);
    }
  });

  app.get("/v0/chats/:chatId/attachments", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      let announced = new Set();
      if (context.chat.piSessionFile) {
        try { announced = await readAnnouncedAttachmentIds(context.chat.piSessionFile, context.project); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      response.json({ attachments: (await attachments.list(context.project, context.chat.id))
        .map((attachment) => ({ ...attachment, announced: announced.has(attachment.id) })) });
    } catch (error) { next(error); }
  });

  app.get("/v0/chats/:chatId/attachments/:attachmentId", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const attachment = await attachments.open(context.project, context.chat.id, request.params.attachmentId);
      if (!attachment) return response.status(404).json({ error: "attachment_not_found" });
      const preview = request.query.preview === "1" && /^image\/(png|jpeg|gif|webp)$/.test(attachment.type);
      response.setHeader("Content-Type", preview ? attachment.type : "application/octet-stream");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cache-Control", "private, no-cache");
      const downloadName = encodeURIComponent(attachment.name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      response.setHeader("Content-Disposition", `${preview ? "inline" : "attachment"}; filename*=UTF-8''${downloadName}`);
      response.setHeader("Content-Length", attachment.size);
      const stream = attachment.stream();
      stream.once("error", next);
      stream.pipe(response);
    } catch (error) { next(error); }
  });

  app.delete("/v0/chats/:chatId/attachments/:attachmentId", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const removed = await attachments.delete(context.project, context.chat.id, request.params.attachmentId);
      response.status(removed ? 204 : 404).end();
    } catch (error) { next(error); }
  });
}
