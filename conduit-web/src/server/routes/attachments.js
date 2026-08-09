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
}
