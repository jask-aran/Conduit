import { createSignal, onMount, Show } from "solid-js";
import { Avatar, Input, SettingLine, SettingNote, Group } from "@/components/ui";
import { accountName, loadAccount, saveAccountName } from "../state/account";

/**
 * Personal › Account: who is signed in to this hub. Its name is the account's picture's initials (v2 Avatar), shown in
 * the server switcher's menu; saved as it is left (Enter or leaving the field), as Settings saves.
 */
export function AccountSettings() {
  const [error, setError] = createSignal("");
  onMount(() => void loadAccount());
  const save = async (value: string) => {
    setError("");
    if (value.trim() === accountName()) return;
    try { await saveAccountName(value); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  return <Group title="Account">
    <SettingLine plain label="Picture" state="your name's initials" title="Shown in the server switcher's menu. A photo of your own comes later.">
      <Avatar name={accountName()} size="lg" label={`${accountName() || "No name"}'s picture`} />
    </SettingLine>
    <SettingLine label="Name" title="The name this hub knows you by, on every device signed in to it.">
      <Input aria-label="Your name" placeholder="Your name" maxLength={60} value={accountName()}
        onChange={(event) => void save(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
    </SettingLine>
    <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
  </Group>;
}
