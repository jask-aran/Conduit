import { createSignal, For, onMount, Show } from "solid-js";
import { Avatar, Button, Input, SettingLine, Group, Note } from "@/components/ui";
import { Select } from "@/components/ui/menus";
import { api } from "../api/client";
import { agentView, refreshAgent } from "../state/agent";
import { accountHome, accountName, accountPicture, loadAccount, removeAccountPicture, saveAccountHome, saveAccountName, saveAccountPicture } from "../state/account";
import { ConnectorsGroup } from "./connectors-settings";

const zones = (() => { try { return Intl.supportedValuesOf("timeZone"); } catch { return [] as string[]; } })();

/**
 * Personal › Account: who is signed in to this hub. Its picture (one they choose, or the name's initials: v2 Avatar),
 * shown in the server switcher's menu; its name, which their agent calls them by too (its USER.md). The name saves as
 * it is left (Enter or leaving the field), as Settings saves; a picture as it is chosen. Where they are (time zone,
 * home), which their agent counts its day by and knows them by. Then their own integrations (the agent's connectors:
 * Executor, Gmail…), which act as them.
 */
export function AccountSettings() {
  const [error, setError] = createSignal("");
  onMount(() => void loadAccount());
  let chooser!: HTMLInputElement;
  const [busy, setBusy] = createSignal(false);
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } finally { setBusy(false); }
  };
  const choose = (file: File) => act(() => saveAccountPicture(file));
  const save = async (value: string) => {
    setError("");
    if (value.trim() === accountName()) return;
    try { await saveAccountName(value); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  const saveHome = (value: string) => value.trim() === accountHome() ? undefined : act(() => saveAccountHome(value));
  // The time zone is the agent's setting (its day, brief and budget are counted in it): theirs, so it lives here.
  const zone = () => agentView()?.settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const saveZone = (timezone: string) => act(async () => { await api("/v0/agent", { method: "PATCH", body: JSON.stringify({ timezone }) }); await refreshAgent(); });
  return <><Group title="Account">
    <SettingLine plain label="Picture" state={accountPicture() ? undefined : "your name's initials"} title="Shown in the server switcher's menu, on every device signed in to this hub.">
      <input ref={chooser} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void choose(file); }} />
      <Show when={accountPicture()}><Button size="sm" variant="ghost" disabled={busy()} onClick={() => void act(removeAccountPicture)}>Remove</Button></Show>
      <Button size="sm" variant="secondary" disabled={busy()} onClick={() => chooser.click()}>{accountPicture() ? "Change" : "Choose…"}</Button>
      <Avatar name={accountName()} src={accountPicture()} size="lg" label={`${accountName() || "No name"}'s picture`} />
    </SettingLine>
    <SettingLine label="Name" title="The name this hub knows you by, on every device signed in to it, and what your agent calls you.">
      <Input aria-label="Your name" placeholder="Your name" maxLength={60} value={accountName()}
        onChange={(event) => void save(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
    </SettingLine>
    <Show when={error()}><Note tone="error">{error()}</Note></Show>
  </Group>
  <Group title="Where you are">
    <Show when={agentView()?.enabled}>
      <SettingLine label="Time zone" title="Your day: your agent's day, brief, quiet hours and budget are counted in it.">
        <Select id="account-zone" value={zone()} onChange={(event) => void saveZone(event.currentTarget.value)}>
          <For each={zones.includes(zone()) ? zones : [zone(), ...zones]}>{(item) => <option value={item}>{item.replace(/_/g, " ")}</option>}</For>
        </Select>
      </SettingLine>
    </Show>
    <SettingLine label="Home" title="Where you live, in your words (a city, a suburb): your agent's for weather, travel and what is near you.">
      <Input aria-label="Home" placeholder="City or suburb" maxLength={120} value={accountHome()}
        onChange={(event) => void saveHome(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
    </SettingLine>
  </Group>
  <ConnectorsGroup /></>;
}
