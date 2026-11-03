import { DatabaseSync } from "node:sqlite";

/*
 * Keep-warm (DurableRuntime.keepWarm): jbot's home thread's prompt cache is kept from lapsing between wakes by sending
 * its last request again at 90% of the model's cache lifetime, read from cache. Whether that pays depends on how long
 * jbot really sleeps: a ping costs a cached read of the prompt, a wake after the cache lapsed pays a full read. The
 * policy takes the home thread's own gaps between requests (heartbeats that ended without waking it never show) and
 * picks the number of pings after a request that would have cost least over them.
 */

/** Cache lifetimes for providers whose catalogue declares none, as observed or documented. */
const ASSUMED_TTL_SECONDS = {
  // Sign in with ChatGPT and API keys alike: GPT-5.6 and later keep "long" retention 30 minutes.
  openai: 1800,
};
const MOST_PINGS = 48;
const FEWEST_GAPS = 5;

/**
 * The model's cache lifetime for a retention tier: declared by its catalogue entry; otherwise the longest past gap the
 * cache survived on this thread ("observed"), or what is assumed for its provider, whichever is longer.
 */
export function cacheLifetime(model, retention = "long", observedMs = 0) {
  const declared = model?.promptCache?.[retention] ?? model?.promptCache?.short;
  if (declared > 0) return { ms: declared * 1000, source: "declared" };
  const assumed = (ASSUMED_TTL_SECONDS[model?.provider] || 0) * 1000;
  if (observedMs > assumed) return { ms: observedMs, source: "observed" };
  return assumed ? { ms: assumed, source: "assumed" } : null;
}

/**
 * How many pings follow a real request. Per token of prompt: a ping and a wake that finds the cache cost the cached
 * rate, a wake after it lapsed the full one (its write rate where the provider charges writes). With `pings` pings the
 * cache lives until pings * interval + ttl; each past gap is priced under every choice, and the cheapest wins.
 */
export function keepWarmPolicy({ model, retention = "long", gaps: past }) {
  // A gap the cache survived proves it lives at least that long (a ping in it would have kept it alive: none counted).
  const ttl = cacheLifetime(model, retention, Math.max(0, ...past.filter((gap) => gap.hit && !gap.pinged).map((gap) => gap.ms)));
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

/**
 * The gaps between a conversation's requests over the last `days`, from the runtime DB, read-only: `{ ms, hit }`, hit
 * when the request after it read at least half the one before from cache (prompts under 2048 tokens are not cached).
 */
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
