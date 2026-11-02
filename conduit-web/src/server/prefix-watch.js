import { createHash } from "node:crypto";
import fs from "node:fs";

/*
 * Prompt-cache diagnostics: for each provider request, hashes its instructions, tools and each input item, and records
 * where it first differs from the previous request with the same cache key. A request that only appends shows no
 * divergence; a cache miss with no divergence was the provider's, not Conduit's. Written to `file` as JSON lines.
 */
const hash = (value) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 12);
export function prefixWatch(file) {
  const last = new Map();
  // The last request per cache key, whole, for warmCache to send again.
  const payloads = new Map();
  const watch = (params, model) => {
    try {
      const key = params?.prompt_cache_key;
      if (!key) return undefined;
      const items = Array.isArray(params.input) ? params.input : Array.isArray(params.messages) ? params.messages : [];
      const now = { head: hash([params.instructions, params.tools, params.model, params.reasoning]), items: items.map(hash), types: items.map((item) => item?.type || item?.role) };
      const previous = payloads.get(key)?.params;
      if (!params.__warm) { payloads.set(key, { params, model, at: Date.now() }); if (payloads.size > 50) payloads.delete(payloads.keys().next().value); }
      const before = last.get(key);
      last.set(key, now);
      if (last.size > 200) last.delete(last.keys().next().value);
      let diverged = null;
      if (before) {
        if (before.head !== now.head) diverged = { at: "head", instructions: hash(params.instructions) !== hash(previous?.instructions), tools: hash(params.tools) !== hash(previous?.tools), model: params.model !== previous?.model, reasoning: JSON.stringify(params.reasoning) !== JSON.stringify(previous?.reasoning) };
        else {
          const index = before.items.findIndex((item, i) => now.items[i] !== item);
          // What changed, a little of each side, so a miss can be read without the payloads.
          const prior = previous && (Array.isArray(previous.input) ? previous.input : previous.messages || []);
          const clip = (item) => JSON.stringify(item ?? null).slice(0, 400);
          if (index >= 0) diverged = { at: index, of: before.items.length, was: before.types[index], now: now.types[index], before: clip(prior?.[index]), after: clip(items[index]) };
        }
      }
      fs.appendFile(file, JSON.stringify({ t: new Date().toISOString(), key, items: items.length, diverged, ...(params.__warm ? { warm: true } : {}) }) + "\n", () => {});
    } catch { /* diagnostics never break a request */ }
    if (params?.__warm) { const { __warm, ...rest } = params; return rest; }
    return undefined;
  };
  watch.last = (key) => payloads.get(key) || null;
  return watch;
}
