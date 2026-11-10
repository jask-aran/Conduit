import { createSignal } from "solid-js";
import { api, readShared } from "../api/client";
import type { PreferencesPayload } from "../api/contracts";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl } from "../api/transport.js";

/*
 * The hub account's name (a preference on the hub, `accountName`): Settings › Account sets it; the server switcher's
 * menu shows it with its picture, the name's initials (v2 Avatar). Read when either is opened.
 */
const [accountName, setAccountName] = createSignal("");
export { accountName };
/** Where they live: a place in their words, given to their agent (its USER.md `home`). */
const [accountHome, setAccountHome] = createSignal("");
export { accountHome };

// Shared with the app's own read of the preferences on load: one request, not a second straight after it.
export const loadAccount = () => readShared<{ accountName?: string; accountHome?: string }>("/v0/preferences")
  .then((preferences) => { setAccountName(preferences.accountName || ""); setAccountHome(preferences.accountHome || ""); }).catch(() => {})
  .then(loadPicture);

/** The account's picture: its address (versioned, so a change shows at once), or null for the name's initials. */
const [accountPicture, setAccountPicture] = createSignal<string | null>(null);
export { accountPicture };
// Read with the client's own credentials (an installed client signs requests itself, which an <img> address would not),
// and drawn from a local object URL; the version keeps a change from being served from the cache.
let shown: string | null = null;
const show = (url: string | null) => { if (shown) URL.revokeObjectURL(shown); shown = url; setAccountPicture(url); };
const fetchPicture = async (version: string | null) => {
  if (!version) return show(null);
  const response = await authorizedFetch(httpUrl(`/v0/account/picture?v=${encodeURIComponent(version)}`));
  show(response.ok ? URL.createObjectURL(await response.blob()) : null);
};
const loadPicture = () => api<{ picture: string | null }>("/v0/account").then((account) => fetchPicture(account.picture)).catch(() => {});

/** A chosen image, as the picture: its centre square, 256 px, WebP (PNG where the browser cannot write WebP). */
export async function saveAccountPicture(file: File) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((made) => made ? resolve(made) : reject(new Error("The picture could not be read")), "image/webp", 0.85));
  const saved = await api<{ picture: string | null }>("/v0/account/picture", { method: "PUT", headers: { "content-type": blob.type || "image/png" }, body: blob });
  await fetchPicture(saved.picture);
}
export async function removeAccountPicture() {
  await api("/v0/account/picture", { method: "DELETE" });
  show(null);
}

export const saveAccountName = async (name: string) => {
  const saved = await api<PreferencesPayload>("/v0/preferences", { method: "PATCH", body: JSON.stringify({ accountName: name.trim() }) });
  setAccountName(saved.accountName || "");
};

export const saveAccountHome = async (home: string) => {
  const saved = await api<PreferencesPayload>("/v0/preferences", { method: "PATCH", body: JSON.stringify({ accountHome: home.trim() }) });
  setAccountHome(saved.accountHome || "");
};
