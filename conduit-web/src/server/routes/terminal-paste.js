export function registerTerminalPasteRoutes(app, { terminalPastes }) {
  app.post("/v0/terminal-paste", async (request, response, next) => {
    try {
      const contentLength = Number(request.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > terminalPastes.maxBytes) {
        return response.status(413).json({ error: "paste_too_large", message: `Pasted image exceeds the ${terminalPastes.maxBytes} byte limit`, maxBytes: terminalPastes.maxBytes });
      }
      const spooled = await terminalPastes.write(request);
      response.status(201).json(spooled);
    } catch (error) {
      if (error.status) return response.status(error.status).json({ error: error.code, message: error.message });
      next(error);
    }
  });
}
