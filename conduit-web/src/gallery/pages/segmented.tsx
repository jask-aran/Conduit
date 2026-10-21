import { createSignal } from "solid-js";
import { Segmented } from "@/components/ui";
import { FormTable, form, type FormRow } from "../specs";
import { lib, type Family } from "../model";
import { SegmentedCount, SegmentedIcons, SegmentedText } from "../demos";
const SEGMENTED: FormRow[] = [
  form("text", "two to four named peers: a settings choice; choosing a side is felt on a phone (haptic select)", () => <SegmentedText />, "<Segmented options>", "track: line --tint, corner --radius-control · thumb --tint, corner --radius-control − 2px · labels --text-row --weight-lift, --muted-foreground, chosen --foreground"),
  form("counts", "a filter, each choice with its count: the dashboard's", () => <SegmentedCount />, "options: { count }", "count --text-caption --font-data, --muted-foreground"),
  form("icons", "icons alone: the sidebar's sections", () => <SegmentedIcons />, "<Segmented icons>", "2.25-unit squares · icon 1.125 × --u-icon"),
  form("small", "at a bar's end: chat search's sort", () => <SmallSegmented />, 'size="sm"', "labels --text-caption · --control-xs tall"),
];
function SmallSegmented() { const [value, setValue] = createSignal("recent"); return <Segmented size="sm" label="Sort" value={value()} onChange={setValue} options={[{ value: "recent", label: "Recent" }, { value: "relevant", label: "Relevant" }]} />; }

export const segmentedFamily: Family = {
  title: "Segmented", stage: true,
  note: "Segmented reads the surface's --tint and --well values, at the surface and density picked above.",
  usage: `import { Segmented } from "@/components/ui";

<Segmented arrows label="Chats" value={filter()} onChange={setFilter}
  options={[{ value: "all", label: "All" }, { value: "unread", label: "Unread" }]} />`,
  api: ["Segmented"],
  groups: [
    { title: "Examples", note: "the frame too: the sidebar's sections", staged: "density", atoms: [
      lib("segmented-forms", "Segmented · forms × surfaces", "both", "control", "Segmented icons size", () => <FormTable rows={SEGMENTED} on={["frame", "ground", "frost"]} />, "row"),
    ] },
  ],
};
