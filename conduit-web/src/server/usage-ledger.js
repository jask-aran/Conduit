import fs from "node:fs";
import path from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { UsageDoc } from "@earendil-works/pi-durable";

/*
 * The usage ledger (Settings › System › Usage, roadmap #15): what Conduit's own agents spent, per local day, in tokens
 * and API-equivalent dollars. Append-only: data/usage/ledger.jsonl, a line per change, never rewritten.
 *
 * Source: pi-durable's `pi.usage`, each conversation's running totals per `provider/model` (every reply, failed
 * attempts, compaction summaries) and per tool (a nested model call's spend, such as codemode's models.classify).
 * The ledger knows the last totals it saw per conversation and appends only the difference. The totals only grow (a
 * fork starts at zero), so the difference is exactly what was spent since: nothing counts twice, and a line lost to
 * a crash is caught at that conversation's next change. `tools.subagent` is left out: it repeats the child
 * conversation's own model spend, counted there.
 *
 * API-equivalent cost, fixed when spent: the dollars pi-ai priced the call at, from its model catalogue's list price
 * for that provider and model (subscription providers such as openai-codex and github-copilot carry the API's prices;
 * what it lists at zero is free tiers and flat token plans). Later price changes never touch a line already written:
 * the dollars are stored, not the rates. Only Conduit's own agents (pi-durable) are counted; other harnesses (Codex,
 * Claude Code, ChatGPT Web) keep their own accounts.
 *
 * Lines (`v`: [input, output, cacheRead, cacheWrite, cost]):
 *   { t: "base", c, k, v }          totals already spent when first seen (the ledger's start, or a total that fell)
 *   { t: "spend", d, c, k, v }      spent on day `d` (YYYY-MM-DD, the hub's local day) by conversation `c`, key `k`
 *   { t: "reply", d, tools? }       a reply, with the tools it called by name
 * Loading replays them: `base` and `spend` rebuild the last totals seen, `spend` and `reply` the days.
 */
const day = (at = new Date()) => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
const vector = (usage) => [...["input", "output", "cacheRead", "cacheWrite"].map((field) => Number(usage?.[field]) || 0), Number(usage?.cost?.total) || 0];
const add = (into, value) => value.map((item, index) => (into?.[index] || 0) + item);

export class UsageLedger {
  constructor({ file, harness, now = () => new Date() }) {
    this.file = file;
    this.harness = harness;
    this.now = now;
    this.since = null;
    this.seen = new Map();
    this.state = { days: {} };
    this.pending = [];
  }

  static async open(options) {
    const ledger = new UsageLedger(options);
    await ledger.load();
    return ledger;
  }

  async load() {
    const text = await fs.promises.readFile(this.file, "utf8").catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (text !== null) {
      // Cut off mid-line: what follows starts on a line of its own.
      if (text && !text.endsWith("\n")) await fs.promises.appendFile(this.file, "\n");
      for (const line of text.split("\n")) {
        if (!line) continue;
        let item;
        // A line cut off by a crash is skipped; the next change of its conversation carries what it held.
        try { item = JSON.parse(line); } catch { continue; }
        this.apply(item);
      }
    } else {
      // New: what was spent before now is not today's. Every conversation's totals so far are the starting point.
      this.append({ t: "start", at: this.now().toISOString() });
      let cursor;
      do {
        const page = await this.harness.storage.scanConversations({}, 200, cursor, BACKGROUND_CONTEXT);
        for (const { id } of page.items) {
          for (const [key, value] of this.totals(await this.harness.snapshot(UsageDoc, id, BACKGROUND_CONTEXT))) {
            // Nothing spent needs no line: a conversation with none starts from zero.
            if (value.some(Boolean)) this.append({ t: "base", c: String(id), k: key, v: value });
          }
        }
        cursor = page.next;
      } while (cursor);
      await this.flush();
    }
    // Read first, then followed: a change between the two is caught at that conversation's next one.
    this.unsubscribe = this.harness.subscribeCommits((publication) => {
      try { this.observe(publication.changes); } catch (error) { console.error("[usage] ledger not updated", error); }
    });
  }

