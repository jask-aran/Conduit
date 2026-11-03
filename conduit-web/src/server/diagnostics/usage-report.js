import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const usageNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : 0;
const usageIdentifier = (value) => typeof value === "string" && /^[A-Za-z0-9_$.-]+$/.test(value) ? value : "unknown";

function readUsageRows(db, sql) {
  if (!db) return [];
  try { return db.prepare(sql).iterate(); }
  catch (error) {
    if (error.message.startsWith("no such table:")) return [];
    throw error;
  }
}

async function* usageLogRecords(file) {
  let text;
  try { text = await fs.readFile(file, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const line of text.split("\n")) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record && typeof record === "object" && !Array.isArray(record)) yield record;
  }
}

function foldUsageAgent(db) {
  let doc = {};
  for (const row of readUsageRows(db, `SELECT r.kind, r.content FROM documents d
    JOIN document_revisions r ON r.document_id = d.id
    WHERE d.kind = '"conduit.agent"' ORDER BY d.id, r.seq`)) {
    const value = JSON.parse(row.content);
    if (row.kind === "base") { doc = value; continue; }
    for (const [op, keys, value_] of value) {
      if (!["s", "d"].includes(op) || !keys.length) continue;
      let node = doc;
      for (const key of keys.slice(0, -1)) {
        if (node && typeof node === "object" && !Array.isArray(node)) {
          if (!Object.hasOwn(node, key)) Object.defineProperty(node, key, { value: {}, writable: true, configurable: true, enumerable: true });
          node = node[key];
        }
      }
      if (!node || typeof node !== "object" || Array.isArray(node)) continue;
      const key = keys.at(-1);
      if (op === "s") Object.defineProperty(node, key, { value: value_, writable: true, configurable: true, enumerable: true });
      else delete node[key];
    }
  }
  return doc;
}

/** Keep-warm's policy, numbers and ids only. */
function pickPolicy(policy) {
  const rates = policy.rates && typeof policy.rates === "object" ? { hit: usageNumber(policy.rates.hit), miss: usageNumber(policy.rates.miss) } : null;
  return { model: typeof policy.model === "string" && /^[A-Za-z0-9_./:-]+$/.test(policy.model) ? policy.model : "unknown",
    pings: usageNumber(policy.pings), ttlMs: usageNumber(policy.ttlMs) || null, intervalMs: usageNumber(policy.intervalMs) || null,
    ttlSource: ["declared", "assumed"].includes(policy.ttlSource) ? policy.ttlSource : null, gaps: usageNumber(policy.gaps), rates,
    reason: ["cache lifetime unknown", "no saving at this model's prices", "too few past wakes"].includes(policy.reason) ? policy.reason : null };
}

