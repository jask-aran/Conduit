// Props: open, class, children. Button is the disclosure host; its forms are documented on the Button page.
import { Show } from "solid-js";
import { Reading, ReadingTotal } from "@/components/ui";
import { FormTable, form } from "../specs";
import { createSignal, For } from "solid-js";
import { Expand, Button } from "@/components/ui";
import { lib, type Family } from "../model";
// A folder's row and its rows, toggled: the sidebar's NavFolder and chat search's folders slide the same way.
function ExpandDemo() {
  const [open, setOpen] = createSignal(true);
  return <div class="g-expand" data-surface="frame">
    <Button variant="secondary" size="sm" aria-expanded={open()} onClick={() => setOpen(!open())}>{open() ? "Shut" : "Open"} Japan</Button>
    <Expand open={open()}><For each={["Gassho house stays", "Six people, two nights", "Getting to Shirakawa-go"]}>{(title) => <p class="g-expand-row">{title}</p>}</For></Expand>
    <p class="g-expand-row g-expand-after">The next folder</p>
  </div>;
}

function ExpandReading(props: { drop?: boolean }) {
  const [open, setOpen] = createSignal(false);
  const content = () => <Reading><ReadingTotal label="Workspace instructions and source files in conduit-web/src/client/workspace" value="16,000 tokens" /><ReadingTotal label="Messages" value="48,000 tokens" /></Reading>;
  return <><Button variant="ghost" aria-expanded={open()} onClick={() => setOpen(!open())}>Context details</Button><Expand open={open()}><Show when={!props.drop || open()}>{content()}</Show></Expand><Reading><ReadingTotal label="Available context" value="136,000 tokens" /></Reading></>;
}

export const expandFamily: Family = {
  title: "Expand",
  note: "what opens in place under the row that owns it slides on its measured height, open and shut, over --duration-fold on --ease-fold, on the compositor: what follows slides on a transform and its rows are revealed by a clip that runs with them; the page is laid out once, at the start or the end. Just after a touch, the fold is felt on a phone (haptic fold); an overlay closing likewise (haptic dismiss). Shut, nothing is in the document. When the caller drops the rows at once (chat search rebuilds its list), the shut slides over a still of them",
  usage: `import { Expand } from "@/components/ui";

<Expand open={expanded()}>
  <p>Context usage details</p>
</Expand>`,
  api: ["Expand", "Button"],
  groups: [
    { title: "Examples", atoms: [
      lib("expand-examples", "expand · more examples", "both", "control", "expand", () => <FormTable rows={[
        form("initially closed", "Open context details under their control; long labels use the Reading layout.", () => <ExpandReading />, "<Expand open={open()}><Reading>…</Reading></Expand>"),
        form("removed children", "Close while dropping the rows, as chat search does.", () => <ExpandReading drop />, "<Expand open={open()}><Show when={open()}>…</Show></Expand>"),
      ]} on={["ground", "frost"]} />, "row"),
    ] },

{ title: "Open and shut", layout: "desktop", atoms: [
    lib("motion-expand", "Expand", "both", "motion", "components/ui/expand.tsx", () => <ExpandDemo />, "row"),
  ] }
  ],
};
