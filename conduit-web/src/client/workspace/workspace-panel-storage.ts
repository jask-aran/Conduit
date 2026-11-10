export type WorkspacePanelStorageBackend = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key"> & {
  readonly length: number;
};

type PersistedState = {
  updatedAt: number;
  values: Record<string, string>;
};

export const WORKSPACE_PANEL_STORAGE_PREFIX = "conduit:workspace-panel:";
export const WORKSPACE_PANEL_GLOBAL_SCOPE = "__global__";
const STATE_NAME = "state";

function browserStorage(): WorkspacePanelStorageBackend | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseState(value: string | null): PersistedState | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || !isRecord(parsed.values)) return null;
    const values: Record<string, string> = {};
    for (const [name, setting] of Object.entries(parsed.values)) {
      if (typeof setting === "string") values[name] = setting;
    }
    const updatedAt = typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0;
    return { updatedAt, values };
  } catch {
    return null;
  }
}

function stateKey(scopeId: string): string {
  return `${WORKSPACE_PANEL_STORAGE_PREFIX}${scopeId}:${STATE_NAME}`;
}

/** The scope a stored panel state belongs to, or null for any other key. */
function stateScope(key: string): string | null {
  const suffix = `:${STATE_NAME}`;
  if (!key.startsWith(WORKSPACE_PANEL_STORAGE_PREFIX) || !key.endsWith(suffix)) return null;
  return key.slice(WORKSPACE_PANEL_STORAGE_PREFIX.length, -suffix.length) || null;
}

export function createWorkspacePanelStorage(storage: WorkspacePanelStorageBackend | null = browserStorage()) {
  const memory = new Map<string, PersistedState>();
  let useMemory = storage === null;
  let warned = false;
  let lastUpdatedAt = 0;

  const warnFallback = () => {
    if (warned) return;
    warned = true;
    try { console.warn("Conduit workspace panel storage is unavailable; using in-memory state for this session."); } catch {}
  };

  const fallback = () => {
    useMemory = true;
    warnFallback();
  };

  const readRaw = (key: string): string | null => {
    if (useMemory || !storage) return null;
    try { return storage.getItem(key); }
    catch { fallback(); return null; }
  };

  const writeRaw = (key: string, value: string): boolean => {
    if (useMemory || !storage) return false;
    try { storage.setItem(key, value); return true; }
    catch { fallback(); return false; }
  };

  const removeRaw = (key: string): boolean => {
    if (useMemory || !storage) return false;
    try { storage.removeItem(key); return true; }
    catch { fallback(); return false; }
  };

  const nextUpdatedAt = (candidate = Date.now()) => {
    lastUpdatedAt = Math.max(lastUpdatedAt + 1, candidate);
    return lastUpdatedAt;
  };

  const readState = (scopeId: string): PersistedState | null => {
    const cached = memory.get(scopeId);
    if (cached) return cached;
    const parsed = parseState(readRaw(stateKey(scopeId)));
    if (parsed) {
      lastUpdatedAt = Math.max(lastUpdatedAt, parsed.updatedAt);
      memory.set(scopeId, parsed);
    }
    return parsed;
  };

  const saveState = (scopeId: string, state: PersistedState): boolean => {
    const next = { updatedAt: state.updatedAt || nextUpdatedAt(), values: { ...state.values } };
    memory.set(scopeId, next);
    if (useMemory || !storage) return false;
    return writeRaw(stateKey(scopeId), JSON.stringify(next));
  };

  const listKeys = (): string[] => {
    if (useMemory || !storage) return [];
    try {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key) keys.push(key);
      }
      return keys;
    } catch {
      fallback();
      return [];
    }
  };

  const readSetting = (scopeId: string, name: string): string | null => {
    const state = readState(scopeId);
    return state && Object.hasOwn(state.values, name) ? state.values[name] ?? null : null;
  };

  const writeSetting = (scopeId: string, name: string, value: string | null): void => {
    const current = readState(scopeId);
    if (value === null && !current) return;
    const values = { ...(current?.values || {}) };
    if (value === null) delete values[name];
    else values[name] = value;
    const next = { updatedAt: nextUpdatedAt(), values };
    if (Object.keys(values).length) saveState(scopeId, next);
    else {
      memory.delete(scopeId);
      removeRaw(stateKey(scopeId));
    }
  };

  const dropScope = (scopeId: string): void => {
    memory.delete(scopeId);
    removeRaw(stateKey(scopeId));
  };

  /** Load every stored scope, drop the ones no longer valid, and keep the 100 most recently written. */
  const pruneWorkspacePanelStorage = (validScopeIds: Iterable<string>): void => {
    const validScopes = new Set(validScopeIds);
    validScopes.add(WORKSPACE_PANEL_GLOBAL_SCOPE);
    const discovered = new Set<string>();
    for (const key of listKeys()) {
      const scopeId = stateScope(key);
      if (!scopeId) continue;
      discovered.add(scopeId);
      const current = parseState(readRaw(key));
      if (current) {
        lastUpdatedAt = Math.max(lastUpdatedAt, current.updatedAt);
        memory.set(scopeId, current);
      }
    }

    for (const scopeId of new Set([...discovered, ...memory.keys()])) {
      if (!validScopes.has(scopeId)) dropScope(scopeId);
    }
    const kept = [...memory.entries()]
      .filter(([scopeId]) => validScopes.has(scopeId) && scopeId !== WORKSPACE_PANEL_GLOBAL_SCOPE)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt);
    for (const [scopeId] of kept.slice(100)) dropScope(scopeId);
  };

  return { readSetting, writeSetting, dropScope, pruneWorkspacePanelStorage };
}

const defaultStorage = createWorkspacePanelStorage();

export const readSetting = defaultStorage.readSetting;
export const writeSetting = defaultStorage.writeSetting;
export const dropScope = defaultStorage.dropScope;
export const pruneWorkspacePanelStorage = defaultStorage.pruneWorkspacePanelStorage;
