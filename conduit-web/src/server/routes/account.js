import express from "express";
import fs from "node:fs/promises";
import path from "node:path";

const TYPES = new Set(["image/webp", "image/png", "image/jpeg"]);
const MAX = 512 * 1024;

export function registerAccountRoutes(app, { dataRoot }) {
  const dir = path.join(dataRoot, "account");
  const file = path.join(dir, "picture");
  const typeFile = path.join(dir, "picture.type");
  const stat = () => fs.stat(file).catch(() => null);

  app.get("/v0/account", async (_request, response, next) => {
    const found = await stat(); response.json({ picture: found ? String(Math.round(found.mtimeMs)) : null });
  });
  app.get("/v0/account/picture", async (_request, response) => {
    if (!await stat()) return response.status(404).json({ error: "no_picture" });
    const type = (await fs.readFile(typeFile, "utf8").catch(() => "image/webp")).trim();
    response.set({ "content-type": TYPES.has(type) ? type : "image/webp", "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
    response.send(await fs.readFile(file));
  });
  app.put("/v0/account/picture", express.raw({ type: [...TYPES], limit: MAX }), async (request, response) => {
    const type = String(request.headers["content-type"] || "").split(";")[0].trim();
    if (!TYPES.has(type) || !Buffer.isBuffer(request.body) || !request.body.length) return response.status(400).json({ error: "invalid_picture" });
    await fs.mkdir(dir, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, request.body);
    await fs.writeFile(typeFile, type);
    await fs.rename(temp, file);
    const found = await stat();
    response.json({ picture: String(Math.round(found.mtimeMs)) });
  });
  app.delete("/v0/account/picture", async (_request, response, next) => {
    await fs.rm(file, { force: true }); await fs.rm(typeFile, { force: true }); response.json({ picture: null });
  });
}
