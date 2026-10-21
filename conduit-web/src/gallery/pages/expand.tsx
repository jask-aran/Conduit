// Props: open, class, children. Button is the disclosure host; its forms are documented on the Button page.
import { Show } from "solid-js";
import { Reading, ReadingTotal } from "@/components/ui";
import { createSignal, For } from "solid-js";
import { Expand, Button } from "@/components/ui";
import { row, token, type Page } from "../model";
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

export const expandPage: Page = {
  title: "Expand",
  summary: "Content opens and closes in place over --duration-fold on --ease-fold: following rows move with a transform, while a clip reveals the content and layout runs once at the start or end. After a touch, phones give fold feedback; overlay dismissal gives dismiss feedback. Closed content leaves the document; if the caller removes children at once, closing uses a still of them.",
  preview: () => <ExpandDemo />,
  usage: `import { Expand } from "@/components/ui";

<Expand open={expanded()}>
  <p>Context usage details</p>
</Expand>`,
  examples: [
    row("initially closed", "Open context details under their control; long labels use the Reading layout.", () => <ExpandReading />, { code: "<Expand open={open()}><Reading>…</Reading></Expand>" }),
    row("removed children", "Close while dropping the rows, as chat search does.", () => <ExpandReading drop />, { code: "<Expand open={open()}><Show when={open()}>…</Show></Expand>" }),
  ],
  motion: [
    row("Expand", "components/ui/expand.tsx", () => <ExpandDemo />, { surfaces: ["ground"] }),
  ],
  tokens: [{ title: "Expand", tokens: [
    token("--duration-fold", "Fold duration"),
    token("--ease-fold", "Fold easing"),
    token("--text-row", "Example row text size"),
  ] }],
  api: ["Expand", "Button"],
};
