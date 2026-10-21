// Props: colour, hollow, fill. Button is the colour-choice host; its forms are documented on the Button page.
import { createSignal, For } from "solid-js";
import { Reading, ReadingTotal } from "@/components/ui";
import { Swatch, Button } from "@/components/ui";
import { FormTable, form } from "../specs";
import { lib, type Family } from "../model";

function SwatchChoice() {
  const [colour, setColour] = createSignal("var(--category-1)");
  return <div role="radiogroup" aria-label="Workspace colour"><For each={["var(--category-1)", "var(--category-2)", "var(--category-3)"]}>{(value, index) => <Button variant="ghost" role="radio" aria-label={`Workspace colour ${index() + 1}`} aria-checked={colour() === value} onClick={() => setColour(value)}><Swatch colour={value} fill /></Button>}</For></div>;
}

export const swatchFamily: Family = {
  title: "Swatch", stage: true,
  note: "A colour dot identifies a part; hollow marks free space, and fill covers a colour choice.",
  usage: `import { Swatch, Button } from "@/components/ui";

<Button variant="ghost" aria-label="Text colour" role="radio" aria-checked={true}>
  <Swatch colour="var(--foreground)" fill />
</Button>`,
  api: ["Swatch","Button"],
  groups: [{ title: "Examples", staged: "density", atoms: [
      lib("swatch-examples", "swatch · more examples", "both", "control", "swatch", () => <FormTable rows={[
        form("choose colour", "Click a colour to change the selected workspace colour.", () => <SwatchChoice />, '<Button role="radio" aria-checked={selected()}><Swatch fill /></Button>'),
        form("long legend", "Colour and long category label in a context reading.", () => <Reading><ReadingTotal label={<><Swatch colour="var(--category-2)" hollow={false} fill={false} /> System prompt and workspace instructions for conduit-web/src/client/workspace</>} value="16,000 tokens" /></Reading>, "<ReadingTotal label={<><Swatch colour />…</>} />"),
      ]} on={["ground", "frost"]} />, "row"),

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
