import fs from "node:fs/promises";
import path from "node:path";
import { SEEN_KEPT } from "./feeds.js";

/*
 * jbot's mailbox: the person's Gmail as gathered, in jbot's folder. Gathering is one thing and reading another, so any
 * routine can read the mail without depending on another routine's run or its commentary:
 *
 *   mail/<date>/<id>/     each email, as the mail pipeline keeps it (mail-pipeline.js)
 *   mail/index.jsonl      one line per email gathered: when, from, subject, labels, a line of what it says, its path
 *   mail/gmail.json       the gathering's own state: which messages are known, the Gmail accounts
 *
 * `gatherMail` fetches what is new into it (the email task does, whichever routine runs it); `mailSince` reads the
 * index from a time on, which is how each routine's email task shows it its own window: the heartbeat its hour, the
 * morning brief its day.
 */
const INDEX = path.join("mail", "index.jsonl");
const STATE = path.join("mail", "gmail.json");

const readJson = (file) => fs.readFile(file, "utf8").then(JSON.parse, () => null);

/** One gathering at a time in this process: two routines firing together must not fetch the same mail twice. */
let gathering = Promise.resolve();

/**
 * Fetch the new mail into the mailbox. `fetchNew(state)` runs the source and reads each email (mail-task.js), returning
 * `{ error } | { accounts, known, lines }`. `legacy` is a routine cursor from before the mailbox (its seen ids and
 * accounts), taken over once. The first gathering only learns what is there.
 */
export function gatherMail(agent, fetchNew, { legacy } = {}) {
  const run = gathering.then(async () => {
    const folder = agent.folder;
    const stateFile = path.join(folder, STATE);
    let state = await readJson(stateFile);
    if (!state && legacy?.primed) state = { primed: true, accounts: legacy.accounts || [], known: legacy.seen || [] };
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

/** The mailbox's lines gathered after `since` (an ISO time), oldest first. */
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
