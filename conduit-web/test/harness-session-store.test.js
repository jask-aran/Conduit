import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanSessionStore, readHeadRecords } from "../src/harnesses/session-store.js";

const write = async (file, records) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
};

// Claude Code and Pi both key sessions by a slug of the working directory. The
// slug cannot be reversed into a path, so cwd is read from the records.
const parse = (records, { file }) => {
  const header = records.find((record) => record.cwd);
  return header ? { id: header.sessionId, cwd: header.cwd, title: header.title || null, file } : null;
};

test("scanning a session store reads cwd from the records, not the folder name", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await write(path.join(root, "-home-jask-Conduit", "one.jsonl"),
    [{ sessionId: "one", cwd: "/home/jask/Conduit", title: "First" }, { text: "hi" }]);
  await write(path.join(root, "-home-jask-other", "two.jsonl"),
    [{ sessionId: "two", cwd: "/home/jask/other" }]);

  const threads = await scanSessionStore({ root, parse });
  assert.deepEqual(threads.map((thread) => thread.cwd).sort(), ["/home/jask/Conduit", "/home/jask/other"]);
  assert.equal(threads.find((thread) => thread.id === "one").title, "First");
  assert.ok(threads.every((thread) => thread.updatedAt > 0), "mtime supplies recency");

  const scoped = await scanSessionStore({ root, parse, cwd: "/home/jask/Conduit" });
  assert.deepEqual(scoped.map((thread) => thread.id), ["one"]);
});

test("a missing store, a non-session file and a corrupt line are all survivable", async (t) => {
  assert.deepEqual(await scanSessionStore({ root: "/nonexistent/store", parse }), []);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "-a-folder"), { recursive: true });
  await fs.writeFile(path.join(root, "-a-folder", "notes.txt"), "ignored");
  await fs.writeFile(path.join(root, "-a-folder", "broken.jsonl"), "{not json\n" + JSON.stringify({ sessionId: "ok", cwd: "/a" }) + "\n");
  await fs.writeFile(path.join(root, "-a-folder", "headerless.jsonl"), JSON.stringify({ text: "no cwd" }) + "\n");

  const threads = await scanSessionStore({ root, parse });
  assert.deepEqual(threads.map((thread) => thread.id), ["ok"], "only parseable sessions with a cwd are returned");
});

test("the newest sessions survive a capped scan", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const index of [0, 1, 2, 3]) {
    const file = path.join(root, "-a", `s${index}.jsonl`);
    await write(file, [{ sessionId: `s${index}`, cwd: "/a" }]);
    await fs.utimes(file, new Date(), new Date(2020, 0, index + 1));
  }
  const threads = await scanSessionStore({ root, parse, limit: 2 });
  assert.deepEqual(threads.map((thread) => thread.id), ["s3", "s2"]);
});

test("only the head of a large session is read", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "big.jsonl");
  const filler = Array.from({ length: 400 }, (_, index) => JSON.stringify({ index, pad: "x".repeat(300) }));
  await fs.writeFile(file, [JSON.stringify({ sessionId: "big", cwd: "/a" }), ...filler].join("\n") + "\n");
  const records = await readHeadRecords(file, 4096);
  assert.equal(records[0].sessionId, "big");
  assert.ok(records.length < 401, "the tail is not loaded");
  assert.deepEqual(await readHeadRecords("/nonexistent/file.jsonl"), []);
});
