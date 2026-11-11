import type { Project } from "../api/contracts";
import { activeOrigin } from "../platform/servers";

/*
 * Holds only what is already on screen to whoever holds the device (names and chat titles), and is cleared on
 * sign-out.
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
  try { localStorage.setItem(key(), JSON.stringify(value)); } catch { /* the next open waits for the server */ }
}

export function clearCachedCatalogue() {
  try { localStorage.removeItem(key()); } catch { /* nothing kept */ }
}
