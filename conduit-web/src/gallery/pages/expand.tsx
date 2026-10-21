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

export const expandFamily: Family = {
  title: "Expand",
  note: "what opens in place under the row that owns it slides on its measured height, open and shut, over --duration-fold on --ease-fold, on the compositor: what follows slides on a transform and its rows are revealed by a clip that runs with them; the page is laid out once, at the start or the end. Just after a touch, the fold is felt on a phone (haptic fold); an overlay closing likewise (haptic dismiss). Shut, nothing is in the document. When the caller drops the rows at once (chat search rebuilds its list), the shut slides over a still of them",
  usage: `import { Expand } from "@/components/ui";

<Expand open={expanded()}>
  <p>Context usage details</p>
</Expand>`,
  api: ["Expand", "Button"],
  groups: [
{ title: "Open and shut", layout: "desktop", atoms: [
    lib("motion-expand", "Expand", "both", "motion", "components/ui/expand.tsx", () => <ExpandDemo />, "row"),
  ] }
  ],
};
