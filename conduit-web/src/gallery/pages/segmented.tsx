// Props: label, value, options (value, label, icon, count, title), onChange, size (sm or omitted), pill, icons, arrows, disabled, id.
import { Icons, SettingLine } from "@/components/ui";
import { createSignal } from "solid-js";
import { Segmented } from "@/components/ui";
import { row, token, type Page } from "../model";
import { SegmentedCount, SegmentedIcons, SegmentedText } from "../demos";

function SmallSegmented() { const [value, setValue] = createSignal("recent"); return <Segmented size="sm" label="Sort" value={value()} onChange={setValue} options={[{ value: "recent", label: "Recent" }, { value: "relevant", label: "Relevant" }]} />; }

function SegmentedExample(props: { disabled?: boolean; pill?: boolean; long?: boolean }) {
  const [value, setValue] = createSignal("local");
  return <SettingLine plain label="Transcription source"><Segmented arrows disabled={props.disabled} pill={props.pill} label="Transcription source" value={value()} onChange={setValue} options={[
    { value: "local", label: props.long ? "Local models in conduit-web/workspace" : "Local", icon: <Icons.Terminal />, count: props.long ? 12 : undefined, title: "Models on this computer" },
    { value: "remote", label: props.long ? "Remote models on the development server" : "Remote", icon: <Icons.Terminal />, count: props.long ? 128 : undefined, title: "Models on the remote server" },
  ]} /></SettingLine>;
}

export const segmentedPage: Page = {
  title: "Segmented",
  summary: "Segmented reads the surface's --tint and --well values.",
  preview: () => <SegmentedText />,
  usage: `import { Segmented } from "@/components/ui";

<Segmented arrows label="Chats" value={filter()} onChange={setFilter}
  options={[{ value: "all", label: "All" }, { value: "unread", label: "Unread" }]} />`,
  anatomy: { scene: () => <SegmentedText />, parts: [
    { selector: ".ui-seg", name: "Group", does: "holds one set of choices", from: "Segmented options" },
    { selector: ".ui-seg-thumb", name: "Thumb", does: "moves behind the selected choice", from: "Segmented value" },
    { selector: ".ui-seg button[aria-checked=\"true\"]", name: "Choice", does: "shows the selected option", from: "Segmented value" },
  ] },
  examples: [
    row("keyboard choice", "Arrow keys select; setting label stays beside the control.", () => <SegmentedExample />, { code: "<SettingLine><Segmented arrows /></SettingLine>" }),
    row("disabled", "Transcription source waits while settings save.", () => <SegmentedExample disabled />, { code: "<Segmented disabled arrows />" }),
    row("pill", "Floating icon choices with accessible labels.", () => <SegmentedExample pill />, { code: "<Segmented pill />", surfaces: ["ground"] }),
    row("long labels", "Long folder names beside icons and counts.", () => <SegmentedExample long />, { code: "<Segmented options={[{ value, label, icon, count, title }]} />" }),
    row("text", "two to four named peers: a settings choice; choosing a side is felt on a phone (haptic select) track: line --tint, corner --radius-control · thumb --tint, corner --radius-control − 2px · labels --text-row --weight-lift, --muted-foreground, chosen --foreground", () => <SegmentedText />, { code: "<Segmented options>" , surfaces: ["frame", "ground", "frost"] }),
    row("counts", "a filter, each choice with its count: the dashboard's count --text-caption --font-data, --muted-foreground", () => <SegmentedCount />, { code: "options: { count }" , surfaces: ["frame", "ground", "frost"] }),
    row("icons", "icons alone: the sidebar's sections 2.25-unit squares · icon 1.125 × --u-icon", () => <SegmentedIcons />, { code: "<Segmented icons>" , surfaces: ["frame", "ground", "frost"] }),
    row("small", "at a bar's end: chat search's sort labels --text-caption · --control-xs tall", () => <SmallSegmented />, { code: 'size="sm"' , surfaces: ["frame", "ground", "frost"] }),
  ],
  tokens: [{ title: "Segmented", tokens: [
    token("--radius-control", "Control corner"),
    token("--control-sm", "Choice height"),
    token("--tint", "Surface tint"),
    token("--text-row", "Control text size"),
    token("--duration-gentle", "Value change duration"),
  ] }],
  api: ["Segmented"],
};
