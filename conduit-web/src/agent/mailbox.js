import fs from "node:fs/promises";
import path from "node:path";
import { SEEN_KEPT } from "./feeds.js";

/* Gathering is one thing and reading another, so any routine can read the mail without depending on another's run. */
const INDEX = path.join("mail", "index.jsonl");
const STATE = path.join("mail", "gmail.json");

const readJson = (file) => fs.readFile(file, "utf8").then(JSON.parse, () => null);

/** One gathering at a time in this process: two routines firing together must not fetch the same mail twice. */
let gathering = Promise.resolve();

/** `fetchNew(state)` returns `{ error } | { accounts, known, lines }`. */
export function gatherMail(agent, fetchNew) {
  const run = gathering.then(async () => {
    const folder = agent.folder;
    const stateFile = path.join(folder, STATE);
    let state = await readJson(stateFile);
    state ||= { primed: false, accounts: [], known: [] };
    const got = await fetchNew(state);
    if (got.error) return { error: got.error, added: 0 };
    const next = { primed: true, accounts: got.accounts || state.accounts,
      known: [...new Set([...got.known, ...state.known])].slice(0, SEEN_KEPT) };
    await fs.mkdir(path.join(folder, "mail"), { recursive: true });
    const lines = state.primed ? got.lines : [];
    if (lines.length) await fs.appendFile(path.join(folder, INDEX), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    await fs.writeFile(stateFile, `${JSON.stringify(next, null, 2)}\n`);
    return { added: lines.length, first: !state.primed };
  });
  gathering = run.catch(() => {});
  return run;
}

export async function mailSince(agent, since) {
  const text = await fs.readFile(path.join(agent.folder, INDEX), "utf8").catch(() => "");
  const after = Date.parse(since || "") || 0;
  const seen = new Set();
  const lines = [];
  for (const row of text.split("\n")) {
    if (!row.trim()) continue;
    let line;
    try { line = JSON.parse(row); } catch { continue; }
    if (Date.parse(line.gathered) <= after || seen.has(line.id)) continue;
    seen.add(line.id);
    lines.push(line);
  }
  return lines;
}
