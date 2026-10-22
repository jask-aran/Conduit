import { createSignal } from "solid-js";
import { Field, SettingWide, Card, CardBody } from "@/components/ui";
import { TextArea } from "@/components/ui";
import { row, token, type Page } from "../model";

function PromptExample() {
  const [prompt, setPrompt] = createSignal("Use the project conventions.\nKeep changes small and explain the result.");
  return <SettingWide><Field label="System prompt"><TextArea rows={3} spellcheck={false} value={prompt()} onInput={(event) => setPrompt(event.currentTarget.value)} /></Field></SettingWide>;
}
export const textareaPage: Page = {
  title: "TextArea",
  summary: "TextArea reads the surface's --tint and --well values.",
  preview: () => <PromptExample />,
  usage: `import { TextArea } from "@/components/ui";

<TextArea rows={1} aria-label="Message the agent"
  placeholder="Send a message…" value={draft()}
  onInput={(event) => setDraft(event.currentTarget.value)} />`,
  examples: [
    row("TextArea", "TextArea: multi-line, grows with its lines, bare -- what holds it pads it", () => <div class="g-field"><TextArea placeholder="Type several lines…" /><TextArea value={"Lorem ipsum dolor sit amet,\nconsectetur adipiscing elit."} /></div>),
    row("system prompt", "Editable multiline setting", () => <PromptExample />, { code: "SettingWide > Field > TextArea rows spellcheck onInput" }),
    row("disabled", "Composer while server is unavailable", () => <TextArea aria-label="Message" placeholder="Server unavailable" disabled />, { code: "<TextArea disabled>" }),
    row("read only", "Saved review comment", () => <TextArea aria-label="Saved comment" readOnly value="Keep the current folder when a terminal reconnects." />, { code: "<TextArea readOnly>" }),
    row("long review", "Long lines inside a review card", () => <Card title="Edit review comment"><CardBody><TextArea aria-label="Review comment" rows={4} value={"Keep the workspace path visible when this menu opens so the selected folder is clear. Verify the same path after the terminal reconnects.\nAlso preserve the active chat and its draft."} /></CardBody></Card>, { code: "Card > CardBody > TextArea rows", surfaces: ["ground"] }),
  ],
  tokens: [{ title: "TextArea", tokens: [
    token("--text-body", "Body text size"),
    token("--leading-row", "Line height"),
    token("--muted-foreground", "Quiet text or stroke colour"),
    token("--tint", "Surface tint"),
  ] }],
  api: ["TextArea"],
};
