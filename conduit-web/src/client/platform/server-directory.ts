import { api } from "../api/client";
import { servers, type ServerEntry } from "./servers.ts";

/**
 * Write this client's list of servers to the server it is talking to.
 *
 * Unconditional, because removal has to be said out loud: a directory that is
 * only ever added to would hand back every address anyone had ever forgotten,
 * the next time a client connected.
 */
export async function saveServerDirectory(list: ServerEntry[] = servers()) {
  try { await api("/v0/preferences", { method: "PATCH", body: JSON.stringify({ knownServers: list }) }); }
  catch { /* advisory: the list held here is already right */ }
}

/** The same write, skipped when the server already knows everything in it. */
export async function publishServerDirectory(list: ServerEntry[], held?: Array<{ origin?: unknown }>) {
  const known = new Set((held || []).map((item) => String(item?.origin || "")));
  if (list.every((entry) => known.has(entry.origin))) return;
  await saveServerDirectory(list);
}
