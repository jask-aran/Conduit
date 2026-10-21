import { createSignal } from "solid-js";
import { Field, SettingWide, Card, CardBody } from "@/components/ui";
import { FormTable, form } from "../specs";
import { TextArea } from "@/components/ui";
import { lib, type Family } from "../model";

function PromptExample() {
  const [prompt, setPrompt] = createSignal("Use the project conventions.\nKeep changes small and explain the result.");
  return <SettingWide><Field label="System prompt"><TextArea rows={3} spellcheck={false} value={prompt()} onInput={(event) => setPrompt(event.currentTarget.value)} /></Field></SettingWide>;
}
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
      lib("textarea-examples", "Textarea · additional examples", "both", "control", "TextArea", () => <FormTable rows={[
        form("system prompt", "Editable multiline setting", () => <PromptExample />, "SettingWide > Field > TextArea rows spellcheck onInput"),
        form("disabled", "Composer while server is unavailable", () => <TextArea aria-label="Message" placeholder="Server unavailable" disabled />, "<TextArea disabled>"),
        form("read only", "Saved review comment", () => <TextArea aria-label="Saved comment" readOnly value="Keep the current folder when a terminal reconnects." />, "<TextArea readOnly>"),
        form("long review", "Long lines inside a review card", () => <Card title="Edit review comment"><CardBody><TextArea aria-label="Review comment" rows={4} value={"Keep the workspace path visible when this menu opens so the selected folder is clear. Verify the same path after the terminal reconnects.\nAlso preserve the active chat and its draft."} /></CardBody></Card>, "Card > CardBody > TextArea rows"),
      ]} on={["ground", "frost"]} />, "row"),
    ] },
  ],
};
