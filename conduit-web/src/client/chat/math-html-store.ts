import katex from "katex";

/**
 * Finished formulas' KaTeX HTML, kept across reloads.
 *
 * A settled formula's rendering never changes, yet every page load rendered
 * each again, a formula a few milliseconds, queued a few per frame -- so a
 * chat of long formulas opened with its math filling in over most of a second.
 * Read synchronously, a chat opened before draws its formulas with the page.
 *
 * Bounded, oldest first out, and keyed by KaTeX's version so a different
 * renderer never reuses another's output. Anything storage refuses is simply
 * not cached.
 */
const ROOT = "conduit:katex:";
const PREFIX = `${ROOT}${katex.version}:`;
const INDEX = `${PREFIX}index`;
const BUDGET_CHARACTERS = 2_000_000;
const LARGEST_CHARACTERS = 200_000;
const SEPARATOR = "\u0000\u0000";

let index: Array<[string, number]> | null = null;
let indexWrite: ReturnType<typeof setTimeout> | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function hash(value: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function loadIndex(store: Storage) {
  if (index) return index;
  try {
    const saved = store.getItem(INDEX);
    index = saved ? JSON.parse(saved) : [];
    // A first load under this KaTeX version clears what older ones left.
    if (!saved) {
      for (let i = store.length - 1; i >= 0; i -= 1) {
        const key = store.key(i);
        if (key?.startsWith(ROOT) && !key.startsWith(PREFIX)) store.removeItem(key);
      }
    }
  } catch {
    index = [];
  }
  return index!;
}

function saveIndexSoon(store: Storage) {
  if (indexWrite) return;
  indexWrite = setTimeout(() => {
    indexWrite = null;
    try { store.setItem(INDEX, JSON.stringify(index || [])); } catch { /* not cached */ }
  }, 500);
}

export function readStoredMath(key: string): string | undefined {
  const store = storage();
  if (!store) return undefined;
  try {
    const value = store.getItem(PREFIX + hash(key));
    if (!value) return undefined;
    const at = value.indexOf(SEPARATOR);
    return at >= 0 && value.slice(0, at) === key ? value.slice(at + SEPARATOR.length) : undefined;
  } catch {
    return undefined;
  }
}

export function storeMath(key: string, html: string) {
  const store = storage();
  if (!store) return;
  const value = key + SEPARATOR + html;
  if (value.length > LARGEST_CHARACTERS) return;
  const id = hash(key);
  const entries = loadIndex(store);
  const existing = entries.findIndex(([entry]) => entry === id);
  if (existing >= 0) entries.splice(existing, 1);
  entries.push([id, value.length]);
  let total = entries.reduce((sum, [, size]) => sum + size, 0);
  while (total > BUDGET_CHARACTERS && entries.length > 1) {
    const [oldest, size] = entries.shift()!;
    total -= size;
    try { store.removeItem(PREFIX + oldest); } catch { /* gone already */ }
  }
  try {
    store.setItem(PREFIX + id, value);
  } catch {
    // Out of room for everything else too: give up the oldest half once.
    for (const [oldest] of entries.splice(0, Math.floor(entries.length / 2))) {
      try { store.removeItem(PREFIX + oldest); } catch { /* gone already */ }
    }
    try { store.setItem(PREFIX + id, value); } catch { entries.pop(); }
  }
  saveIndexSoon(store);
}
