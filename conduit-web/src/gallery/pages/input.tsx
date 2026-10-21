import { Input } from "@/components/ui";
import { lib, type Family } from "../model";

export const inputFamily: Family = {
  title: "Input", stage: true,
  note: "Input reads the surface's --tint and --well values, at the surface and density picked above.",
  usage: `import { Input } from "@/components/ui";

<Input placeholder="Add a note (optional)" aria-label="Note"
  value={note()} onInput={(event) => setNote(event.currentTarget.value)} />`,
  api: ["Input"],
  groups: [
    { title: "Examples", staged: true, atoms: [
      lib("input", "Input", "both", "control", "Input", () => <div class="g-field"><Input placeholder="Replace" /><Input value="Lorem ipsum file" /></div>),
    ] },
  ],
};
