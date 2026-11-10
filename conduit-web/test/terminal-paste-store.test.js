import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { TerminalPasteStore } from "../src/terminal-paste-store.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

const store = async (options = {}) => new TerminalPasteStore({
  root: path.join(await fs.mkdtemp(path.join(os.tmpdir(), "conduit-paste-")), "terminal-paste"),
  ...options,
});

test("a spooled name never needs shell quoting", async () => {
  const pastes = await store();
  assert.match((await pastes.write(Readable.from([PNG]))).name, /^paste-[0-9T-]+-[0-9a-f]{6}\.png$/);
});

test("data that is not a known image is refused and leaves nothing behind", async () => {
  const pastes = await store();
  await assert.rejects(pastes.write(Readable.from([Buffer.from("not an image at all")])), { code: "paste_unsupported_type" });
  assert.deepEqual(await fs.readdir(pastes.root), []);
});

test("a paste over the size limit is refused and leaves nothing behind", async () => {
  const pastes = await store({ maxBytes: 32 });
  await assert.rejects(pastes.write(Readable.from([PNG])), { code: "paste_too_large" });
  assert.deepEqual(await fs.readdir(pastes.root), []);
});
