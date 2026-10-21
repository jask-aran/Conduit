import { lib, type Family } from "../model";
import { SwitchDemo } from "../demos";

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
    ] },
  ],
};
