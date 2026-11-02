import { createSignal } from "solid-js";
import { api, readShared } from "../api/client";

/*
 * The hub account's name (a preference on the hub, `accountName`): Settings › Account sets it; the server switcher's
 * menu shows it with its picture, the name's initials (v2 Avatar). Read when either is opened.
 */
const [accountName, setAccountName] = createSignal("");
export { accountName };

// Shared with the app's own read of the preferences on load: one request, not a second straight after it.
export const loadAccount = () => readShared<{ accountName?: string }>("/v0/preferences")
  .then((preferences) => { setAccountName(preferences.accountName || ""); }).catch(() => {});

export const saveAccountName = async (name: string) => {
  const saved = await api<{ accountName?: string }>("/v0/preferences", { method: "PATCH", body: JSON.stringify({ accountName: name.trim() }) });
  setAccountName(saved.accountName || "");
};
