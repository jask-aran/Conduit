import { TextArea } from "@/components/ui";
import { lib, type Family } from "../model";

export const textareaFamily: Family = {
  title: "TextArea", stage: true,
  note: "TextArea reads the surface's --tint and --well values, at the surface and density picked above.",
  usage: `import { TextArea } from "@/components/ui";

<TextArea rows={1} aria-label="Message the agent"
  placeholder="Send a message…" value={draft()}
  onInput={(event) => setDraft(event.currentTarget.value)} />`,
  api: ["TextArea"],
  groups: [
    { title: "Examples", staged: true, atoms: [
      lib("textarea", "TextArea", "both", "control", "TextArea: multi-line, grows with its lines, bare -- what holds it pads it", () => <div class="g-field"><TextArea placeholder="Type several lines…" /><TextArea value={"Lorem ipsum dolor sit amet,\nconsectetur adipiscing elit."} /></div>),
    ] },
  ],
};
