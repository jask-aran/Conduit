import { api } from "../api/client";
import { servers, type ServerEntry } from "./servers.ts";

export function sharedServers(list: ServerEntry[] = servers()) {
  return list.filter((entry) => entry.shared).map(({ origin, name }) => ({ origin, name }));
}

/** The whole list every time: a directory only ever added to would hand back every forgotten address. */
export async function saveServerDirectory(list: ServerEntry[] = servers()) {
  try { await api("/v0/preferences", { method: "PATCH", body: JSON.stringify({ knownServers: sharedServers(list) }) }); }
  catch { /* advisory: the list held here is already right */ }
}

export async function publishServerDirectory(list: ServerEntry[], held?: Array<{ origin?: unknown }>) {
  const known = new Set((held || []).map((item) => String(item?.origin || "")));
  if (sharedServers(list).every((entry) => known.has(entry.origin))) return;
  await saveServerDirectory(list);
}
