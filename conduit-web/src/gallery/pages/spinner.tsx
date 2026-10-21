import { Spinner } from "@/components/ui";
import { lib, type Family } from "../model";

export const spinnerFamily: Family = {
  title: "Spinner", stage: true,
  note: "Spinner reads the surface's --tint and --well values, at the surface and density picked above.",
  usage: `import { Spinner } from "@/components/ui";

<span role="status">
  <Spinner /> Connecting…
</span>`,
  api: ["Spinner"],
  groups: [
    { title: "Examples", staged: true, atoms: [
      lib("spinner", "Spinner", "both", "control", "Spinner", () => <Spinner />),
    ] },
  ],
};
