import { DatabaseSync } from "node:sqlite";

/*
 * A ping costs a cached read of the prompt and a wake after the cache lapsed a full read, so the policy picks the number
 * of pings after a request that would have cost least over the home thread's past gaps.
 */

const ASSUMED_TTL_SECONDS = {
  // Sign in with ChatGPT and API keys alike: GPT-5.6 and later keep "long" retention 30 minutes.
  openai: 1800,
};
const MOST_PINGS = 48;
const FEWEST_GAPS = 5;

function cacheLifetime(model, retention = "long", observedMs = 0) {
  const declared = model?.promptCache?.[retention] ?? model?.promptCache?.short;
  if (declared > 0) return { ms: declared * 1000, source: "declared" };
  const assumed = (ASSUMED_TTL_SECONDS[model?.provider] || 0) * 1000;
  if (observedMs > assumed) return { ms: observedMs, source: "observed" };
  return assumed ? { ms: assumed, source: "assumed" } : null;
}

/**
 * Per token of prompt: a ping and a wake that finds the cache cost the cached rate, a wake after it lapsed the full one
 * (its write rate where the provider charges writes). With `pings` pings the cache lives until pings * interval + ttl.
 */
export function keepWarmPolicy({ model, retention = "long", gaps: past, survivedMs = 0 }) {
  // Gaps with a ping in them are not the provider's.
  const ttl = cacheLifetime(model, retention, survivedMs || reliableLifetime(past.filter((gap) => !gap.pinged)));
  const gaps = past.map((gap) => gap.ms);
  const hit = Number(model?.cost?.cacheRead) || 0;
  // A provider that declares its cache lifetimes charges writes (Anthropic); OpenAI's catalogue lists a write price it
  // never bills, so there a miss is a plain input read.
  const miss = Math.max(Number(model?.cost?.input) || 0, model?.promptCache ? Number(model?.cost?.cacheWrite) || 0 : 0);
  if (!ttl || !(miss > hit)) return { pings: 0, ttlMs: ttl?.ms ?? null, ttlSource: ttl?.source ?? null, intervalMs: null, rates: { hit, miss }, gaps: gaps.length, reason: ttl ? "no saving at this model's prices" : "cache lifetime unknown" };
  const intervalMs = Math.round(ttl.ms * 0.9);
  const priced = (pings) => gaps.reduce((sum, gap) => sum + Math.min(pings, Math.floor(gap / intervalMs)) * hit + (gap <= pings * intervalMs + ttl.ms ? hit : miss), 0);
  let best = 0;
  if (gaps.length >= FEWEST_GAPS) for (let pings = 1, least = priced(0); pings <= MOST_PINGS; pings++) {
    const cost = priced(pings);
    if (cost < least) { least = cost; best = pings; }
  }
  return { pings: best, ttlMs: ttl.ms, ttlSource: ttl.source, intervalMs, rates: { hit, miss }, gaps: gaps.length,
    ...(gaps.length < FEWEST_GAPS ? { reason: "too few past wakes" } : {}) };
}

// Prompts under 2048 tokens are not cached.
export function requestGaps(file, conversationId, days = 14, pinged = []) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const since = Date.now() - days * 86_400_000;
    const gaps = [];
    let prior = null;
    for (const row of db.prepare(`SELECT record FROM entries WHERE conversation_id = ? AND json_extract(record, '$.kind') = 'pi.assistant' ORDER BY rowid`).iterate(conversationId)) {
      const record = JSON.parse(row.record);
      const message = (Array.isArray(record.model) ? record.model[0] : record.message) || {};
      const at = Number(message.timestamp);
      const usage = message.usage || {};
      const total = (Number(usage.input) || 0) + (Number(usage.cacheRead) || 0) + (Number(usage.cacheWrite) || 0);
      if (!Number.isFinite(at) || !total) continue;
      if (prior && at >= since && at >= prior.at && prior.total > 2048) {
        gaps.push({ ms: at - prior.at, hit: (Number(usage.cacheRead) || 0) >= 0.5 * prior.total, pinged: (pinged || []).some((ping) => ping > prior.at && ping < at) });
      }
      prior = { at, total };
    }
    return gaps;
  } catch { return []; } finally { db?.close(); }
}

/** How often a pause up to the lifetime must have kept the cache for that lifetime to count as one. */
const RELIABLE = 0.75;
const FEWEST_PAUSES = 5;

/**
 * A provider's cache does not end at a fixed time, so the longest pause survived is luck and pings timed from it arrive
 * after the cache has gone. Pauses under ten minutes say nothing about the lifetime.
 */
function reliableLifetime(pauses) {
  const long = pauses.filter((pause) => pause.ms >= 600_000).sort((a, b) => a.ms - b.ms);
  if (long.length < FEWEST_PAUSES) return Math.max(0, ...long.filter((pause) => pause.hit).map((pause) => pause.ms));
  let hits = 0, lifetime = 0;
  long.forEach((pause, index) => {
    if (pause.hit) hits++;
    if (pause.hit && hits / (index + 1) >= RELIABLE) lifetime = pause.ms;
  });
  return lifetime;
}

export function survivedLifetime(file, model, days = 14, pingedConversation = null, pinged = []) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const since = Date.now() - days * 86_400_000;
    const prior = new Map();
    const pauses = [];
    for (const row of db.prepare(`SELECT conversation_id, record FROM entries WHERE json_extract(record, '$.kind') = 'pi.assistant' ORDER BY rowid`).iterate()) {
      const record = JSON.parse(row.record);
      const message = (Array.isArray(record.model) ? record.model[0] : record.message) || {};
      const usage = message.usage || {};
      const at = Number(message.timestamp);
      const total = (Number(usage.input) || 0) + (Number(usage.cacheRead) || 0) + (Number(usage.cacheWrite) || 0);
      if (!Number.isFinite(at) || !total) continue;
      const cid = String(row.conversation_id);
      const before = prior.get(cid);
      prior.set(cid, { at, total });
      if (!before || at < since || message.provider !== model?.provider || message.model !== model?.id || before.total <= 2048) continue;
      if (cid === String(pingedConversation) && pinged.some((ping) => ping > before.at && ping < at)) continue;
      pauses.push({ ms: at - before.at, hit: (Number(usage.cacheRead) || 0) >= 0.5 * before.total });
    }
    return reliableLifetime(pauses);
  } catch { return 0; } finally { db?.close(); }
}
