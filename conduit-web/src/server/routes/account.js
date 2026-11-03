import express from "express";
import fs from "node:fs/promises";
import path from "node:path";

/*
 * The hub account's picture (Settings › Account): one image the person chose, kept as the client made it (a square,
 * small, WebP or PNG) at data/account/picture. Behind the hub's sign-in like every /v0 route.
 *   GET    /v0/account/picture  the image (404: none; the app draws the name's initials instead)
 *   PUT    /v0/account/picture  body: the image (image/webp | image/png | image/jpeg), at most 512 KB
 *   DELETE /v0/account/picture  back to the initials
 * GET /v0/account says whether there is one and its version (for the image's address, so a change shows at once).
 */
const TYPES = new Set(["image/webp", "image/png", "image/jpeg"]);
const MAX = 512 * 1024;

export function registerAccountRoutes(app, { dataRoot }) {
  const dir = path.join(dataRoot, "account");
  const file = path.join(dir, "picture");
  const typeFile = path.join(dir, "picture.type");
  const stat = () => fs.stat(file).catch(() => null);

  app.get("/v0/account", async (_request, response, next) => {
    try { const found = await stat(); response.json({ picture: found ? String(Math.round(found.mtimeMs)) : null }); }
    catch (error) { next(error); }
  });
  app.get("/v0/account/picture", async (_request, response, next) => {
    try {
      if (!await stat()) return response.status(404).json({ error: "no_picture" });
      const type = (await fs.readFile(typeFile, "utf8").catch(() => "image/webp")).trim();
      response.set({ "content-type": TYPES.has(type) ? type : "image/webp", "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
      response.send(await fs.readFile(file));
    } catch (error) { next(error); }
  });
  app.put("/v0/account/picture", express.raw({ type: [...TYPES], limit: MAX }), async (request, response, next) => {
    try {
      const type = String(request.headers["content-type"] || "").split(";")[0].trim();
      if (!TYPES.has(type) || !Buffer.isBuffer(request.body) || !request.body.length) return response.status(400).json({ error: "invalid_picture" });
      await fs.mkdir(dir, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temp, request.body);
      await fs.writeFile(typeFile, type);
      await fs.rename(temp, file);
      const found = await stat();
      response.json({ picture: String(Math.round(found.mtimeMs)) });
    } catch (error) { next(error); }
  });
  app.delete("/v0/account/picture", async (_request, response, next) => {
    try { await fs.rm(file, { force: true }); await fs.rm(typeFile, { force: true }); response.json({ picture: null }); }
    catch (error) { next(error); }
  });
}
