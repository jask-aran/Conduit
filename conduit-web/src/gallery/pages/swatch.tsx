// Props: colour, hollow, fill. Button is the colour-choice host; its forms are documented on the Button page.
import { createSignal, For } from "solid-js";
import { Reading, ReadingTotal } from "@/components/ui";
import { Swatch, Button } from "@/components/ui";
import { row, token, type Page } from "../model";

function SwatchChoice() {
  const [colour, setColour] = createSignal("var(--category-1)");
  return <div role="radiogroup" aria-label="Workspace colour"><For each={["var(--category-1)", "var(--category-2)", "var(--category-3)"]}>{(value, index) => <Button variant="ghost" role="radio" aria-label={`Workspace colour ${index() + 1}`} aria-checked={colour() === value} onClick={() => setColour(value)}><Swatch colour={value} fill /></Button>}</For></div>;
}

export const swatchPage: Page = {
  title: "Swatch",
  summary: "A colour dot identifies a part; hollow marks free space, and fill covers a colour choice.",
  preview: () => <div class="g-row"><Swatch colour="var(--foreground)" /><span>Messages</span></div>,
  usage: `import { Swatch, Button } from "@/components/ui";

<Button variant="ghost" aria-label="Text colour" role="radio" aria-checked={true}>
  <Swatch colour="var(--foreground)" fill />
</Button>`,
  examples: [
    row("choose colour", "Click a colour to change the selected workspace colour.", () => <SwatchChoice />, { code: '<Button role="radio" aria-checked={selected()}><Swatch fill /></Button>' }),
    row("long legend", "Colour and long category label in a context reading.", () => <Reading><ReadingTotal label={<><Swatch colour="var(--category-2)" hollow={false} fill={false} /> System prompt and workspace instructions for conduit-web/src/client/workspace</>} value="16,000 tokens" /></Reading>, { code: "<ReadingTotal label={<><Swatch colour />…</>} />" }),
    row("Colour dot", "A solid dot identifies messages in the context legend.", () => <div class="g-row"><Swatch colour="var(--foreground)" /><span>Messages</span></div>),
    row("Hollow dot", "A hollow dot identifies free context space.", () => <div class="g-row"><Swatch hollow /><span>Free space</span></div>),
    row("Colour choice", "The swatch fills the colour choice button.", () => <Button variant="ghost" aria-label="Text colour" role="radio" aria-checked={true}><Swatch colour="var(--foreground)" fill /></Button>),
  ],
  tokens: [{ title: "Swatch", tokens: [
    token("--icon-dot", "Dot size"),
    token("--radius-round", "Round corner"),
    token("--hairline", "Fine line width"),
    token("--muted-foreground", "Quiet text or stroke colour"),
  ] }],
  api: ["Swatch","Button"],
};
