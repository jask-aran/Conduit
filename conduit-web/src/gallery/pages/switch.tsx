import { createSignal } from "solid-js";
import { Switch, SettingLine } from "@/components/ui";
import { row, token, type Page } from "../model";
import { SwitchDemo } from "../demos";

function FrostSetting() {
  const [enabled, setEnabled] = createSignal(false);
  return <SettingLine label="Frosted tab row"><Switch label="Frosted tab row" checked={enabled()} onChange={setEnabled} /></SettingLine>;
}
export const switchPage: Page = {
  title: "Switch",
  summary: "Switch reads the surface's --tint and --well values.",
  preview: () => <SwitchDemo />,
  usage: `import { Switch } from "@/components/ui/controls";

<Switch label="Notifications" checked={enabled()}
  onChange={setEnabled} />`,
  anatomy: { scene: () => <SwitchDemo />, parts: [
    { selector: ".ui-switch", name: "Track", does: "shows whether the setting is enabled", from: "Switch checked" },
    { selector: ".ui-switch > span", name: "Thumb", does: "moves to the enabled side", from: "--icon" },
  ] },
  examples: [
    row("Switch", "Switch", () => <SwitchDemo />),
    row("off in settings", "Starts off; press to turn on", () => <FrostSetting />, { code: "SettingLine > Switch checked={signal} onChange" }),
    row("disabled off", "Unavailable setting stays off", () => <Switch label="Run on start" checked={false} disabled />, { code: "<Switch checked={false} disabled>" }),
    row("disabled on", "Enabled setting cannot be changed", () => <Switch label="Share server" checked disabled />, { code: "<Switch checked disabled>" }),
    row("long setting label", "Long description beside a disabled switch", () => <SettingLine label="Share this server with other clients connected to the same account"><Switch label="Share this server with other clients connected to the same account" checked disabled /></SettingLine>, { code: "SettingLine > Switch label disabled" }),
  ],
  tokens: [{ title: "Switch", tokens: [
    token("--icon", "Icon or thumb size"),
    token("--well", "Surface fill"),
    token("--tint", "Surface tint"),
    token("--primary", "Enabled fill"),
    token("--duration-quick", "Change duration"),
  ] }],
  api: ["Switch"],
};
