import { SelectTrigger } from "@/components/ui";
import { lib, type Family } from "../model";

export const selectFamily: Family = {
  title: "Select", stage: true,
  note: "Select reads the surface's --tint and --well values, at the surface and density picked above.",
  usage: `import { SelectTrigger } from "@/components/ui";

<SelectTrigger bare value="OpenAI"
  onClick={() => setOpen(true)} />`,
  api: ["SelectTrigger"],
  groups: [
    { title: "Examples", staged: true, atoms: [
      lib("select", "Select", "both", "control", "SelectTrigger bare", () => <div class="g-field"><SelectTrigger value="System default" /><div class="g-row"><span>Provider</span><SelectTrigger bare value="OpenAI" /></div></div>),
    ] },
  ],
};
