import { Swatch, Button } from "@/components/ui";
import { FormTable, form } from "../specs";
import { lib, type Family } from "../model";

export const swatchFamily: Family = {
  title: "Swatch", stage: true,
  note: "A colour dot identifies a part; hollow marks free space, and fill covers a colour choice.",
  usage: `import { Swatch, Button } from "@/components/ui";

<Button variant="ghost" aria-label="Text colour" role="radio" aria-checked={true}>
  <Swatch colour="var(--foreground)" fill />
</Button>`,
  api: ["Swatch","Button"],
  groups: [{ title: "Examples", staged: "density", atoms: [
      lib("swatch-colour", "Colour dot", "both", "control", "Swatch", () => <FormTable rows={[
        form("Colour dot", "A solid dot identifies messages in the context legend.", () => <div class="g-row"><Swatch colour="var(--foreground)" /><span>Messages</span></div>),
      ]} on={["ground", "frost"]} />, "row"),
      lib("swatch-hollow", "Hollow dot", "both", "control", "Swatch", () => <FormTable rows={[
        form("Hollow dot", "A hollow dot identifies free context space.", () => <div class="g-row"><Swatch hollow /><span>Free space</span></div>),
      ]} on={["ground", "frost"]} />, "row"),
      lib("swatch-fill", "Colour choice", "both", "control", "Swatch", () => <FormTable rows={[
        form("Colour choice", "The swatch fills the colour choice button.", () => <Button variant="ghost" aria-label="Text colour" role="radio" aria-checked={true}><Swatch colour="var(--foreground)" fill /></Button>),
      ]} on={["ground", "frost"]} />, "row"),
  ] }],
};