  close() {
    this.unsubscribe?.();
    return this.flush();
  }

  /** A line's effect on what is known: the totals seen, and the days. */
  apply(item) {
    if (item.t === "start") this.since ||= item.at;
    else if (item.t === "base") this.seenOf(item.c).set(item.k, item.v);
    else if (item.t === "spend") {
      const seen = this.seenOf(item.c);
      seen.set(item.k, add(seen.get(item.k), item.v));
      const row = this.days(item.d).models;
      row[item.k] = add(row[item.k], item.v);
    } else if (item.t === "reply") {
      const record = this.days(item.d);
      record.replies += 1;
      for (const [name, calls] of Object.entries(item.tools || {})) record.tools[name] = (record.tools[name] || 0) + calls;
    }
  }

  append(item) {
    this.apply(item);
    this.pending.push(JSON.stringify(item));
    // Appended together once the commit's lines are in: one write per commit at most.
    if (this.pending.length === 1) queueMicrotask(() => void this.flush());
  }

  flush() {
    if (!this.pending.length) return this.writing || Promise.resolve();
    const text = `${this.pending.join("\n")}\n`;
    this.pending = [];
    this.writing = (this.writing || Promise.resolve()).then(async () => {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.appendFile(this.file, text);
    }).catch((error) => console.error("[usage] ledger not saved", error));
    return this.writing;
  }

  seenOf(conversationId) {
    if (!this.seen.has(conversationId)) this.seen.set(conversationId, new Map());
    return this.seen.get(conversationId);
  }

  /** A `pi.usage` state as [key, vector] pairs: its models, and its tools other than `subagent`. */
  totals(state) {
    return [...Object.entries(state?.models || {}).map(([key, usage]) => [key, vector(usage)]),
      ...Object.entries(state?.tools || {}).filter(([name]) => name !== "subagent").map(([name, usage]) => [`tool:${name}`, vector(usage)])];
  }

  observe(changes) {
    const today = this.day();
    for (const change of changes) {
      if (change.type === "document" && change.record?.kind === UsageDoc.definition.kind && change.value) {
        const conversationId = String(change.conversationId);
        const seen = this.seenOf(conversationId);
        for (const [key, now] of this.totals(change.value)) {
          const was = seen.get(key) || [0, 0, 0, 0, 0];
          const delta = now.map((value, index) => value - was[index]);
          if (delta.every((value) => value === 0)) continue;
          // Totals only grow; one that fell was replaced, and is a new starting point rather than spend.
          if (delta.some((value) => value < 0)) this.append({ t: "base", c: conversationId, k: key, v: now });
          else this.append({ t: "spend", d: today, c: conversationId, k: key, v: delta });
        }
      }
      if (change.type === "entry" && change.value?.kind === "pi.assistant") {
        const tools = {};
        for (const part of change.value.model?.[0]?.content || []) {
          if (part?.type === "toolCall" && part.name) tools[part.name] = (tools[part.name] || 0) + 1;
        }
        this.append({ t: "reply", d: today, ...(Object.keys(tools).length ? { tools } : {}) });
      }
    }
  }

  days(date) {
    return this.state.days[date] ||= { replies: 0, models: {}, tools: {} };
  }

  day() { return day(this.now()); }

  /** The last `count` days (today included, oldest first), each with its totals; days with nothing are kept. */
  view(count = 30) {
    const out = [];
    const end = this.now();
    for (let back = count - 1; back >= 0; back -= 1) {
      const at = new Date(end.getFullYear(), end.getMonth(), end.getDate() - back);
      const date = day(at);
      const record = this.state.days[date] || { replies: 0, models: {}, tools: {} };
      const models = Object.entries(record.models).map(([key, [input, output, cacheRead, cacheWrite, cost]]) => ({ key, input, output, cacheRead, cacheWrite, cost }));
      out.push({
        date, replies: record.replies, tools: record.tools, models,
        cost: models.reduce((sum, row) => sum + row.cost, 0),
        tokens: models.reduce((sum, row) => sum + row.input + row.output + row.cacheRead + row.cacheWrite, 0),
      });
    }
    return { since: this.since, days: out };
  }
}
