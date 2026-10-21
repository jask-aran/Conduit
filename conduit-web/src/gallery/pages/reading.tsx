import { Icons } from "@/components/ui";
import { Show } from "solid-js";
import { Button, Menu } from "@/components/ui";
import { FormTable, form, States } from "../specs";
import { Reading, ReadingTotal, ReadingParts, ReadingPart, ReadingStats, ReadingStat, ReadingFoot } from "@/components/ui";
import { type Family, lib } from "../model";
import { ContextReadingDemo } from "../demos";

export const readingFamily: Family = { title: "Reading", note: "what a gauge measures, read at a glance (reading.tsx): under its Meter one line of totals (the Meter's mark is quiet, its rule alone: the foot says where it compacts, beside Compact now); the parts as a legend, a dot, a name and a share, a part with parts of its own opening under itself; the cache as a line; compaction with Compact now; last, the account's figures (a plan's windows) as tiles under their name. All at the caption's size, numbers in the data face, so nothing outweighs the bar. The composer's gauge and the chat menu's Context draw it", usage: `import { Reading, ReadingTotal, ReadingParts, ReadingPart } from "@/components/ui";

<Reading>
  <ReadingTotal label="84k of 200k tokens" value="$0.42" />
  <ReadingParts>
    <ReadingPart label="Messages" value="60k · 30.0%" colour="oklch(0.72 0.15 300)" />
    <ReadingPart hollow label="Free space" value="116k · 58.0%" />
  </ReadingParts>
</Reading>`,
  api: ["Reading", "ReadingTotal", "ReadingParts", "ReadingPart", "ReadingStats", "ReadingStat", "ReadingFoot"],
  groups: [
    { title: "Examples", layout: "desktop", atoms: [
      lib("reading-examples", "Reading · examples", "both", "popover", "Menu > Reading", () => <FormTable on={["desktop", "phone"]} stacked rows={[
        form("Unavailable", "Label only; no totals or reset detail", () => <Menu><Reading><ReadingTotal label="Context unavailable" /><ReadingParts label="Context breakdown"><ReadingPart hollow label="Waiting for the first response" /></ReadingParts><ReadingStats title="Plan · Plus"><ReadingStat label="Weekly" value="Unavailable" /></ReadingStats><ReadingFoot>Start a turn to measure context.</ReadingFoot></Reading></Menu>, "<ReadingTotal label /> · <ReadingPart label /> · <ReadingStat label value /> · <ReadingFoot>"),
        form("Long tool name", "Nested names in a narrow context menu", () => <Menu width="sm"><Reading><ReadingParts label="What fills the window"><ReadingPart sub label="mcp__codemode__read_workspace_configuration_and_project_instructions" value="12k · 6.0%" /></ReadingParts></Reading></Menu>, '<Menu width="sm"><Reading><ReadingPart sub label value /></Reading></Menu>'),
        form("Compaction unavailable", "Disabled action while context is loading", () => <Menu><Reading><ReadingFoot action={<Button variant="ghost" outline size="sm" disabled><Icons.Compact />Compact now</Button>}>Context is still loading</ReadingFoot></Reading></Menu>, "<ReadingFoot action={<Button disabled />}>"),
      ]} />, "row"),
    ] },
    { atoms: [
      lib("reading-forms", "Reading · parts", "both", "popover", "components/ui/reading.tsx", () => <FormTable rows={[
        form("ReadingTotal", "what is used of what there is, and a figure at the end", () => <div style={{ width: "100%", "max-width": "calc(20 * var(--u-space))" }}><Reading><ReadingTotal label="84k of 200k tokens" value="$0.42" /></Reading></div>, "<ReadingTotal label value />"),
        form("ReadingParts · ReadingPart", "a legend: content, room (hollow), a part that opens (shut, then open with its own parts under it)", () => <States states={["Shut", "Open"] as const}>{(state) => <div style={{ width: "100%", "max-width": "calc(20 * var(--u-space))" }}><Reading><ReadingParts><ReadingPart colour="oklch(0.72 0.15 300)" label="Messages" value="60k · 30.0%" /><ReadingPart role="button" opens expanded={state() === "Open"} colour="oklch(0.74 0.12 230)" label="Tools (3)" value="12k · 6.0%" /><Show when={state() === "Open"}><ReadingPart sub label="read_file" value="4k" /><ReadingPart sub label="shell" value="3k" /></Show><ReadingPart hollow label="Free space" value="112k · 56.0%" /></ReadingParts></Reading></div>}</States>, "<ReadingParts><ReadingPart colour hollow opens expanded sub label value /></ReadingParts>", "--control-sm rows · --icon-dot · values --font-data"),
        form("ReadingStats · ReadingStat", "the account's figures, last, under their name: side by side, as many as there are, a number over its name, a line under it", () => <div style={{ width: "100%", "max-width": "calc(20 * var(--u-space))" }}><Reading><ReadingStats title="Plan · Plus"><ReadingStat label="5-hour" value="5%" detail="resets 1:47 pm" /><ReadingStat label="Weekly" value="17%" detail="resets Tue" /></ReadingStats></Reading></div>, "<ReadingStats><ReadingStat label value detail /></ReadingStats>", "--tint wells · --radius-inset · names in the label voice · numbers --text-row"),
        form("ReadingFoot", "a line and its one control: compaction and Compact now; the gauge's model and its session copy", () => <div style={{ width: "100%", "max-width": "calc(20 * var(--u-space))" }}><Reading><ReadingFoot action={<Button variant="ghost" outline size="sm"><Icons.Compact />Compact now</Button>}>Compacts at 85% · 2 so far</ReadingFoot><ReadingFoot action={<Button variant="ghost" size="sm">019a3f…3e70</Button>}>gpt-6-luna · Plus</ReadingFoot></Reading></div>, "<ReadingFoot action />"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
      lib("reading-whole", "Reading · a context window", "both", "popover", "chat/context-gauge.tsx ContextBreakdown", () => <Menu width="lg" unfolds><ContextReadingDemo /></Menu>),
    ] },
  ] };