/** Content-free usage totals. Read the live database once; never copy or modify it. */
export async function usageReport({ dataRoot, hours = 24, now = Date.now() }) {
  const requested = Number(hours);
  hours = Math.min(720, Math.max(1, Number.isNaN(requested) ? 24 : requested));
  const from = now - hours * 3600000;
  const inWindow = (at) => at >= from && at <= now;
  const requests = { total: 0, byModel: [], afterGap: [], misses: [] };
  const keepWarm = { policy: null, pings: 0, pingHits: 0, pingCost: 0, lapses: 0, keptHits: 0, keptMisses: 0, coldMisses: 0, coldHits: 0, saved: 0, net: 0 };
  const approvals = {
    judged: 0, outcomes: { allow: 0, deny: 0, escalate: 0 }, sources: {},
    askedYou: 0, fromRuns: 0, waiting: 0, judgeMs: null,
    judgeCost: 0, perDecision: null, jbotCost: 0, jbotRequests: 0, share: null, byAction: [],
  };
  let db;
  try {
    // Check existence first: a new hub can have approval files without a runtime DB.
    let exists = true;
    try { await fs.access(path.join(dataRoot, "runtime", "conduit-runtime.sqlite")); }
    catch (error) { if (error.code !== "ENOENT") throw error; exists = false; }
    if (exists) db = new DatabaseSync(path.join(dataRoot, "runtime", "conduit-runtime.sqlite"), { readOnly: true });

    const doc = foldUsageAgent(db);
    const home = doc.home?.conversationId;
    const jbot = new Set(home == null ? [] : [String(home)]);
    const children = new Map();
    for (const row of readUsageRows(db, "SELECT id, owner_conversation_id FROM conversations")) {
      const owner = String(row.owner_conversation_id);
      if (!children.has(owner)) children.set(owner, []);
      children.get(owner).push(String(row.id));
    }
    for (const owner of jbot) for (const child of children.get(owner) || []) jbot.add(child);
    for (const ask of Object.values(doc.asks || {})) {
      if (!ask || !inWindow(Date.parse(ask.createdAt))) continue;
      approvals.askedYou++;
      if (ask.run) approvals.fromRuns++;
      if (ask.status === "pending" && !(Date.parse(ask.expiresAt) <= now)) approvals.waiting++;
    }

    const sessions = new Map();
    for (const row of readUsageRows(db, `SELECT d.owner_id, r.content FROM documents d
      JOIN document_revisions r ON r.document_id = d.id WHERE d.kind = '"pi.provider"'`)) {
      const session = JSON.parse(row.content).sessionId;
      if (typeof session === "string") sessions.set(session, String(row.owner_id));
    }
    const watched = new Map();
    const pings = [];
    for await (const record of usageLogRecords(path.join(dataRoot, "runtime", "prefix-watch.jsonl"))) {
      // Keep-warm's own lines (keep-warm.js): the policy it chose, and each ping with what it read and cost.
      if (record.keepWarmPolicy && typeof record.keepWarmPolicy === "object") keepWarm.policy = { at: record.t, ...pickPolicy(record.keepWarmPolicy) };
      if (Number.isFinite(record.keepWarm) && typeof record.key === "string") pings.push({ at: Date.parse(record.t), key: record.key,
        input: usageNumber(record.input), cacheRead: usageNumber(record.cacheRead), cost: usageNumber(record.cost) });
      if (record.warm || typeof record.key !== "string") continue;
      const at = Date.parse(record.t);
      if (!Number.isFinite(at)) continue;
      const cid = sessions.get(record.key) ?? [...sessions].find(([key]) => key.startsWith(record.key))?.[1];
      if (cid == null) continue;
      if (!watched.has(cid)) watched.set(cid, []);
      // Drop divergence content immediately; only the category can leave this module.
      watched.get(cid).push({ at, why: record.diverged == null ? "provider" : "changed" });
    }

    const pingsOf = new Map();
    for (const ping of pings) {
      const cid = sessions.get(ping.key) ?? [...sessions].find(([key]) => key.startsWith(ping.key))?.[1];
      if (cid == null) continue;
      if (!pingsOf.has(cid)) pingsOf.set(cid, []);
      pingsOf.get(cid).push(ping);
      if (!inWindow(ping.at)) continue;
      keepWarm.pings++;
      keepWarm.pingHits += Number(ping.cacheRead >= 0.5 * ping.input && ping.input > 0);
      keepWarm.pingCost += ping.cost;
    }
    const ttlMs = keepWarm.policy?.ttlMs || 30 * 60_000;
    const rates = keepWarm.policy?.rates || null;
    const previous = new Map();
    const models = new Map();
    const gaps = [[5, 30], [30, 60], [60, 240], [240, null]]
      .map(([fromMinutes, toMinutes]) => ({ fromMinutes, toMinutes, requests: 0, misses: 0 }));
    for (const row of readUsageRows(db, `SELECT conversation_id, record FROM entries
      WHERE json_extract(record, '$.kind') = 'pi.assistant' ORDER BY rowid`)) {
      const cid = String(row.conversation_id);
      const record = JSON.parse(row.record);
      const modelMessage = Array.isArray(record.model) ? record.model[0] || {} : {};
      const message = Array.isArray(record.model) ? modelMessage : record.message || {};
      // The reference counts jbot's model records even when they have no usage.
      if (jbot.has(cid) && inWindow(usageNumber(modelMessage.timestamp))) {
        approvals.jbotCost += usageNumber(modelMessage.usage?.cost?.total);
        approvals.jbotRequests++;
      }
      const usage = message.usage;
      if (!usage || !Object.keys(usage).length) continue;
      const at = usageNumber(message.timestamp);
      const input = usageNumber(usage.input);
      const cacheRead = usageNumber(usage.cacheRead);
      const prior = previous.get(cid);
      const gapMinutes = prior ? (at - prior.at) / 60000 : null;
      const miss = Boolean(prior && prior.total > 2048 && cacheRead < 0.5 * prior.total);
      previous.set(cid, { at, total: input + cacheRead + usageNumber(usage.cacheWrite) });
      if (!inWindow(at)) continue;
      const model = `${usageIdentifier(message.provider)}/${typeof message.model === "string" && /^[A-Za-z0-9_./:-]+$/.test(message.model) ? message.model : "unknown"}`;
      if (!models.has(model)) models.set(model, { model, requests: 0, input: 0, cacheRead: 0, cachedShare: 0, misses: 0, survivedMinutes: null, lapsedMinutes: null,
        afterGap: gaps.map(({ fromMinutes, toMinutes }) => ({ fromMinutes, toMinutes, requests: 0, misses: 0 })) });
      const group = models.get(model);
      requests.total++;
      group.requests++;
      group.input += input;
      group.cacheRead += cacheRead;
      group.misses += Number(miss);
      if (gapMinutes > 5) {
        const bucket = gaps.find((bucket) => gapMinutes >= bucket.fromMinutes && (bucket.toMinutes == null || gapMinutes < bucket.toMinutes));
        bucket.requests++;
        bucket.misses += Number(miss);
        const own = group.afterGap[gaps.indexOf(bucket)];
        own.requests++;
        own.misses += Number(miss);
      }
      // The provider's cache lifetime as seen: the longest pause a cache survived (a keep-warm ping in it does not
      // count) and the shortest one it did not, a miss the prefix log puts on the provider.
      const pinged = prior && (pingsOf.get(cid) || []).some((ping) => ping.at > prior.at && ping.at < at);
      if (prior && prior.total > 2048 && gapMinutes > 5 && !pinged) {
        const why = miss ? watched.get(cid)?.findLast((entry) => entry.at <= at + 1000)?.why : null;
        if (!miss) group.survivedMinutes = Math.max(group.survivedMinutes ?? 0, gapMinutes);
        else if (why === "provider") group.lapsedMinutes = Math.min(group.lapsedMinutes ?? Infinity, gapMinutes);
      }
      // A wake of the home thread after its cache would have lapsed: kept warm by a ping since its last request, or not.
      if (cid === String(home) && prior && at - prior.at > ttlMs) {
        const kept = (pingsOf.get(cid) || []).some((ping) => ping.at > prior.at && ping.at < at);
        keepWarm.lapses++;
        if (kept) keepWarm[miss ? "keptMisses" : "keptHits"]++;
        else keepWarm[miss ? "coldMisses" : "coldHits"]++;
        if (kept && !miss && rates) keepWarm.saved += cacheRead * Math.max(0, usageNumber(rates.miss) - usageNumber(rates.hit)) / 1e6;
      }
      if (miss) {
        // Match the reference's last eligible log entry in file order, with a 1 s tolerance.
        const near = watched.get(cid)?.findLast((entry) => entry.at <= at + 1000);
        requests.misses.push({ at: new Date(at).toISOString(),
          role: cid === String(home) ? "jbot-home" : jbot.has(cid) ? "jbot-run" : "chat",
          model, gapMinutes, input, cacheRead, why: near?.why || "unlogged" });
      }
    }
    keepWarm.net = keepWarm.saved - keepWarm.pingCost;
    requests.byModel = [...models.values()].sort((a, b) => b.requests - a.requests);
    for (const group of requests.byModel) {
      group.cachedShare = group.cacheRead / Math.max(1, group.input + group.cacheRead);
      group.afterGap = group.afterGap.filter((bucket) => bucket.requests);
    }
    requests.afterGap = gaps.filter((bucket) => bucket.requests);
  } finally { db?.close(); }

  const dir = path.join(dataRoot, "agent", "approvals");
  const files = await fs.readdir(dir).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
  const dates = [new Date(from).toISOString().slice(0, 10), new Date(now).toISOString().slice(0, 10)];
  const times = [];
  const actions = new Map();
  for (const file of files.sort()) {
    const date = /^approvals-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file)?.[1];
    if (!date || date < dates[0] || date > dates[1]) continue;
    for await (const decision of usageLogRecords(path.join(dir, file))) {
      const outcome = decision.verdict?.outcome;
      if (!inWindow(Date.parse(decision.at)) || !Object.hasOwn(approvals.outcomes, outcome)) continue;
      approvals.judged++;
      approvals.outcomes[outcome]++;
      const source = ["model", "cache", "exact", "breaker", "fallback", "rule-of-two"].includes(decision.verdict.source) ? decision.verdict.source : "unknown";
      approvals.sources[source] = (approvals.sources[source] || 0) + 1;
      times.push(usageNumber(decision.ms));
      approvals.judgeCost += usageNumber(decision.usage?.cost?.total);
      const action = usageIdentifier(decision.held?.action);
      if (!actions.has(action)) actions.set(action, { action, allow: 0, deny: 0, escalate: 0 });
      actions.get(action)[outcome]++;
    }
  }
  if (times.length) {
    times.sort((a, b) => a - b);
    approvals.judgeMs = { median: times[Math.floor(times.length / 2)], max: times.at(-1) };
    approvals.perDecision = approvals.judgeCost / approvals.judged;
  }
  approvals.share = approvals.jbotCost ? approvals.judgeCost / approvals.jbotCost : null;
  const count = (action) => action.allow + action.deny + action.escalate;
  approvals.byAction = [...actions.values()].sort((a, b) => count(b) - count(a)).slice(0, 8);
  return { window: { hours, from: new Date(from).toISOString(), to: new Date(now).toISOString() }, requests, keepWarm, approvals };
}
