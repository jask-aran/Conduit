import { createHash } from "node:crypto";
import fs from "node:fs";

/*
 * Prompt-cache diagnostics: for each provider request, hashes its instructions, tools and each input item, and records
 * where it first differs from the previous request with the same cache key. A request that only appends shows no
 * divergence; a cache miss with no divergence was the provider's, not Conduit's. Written to `file` as JSON lines.
 */
const hash = (value) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 12);
export function prefixWatch(file) {
  // Each key's last hashes, kept beside the log: after a restart a changed prefix still shows as Conduit's, not the provider's.
  const saved = file.replace(/\.jsonl$/, "") + "-last.json";
  let last;
  try { last = new Map(Object.entries(JSON.parse(fs.readFileSync(saved, "utf8")))); } catch { last = new Map(); }
  let saving = false;
  const save = () => {
    if (saving) return;
    saving = true;
    setTimeout(() => { saving = false; fs.writeFile(saved, JSON.stringify(Object.fromEntries(last)), () => {}); }, 1000).unref?.();
  };
  // The last request per cache key, whole, for warmCache to send again; also on disk (the runtime DB holds the same
  // content), so a wake after a restart can still be warmed.
  const payloads = new Map();
  const dir = file.replace(/\.jsonl$/, "") + "-payloads";
  const payloadFile = (key) => `${dir}/${String(key).replace(/[^A-Za-z0-9_.-]/g, "_")}.json`;
  const pending = new Set();
  const keep = (key) => {
    if (pending.has(key)) return;
    pending.add(key);
    setTimeout(() => {
      pending.delete(key);
      const saved = payloads.get(key);
      if (!saved) return;
      fs.mkdir(dir, { recursive: true }, () => fs.writeFile(payloadFile(key), JSON.stringify(saved), () => fs.readdir(dir, (error, names) => {
        if (error || names.length <= 50) return;
        const byAge = names.map((name) => ({ name, at: fs.statSync(`${dir}/${name}`, { throwIfNoEntry: false })?.mtimeMs || 0 })).sort((a, b) => a.at - b.at);
        for (const { name } of byAge.slice(0, names.length - 50)) fs.rm(`${dir}/${name}`, { force: true }, () => {});
      })));
    }, 1000).unref?.();
  };
  const watch = (params, model) => {
    try {
      const key = params?.prompt_cache_key;
      if (!key) return undefined;
      const items = Array.isArray(params.input) ? params.input : Array.isArray(params.messages) ? params.messages : [];
      const now = { head: hash([params.instructions, params.tools, params.model, params.reasoning]), items: items.map(hash), types: items.map((item) => item?.type || item?.role) };
      const previous = watch.last(key)?.params;
      if (!params.__warm) { payloads.set(key, { params, model, at: Date.now() }); if (payloads.size > 50) payloads.delete(payloads.keys().next().value); keep(key); }
      const before = last.get(key);
      last.set(key, now);
      if (last.size > 200) last.delete(last.keys().next().value);
      save();
      let diverged = null;
      if (before) {
        if (before.head !== now.head) diverged = !previous ? { at: "head" } : { at: "head", instructions: hash(params.instructions) !== hash(previous?.instructions), tools: hash(params.tools) !== hash(previous?.tools), model: params.model !== previous?.model, reasoning: JSON.stringify(params.reasoning) !== JSON.stringify(previous?.reasoning) };
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
  watch.last = (key) => {
    if (!payloads.has(key)) { try { payloads.set(key, JSON.parse(fs.readFileSync(payloadFile(key), "utf8"))); } catch { return null; } }
    return payloads.get(key);
  };
  return watch;
}
