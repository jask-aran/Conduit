import { For, Show } from "solid-js";
import { TITLE_BAR_ITEMS, setTitleBarShows, titleBarShows } from "./title-bar-items";
import { Segmented, Switch } from "@/components/ui/controls";
import { SettingLine } from "@/components/ui/overlay";
import { desktopShell, type DesktopTitleBar } from "../platform/installed-client.ts";
import { Columns, Group } from "@/components/ui/group";
import { Note } from "@/components/ui/state";
import { createShellSettings } from "./desktop-settings";

export function TitleBarSettings() {
  if (!desktopShell) return null;
  const { settings, error, update } = createShellSettings();
  const half = Math.ceil(TITLE_BAR_ITEMS.length / 2);
  const items = (list: readonly (typeof TITLE_BAR_ITEMS)[number][]) => <Group kind="column"><For each={list}>{(item) =>
    <SettingLine label={item.label} title={item.about}>
      <Switch label={`Show ${item.label} in the title bar`} checked={titleBarShows(item.id)} onChange={(shown) => setTitleBarShows(item.id, shown)} />
    </SettingLine>}</For></Group>;
  return <Group title="Title bar" scope="This device">
    <Show when={settings()}>{(current) => <>
      {/* Windows' caption, none (the sidebar's head, the pane headers and the tool rail drag the window, and the rail
          holds its buttons), or Conduit's own bar. */}
      <SettingLine label="Style">
        <Segmented label="Title bar" size="sm" value={current().titleBar ?? "conduit"}
          options={[{ value: "native", label: "Windows" }, { value: "none", label: "None" }, { value: "conduit", label: "Conduit" }] satisfies { value: DesktopTitleBar; label: string }[]}
          onChange={(titleBar) => update({ titleBar: titleBar as DesktopTitleBar })} />
      </SettingLine>
      <Show when={(current().titleBar ?? "conduit") === "conduit"}>
        <Columns>{items(TITLE_BAR_ITEMS.slice(0, half))}{items(TITLE_BAR_ITEMS.slice(half))}</Columns>
      </Show>
    </>}</Show>
    <Show when={error()}><Note tone="error">{error()}</Note></Show>
  </Group>;
}
