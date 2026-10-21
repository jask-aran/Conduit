import { createSignal } from "solid-js";
import { Switch, SettingLine } from "@/components/ui";
import { FormTable, form } from "../specs";
import { lib, type Family } from "../model";
import { SwitchDemo } from "../demos";

function FrostSetting() {
  const [enabled, setEnabled] = createSignal(false);
  return <SettingLine label="Frosted tab row"><Switch label="Frosted tab row" checked={enabled()} onChange={setEnabled} /></SettingLine>;
}
export const switchFamily: Family = {
  title: "Switch", stage: true,
  note: "Switch reads the surface's --tint and --well values, at the surface and density picked above.",
  usage: `import { Switch } from "@/components/ui/controls";

<Switch label="Notifications" checked={enabled()}
  onChange={setEnabled} />`,
  api: ["Switch"],
  groups: [
    { title: "Examples", staged: true, atoms: [
      lib("switch", "Switch", "both", "control", "Switch", () => <SwitchDemo />),
      lib("switch-examples", "Switch · additional examples", "both", "control", "Switch", () => <FormTable rows={[
        form("off in settings", "Starts off; press to turn on", () => <FrostSetting />, "SettingLine > Switch checked={signal} onChange"),
        form("disabled off", "Unavailable setting stays off", () => <Switch label="Run on start" checked={false} disabled />, "<Switch checked={false} disabled>"),
        form("disabled on", "Enabled setting cannot be changed", () => <Switch label="Share server" checked disabled />, "<Switch checked disabled>"),
        form("long setting label", "Long description beside a disabled switch", () => <SettingLine label="Share this server with other clients connected to the same account"><Switch label="Share this server with other clients connected to the same account" checked disabled /></SettingLine>, "SettingLine > Switch label disabled"),
      ]} on={["ground", "frost"]} />, "row"),
    ] },
  ],
};
