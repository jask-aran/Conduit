import type { Project } from "../api/contracts";
import { activeOrigin } from "../platform/servers";

/*
 * The last catalogue this device saw, per server, so a cold open can draw the
 * dashboard before the server has answered and correct it when it does. Only
 * what the sidebar and dashboard list: names and chat titles, the same things
 * already on screen to whoever holds the device. Cleared on sign-out.
 */
type Catalogue = { projects: Project[] };
const PREFIX = "conduit.catalogue:";
const key = () => PREFIX + (activeOrigin() || location.origin);

export function readCachedCatalogue(): Catalogue | null {
  try {
    const value = JSON.parse(localStorage.getItem(key()) || "null") as Catalogue | null;
    return Array.isArray(value?.projects) ? value : null;
  } catch { return null; }
}

export function writeCachedCatalogue(value: Catalogue) {
  try { localStorage.setItem(key(), JSON.stringify(value)); } catch { /* the next open waits, as before */ }
}

export function clearCachedCatalogue() {
  try { localStorage.removeItem(key()); } catch { /* nothing kept */ }
}
