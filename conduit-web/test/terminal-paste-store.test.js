import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { TerminalPasteStore, sniffImage } from "../src/terminal-paste-store.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const GIF = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(64, 3)]);

const store = async (options = {}) => new TerminalPasteStore({
  root: path.join(await fs.mkdtemp(path.join(os.tmpdir(), "conduit-paste-")), "terminal-paste"),
  ...options,
});

test("a pasted PNG is spooled and its path returned", async () => {
  const pastes = await store();
  const spooled = await pastes.write(Readable.from([PNG]));
  assert.equal(spooled.type, "image/png");
  assert.equal(spooled.size, PNG.length);
  assert.equal(path.extname(spooled.name), ".png");
  assert.deepEqual(await fs.readFile(spooled.path), PNG);
});

test("the extension comes from the bytes, not from any supplied name", async () => {
  const pastes = await store();
  assert.equal(path.extname((await pastes.write(Readable.from([GIF]))).name), ".gif");
});

test("a spooled name never needs shell quoting", async () => {
  const pastes = await store();
  assert.match((await pastes.write(Readable.from([PNG]))).name, /^paste-[0-9T-]+-[0-9a-f]{6}\.png$/);
});

test("chunked bytes are identified across chunk boundaries", async () => {
  const pastes = await store();
  const chunks = [PNG.subarray(0, 3), PNG.subarray(3, 5), PNG.subarray(5)];
  assert.equal((await pastes.write(Readable.from(chunks))).type, "image/png");
});

test("data that is not a known image is refused and leaves nothing behind", async () => {
  const pastes = await store();
  await assert.rejects(pastes.write(Readable.from([Buffer.from("not an image at all")])), { code: "paste_unsupported_type" });
  assert.deepEqual(await fs.readdir(pastes.root), []);
});

test("an empty paste is refused", async () => {
  const pastes = await store();
  await assert.rejects(pastes.write(Readable.from([])), { code: "paste_empty" });
});

test("a paste over the size limit is refused and leaves nothing behind", async () => {
  const pastes = await store({ maxBytes: 32 });
  await assert.rejects(pastes.write(Readable.from([PNG])), { code: "paste_too_large" });
  assert.deepEqual(await fs.readdir(pastes.root), []);
});

test("pruning removes spooled pastes older than the retention window", async () => {
  const pastes = await store({ retentionMs: 60_000 });
  const stale = await pastes.write(Readable.from([PNG]));
  const fresh = await pastes.write(Readable.from([GIF]));
  const old = new Date(Date.now() - 120_000);
  await fs.utimes(stale.path, old, old);
  await pastes.prune();
  assert.deepEqual(await fs.readdir(pastes.root), [path.basename(fresh.path)]);
});

test("sniffing recognises each supported image and rejects the rest", () => {
  assert.equal(sniffImage(PNG).type, "image/png");
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])).type, "image/jpeg");
  assert.equal(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])).type, "image/webp");
  assert.equal(sniffImage(Buffer.alloc(12)), null);
});
