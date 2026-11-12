import fs from "node:fs/promises";
import path from "node:path";
import express from "express";

/*
 * /document's one page (client/document/document-scratch.tsx), kept as a file so the session a comment is handed to
 * can write in it as well as read it. Temporary, like the page: one file, the last writer wins.
 */
export function registerDocumentScratch(app, dataRoot) {
  const file = path.join(dataRoot, "documents", "scratch.md");
  const read = async () => {
    const text = await fs.readFile(file, "utf8").catch(() => null);
    return { file, text, version: text === null ? null : (await fs.stat(file)).mtimeMs };
  };
  app.get("/v0/document/scratch", async (_request, response) => response.json(await read()));
  app.put("/v0/document/scratch", express.json({ limit: "2mb" }), async (request, response) => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(file, String(request.body?.text ?? ""));
    response.json(await read());
  });
}
