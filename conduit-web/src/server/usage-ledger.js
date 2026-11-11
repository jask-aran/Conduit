import fs from "node:fs";
import path from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { UsageDoc } from "@earendil-works/pi-durable";

/*
 * Append-only, never rewritten. pi-durable's usage totals only grow, so the ledger appends the difference from the last
 * totals it saw: nothing counts twice, and a line lost to a crash is caught at that conversation's next change. The
 * dollars are stored, not the rates, so a later price change never touches a line already written.
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
      if (text && !text.endsWith("\n")) await fs.promises.appendFile(this.file, "\n");
      for (const line of text.split("\n")) {
        if (!line) continue;
        let item;
        // A line cut off by a crash is skipped; the next change of its conversation carries what it held.
        try { item = JSON.parse(line); } catch { continue; }
        this.apply(item);
      }
    } else {
      // What was spent before the ledger existed is not today's.
      this.append({ t: "start", at: this.now().toISOString() });
      let cursor;
      do {
        const page = await this.harness.storage.scanConversations({}, 200, cursor, BACKGROUND_CONTEXT);
        for (const { id } of page.items) {
          for (const [key, value] of this.totals(await this.harness.snapshot(UsageDoc, id, BACKGROUND_CONTEXT))) {
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

  // `subagent` repeats the child conversation's own model spend, counted there.
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
