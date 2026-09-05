export type WorkspacePanelStorageBackend = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key"> & {
  readonly length: number;
};

type PersistedState = {
  updatedAt: number;
  values: Record<string, string>;
};

type PanelKey = { scopeId: string; name: string };

export const WORKSPACE_PANEL_STORAGE_PREFIX = "conduit:workspace-panel:";
export const WORKSPACE_PANEL_GLOBAL_SCOPE = "__global__";
const STATE_NAME = "state";
const STORAGE_MIGRATION_KEY = "conduit:workspace-panel-storage-v3";
const LEGACY_WRAP_LINES_KEY = "conduit:workspace:wrap-lines";
const LEGACY_SETTING_NAMES = [
  "secondary-tab",
  "file-secondary",
  "file-split-ratio",
  "diff:source-detail-height",
  "diff:source-detail-open",
  "terminal:detail-height",
  "terminal:detail-open",
  "artifacts:detail-height",
  "artifacts:detail-open",
  "files:detail-height",
  "files:detail-open",
  "diff:detail-height",
  "diff:detail-open",
  "tree-collapsed",
  "kept-visible",
  "tree-width",
  "show-hidden",
  "split-ratio",
  "wrap-lines",
  "tab",
  "file",
  "width",
  STATE_NAME,
].sort((left, right) => right.length - left.length);

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

function legacyKey(scopeId: string, name: string): string {
  return `${WORKSPACE_PANEL_STORAGE_PREFIX}${scopeId}:${name}`;
}

function parsePanelKey(key: string): PanelKey | null {
  if (!key.startsWith(WORKSPACE_PANEL_STORAGE_PREFIX)) return null;
  const name = LEGACY_SETTING_NAMES.find((candidate) => key.endsWith(`:${candidate}`));
  if (!name) return null;
  const scopeEnd = key.length - name.length - 1;
  const scopeId = key.slice(WORKSPACE_PANEL_STORAGE_PREFIX.length, scopeEnd);
  return scopeId ? { scopeId, name } : null;
}

function migrateGeometryValue(name: string, value: string): string {
  if (name !== "width" && !name.endsWith(":detail-height")) return value;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? String(Math.round(number * 8) / 10) : value;
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
    if (state && Object.hasOwn(state.values, name)) return state.values[name] ?? null;
    return readRaw(legacyKey(scopeId, name));
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
    const keys = listKeys();
    for (const key of keys) {
      const parsed = parsePanelKey(key);
      if (parsed?.scopeId === scopeId) removeRaw(key);
    }
  };

  const migrateWorkspacePanelStorage = (validScopeIds: Iterable<string>): void => {
    const validScopes = new Set(validScopeIds);
    validScopes.add(WORKSPACE_PANEL_GLOBAL_SCOPE);
    const keys = listKeys();
    const discovered = new Set<string>();
    const legacy = new Map<string, Map<string, string>>();
    for (const key of keys) {
      const parsed = parsePanelKey(key);
      if (!parsed) continue;
      discovered.add(parsed.scopeId);
      if (parsed.name === STATE_NAME) continue;
      const value = readRaw(key);
      if (value !== null) {
        if (!legacy.has(parsed.scopeId)) legacy.set(parsed.scopeId, new Map());
        legacy.get(parsed.scopeId)?.set(parsed.name, value);
      }
    }
    const legacyWrapLines = readRaw(LEGACY_WRAP_LINES_KEY);
    if (legacyWrapLines !== null) {
      discovered.add(WORKSPACE_PANEL_GLOBAL_SCOPE);
      if (!legacy.has(WORKSPACE_PANEL_GLOBAL_SCOPE)) legacy.set(WORKSPACE_PANEL_GLOBAL_SCOPE, new Map());
      legacy.get(WORKSPACE_PANEL_GLOBAL_SCOPE)?.set("wrap-lines", legacyWrapLines);
    }
    const migrationNeeded = readRaw(STORAGE_MIGRATION_KEY) !== "true";
    for (const scopeId of discovered) {
      const current = parseState(readRaw(stateKey(scopeId)));
      if (current) {
        lastUpdatedAt = Math.max(lastUpdatedAt, current.updatedAt);
        memory.set(scopeId, current);
      }
      const legacyValues = legacy.get(scopeId);
      if (!legacyValues?.size && current) continue;
      const values = { ...(current?.values || {}) };
      for (const [name, value] of legacyValues || []) {
        if (!Object.hasOwn(values, name)) values[name] = migrationNeeded ? migrateGeometryValue(name, value) : value;
      }
      const saved = saveState(scopeId, { updatedAt: current?.updatedAt || nextUpdatedAt(), values });
      if (!saved) continue;
      for (const [name] of legacyValues || []) removeRaw(legacyKey(scopeId, name));
      if (scopeId === WORKSPACE_PANEL_GLOBAL_SCOPE) removeRaw(LEGACY_WRAP_LINES_KEY);
    }
    if (migrationNeeded) writeRaw(STORAGE_MIGRATION_KEY, "true");

    for (const scopeId of new Set([...discovered, ...memory.keys()])) {
      if (!validScopes.has(scopeId)) dropScope(scopeId);
    }
    const kept = [...memory.entries()]
      .filter(([scopeId]) => validScopes.has(scopeId) && scopeId !== WORKSPACE_PANEL_GLOBAL_SCOPE)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt);
    for (const [scopeId] of kept.slice(100)) dropScope(scopeId);
  };

  return { readSetting, writeSetting, dropScope, migrateWorkspacePanelStorage };
}

const defaultStorage = createWorkspacePanelStorage();

export const readSetting = defaultStorage.readSetting;
export const writeSetting = defaultStorage.writeSetting;
export const dropScope = defaultStorage.dropScope;
export const migrateWorkspacePanelStorage = defaultStorage.migrateWorkspacePanelStorage;
