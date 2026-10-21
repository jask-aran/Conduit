import { CopyIcon, PlusIcon, ShareIcon } from "lucide-solid";
import { Button, Frost, Input, Keycap } from "@/components/ui";
import { InUse, bg, edge, FormTable, form, type Mark, type FormRow } from "../specs";
import { lib, type Family } from "../model";
import { SegmentedText } from "../demos";
const controls = () => <>
  <div class="g-scene-row"><Button variant="ghost" outline size="sm">Cancel</Button><Button outline size="sm">Save</Button><Button variant="secondary" size="sm">Browse…</Button></div>
  <Input value="Lorem ipsum file" />
  <SegmentedText />
  <div class="g-scene-row"><Keycap>Ctrl</Keycap><Keycap>K</Keycap></div>
</>;
const controlsScene = () => <div class="g-scene-stack">
  <div class="g-surface g-scene-surface g-scene-ground" data-surface="ground">{controls()}</div>
  <Frost lift="raised" class="g-surface g-scene-surface g-scene-frost">{controls()}</Frost>
</div>;
const none = (colour: string) => colour === "rgba(0, 0, 0, 0)" ? "none" : colour;
const onSurface = (where: "ground" | "frost", what: string, selector: string, read: Mark["read"]): Mark => ({ selector: `.g-scene-${where} ${selector}`, label: `${where}: ${what}`, read: (el) => none(read(el)) });
const CONTROL_MARKS: Mark[] = (["ground", "frost"] as const).flatMap((where) => [
  onSurface(where, "a secondary button's line (--tint)", ".ui-button[data-variant='secondary']", edge),
  onSurface(where, "an input's well (--well)", ".ui-input", bg),
  onSurface(where, "the segmented's line and thumb (--tint)", ".ui-seg", (el) => bg(el.querySelector<HTMLElement>(".ui-seg-thumb") ?? el)),
  onSurface(where, "a keycap (--tint)", ".ui-keycap", bg),
]);

const BUTTONS: FormRow[] = [
  form("primary", "filled in the text colour", () => <Button>Start</Button>, "<Button>", "fill --foreground · text --background"),
  form("primary · outline", "a line in the text colour", () => <Button outline>Save</Button>, "<Button outline>", "line and text --foreground · --tint washed"),
  form("secondary", "the surface's well inside a --tint line (over frost, no well: the same as ghost · outline)", () => <Button variant="secondary">Browse…</Button>, '<Button variant="secondary">', "fill --well · line --tint · --tint washed"),
  form("ghost", "text until washed", () => <Button variant="ghost">Skip</Button>, '<Button variant="ghost">', "nothing · --tint washed"),
  form("ghost · outline", "a --tint hairline, nothing inside", () => <Button variant="ghost" outline>Cancel</Button>, '<Button variant="ghost" outline>', "line --tint · --tint washed"),
  form("destructive", "filled red", () => <Button variant="destructive">Delete</Button>, '<Button variant="destructive">', "fill --destructive · text --foreground"),
  form("destructive · outline", "a line in red", () => <Button variant="destructive" outline>Delete chat</Button>, '<Button variant="destructive" outline>', "line and text --destructive · --destructive at 15% washed"),
  form("sizes", "sm at a bar's end, the default, lg where one action is the page's", () => <div class="g-row"><Button size="sm">Small</Button><Button>Default</Button><Button size="lg">Large</Button></div>, 'size="sm" | "lg"', "--control-sm, --control, --control-lg tall · lg --text-body, --space-2xl in"),
  form("icon", "an icon alone, in any form", () => <div class="g-row"><Button variant="ghost" size="icon-sm" aria-label="Copy"><CopyIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Share"><ShareIcon /></Button><Button variant="secondary" size="icon" aria-label="Add"><PlusIcon /></Button></div>, 'size="icon-sm" | "icon" | "icon-xs"', "1.875 / 2.25 / 1.5 units square · icon --u-icon"),
];
const BUTTON_ALL = "every form: --control tall · corner --radius-control · --text-row at --weight-strong";

export const buttonFamily: Family = {
  title: "Button", stage: true,
  note: "Button reads the surface's --tint and --well values, at the surface and density picked above.",
  usage: `import { Button } from "@/components/ui";

<Button variant="ghost" outline size="sm" onClick={() => save()}>
  Save
</Button>`,
  api: ["Button"],
  groups: [
    { title: "In use", note: "the same controls on the ground and over frost: what each takes from the surface under it", layout: "desktop", atoms: [
      lib("controls-inuse", "Controls in use", "both", "control", "Button · Input · Segmented · Keycap on [data-surface]", () => <InUse scene={controlsScene} marks={CONTROL_MARKS} />, "row"),
    ] },
    { title: "Button", note: "each form on each surface; outline draws primary, ghost or destructive as a line in its colour. Which form an action takes is the place's choice (Card · actions, the composer, a settings line), not the button's. Every form: 2.25 units tall, corner --radius-control, --text-row at --weight-strong", staged: "density", atoms: [
      lib("button-forms", "Button · forms × surfaces", "both", "control", BUTTON_ALL, () => <FormTable rows={BUTTONS} on={["ground", "frost"]} />, "row"),
    ] },
  ],
};
