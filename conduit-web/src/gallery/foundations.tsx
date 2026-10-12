import { createSignal, For, onCleanup, onMount, type JSX } from "solid-js";
import { ArrowUpIcon, CameraIcon, CopyIcon, FolderIcon, MicIcon, MonitorIcon, PaperclipIcon, PlusIcon, SettingsIcon, ShareIcon, Trash2Icon } from "lucide-solid";
import { Spinner } from "@/components/primitives";
import { Segmented, Bubble, Button, Frost, HeadingSection, Input, Item, Keycap, Menu, NavRow, Overlay, OverlayBar, PillButton, PillField, PillGroup, Section, SelectTrigger, TextArea, Toolbar } from "@/components/ui";
import { px, InUse, style, bg, fg, edge, rounding, tall, icon, FormTable, form, type Mark, type FormRow } from "./specs";
import { lib, Levels, SegmentedCount, SegmentedIcons, SegmentedText, SwitchDemo, type Family } from "./library";
import "katex/dist/katex.min.css";

/*
 * Foundations: what every family is built from -- type, colour, space,
 * radius, icons. Nothing here restates a value: each sample is drawn by the
 * library, and the readout beside it is read from the page, so a token
 * changed in library.css or in Tune CSS shows here as it does everywhere.
 */

type Read = (scope: HTMLElement) => [string, string][];

/** The readout: re-read when the cell flips density or the tuned CSS changes. */
function Readout(props: { read: Read }) {
  const [rows, setRows] = createSignal<[string, string][]>([]);
  let el!: HTMLDListElement;
  const measure = () => requestAnimationFrame(() => setRows(props.read(el.closest<HTMLElement>(".g-cell-body") ?? el)));
  onMount(() => {
    measure();
    const body = el.closest(".g-cell-body");
    const observer = new MutationObserver(measure);
    if (body) observer.observe(body, { attributes: true, attributeFilter: ["data-density"] });
    addEventListener("gallery:tune", measure);
    onCleanup(() => { observer.disconnect(); removeEventListener("gallery:tune", measure); });
  });
  return <dl ref={el} class="g-tokens"><For each={rows()}>{([name, value]) => <><dt>{name}</dt><dd>{value}</dd></>}</For></dl>;
}

/** The face a role resolves to: the first family of its stack (the one drawn once it loads). */
const face = (family: string) => family.split(",")[0]!.trim().replace(/^"|"$/g, "");
const Ground = (props: { children: JSX.Element }) => <div class="g-surface" data-surface="ground"><small>ground</small>{props.children}</div>;

/*
 * The token table: one row per token, its sample and value at desktop beside phone,
 * read off the page (a calc resolved to what it comes to), with what it is for.
 */
interface TokenRow { name: string; use: string; read: (cell: HTMLElement) => string; sample?: () => JSX.Element }
interface TokenGroup { title: string; rows: TokenRow[] }
/** A length token resolved in the cell's density. */
const length = (name: string) => (cell: HTMLElement) => {
  const raw = getComputedStyle(cell).getPropertyValue(name).trim();
  if (!/calc|var/.test(raw)) return px(raw);
  const el = document.createElement("div");
  el.style.position = "absolute"; el.style.width = `var(${name})`;
  cell.append(el); const value = getComputedStyle(el).width; el.remove();
  return px(value);
};
/** A length a piece's own class sets (the composer's), resolved on a bare element with that class. */
const classLength = (classes: string, name: string) => (cell: HTMLElement) => {
  const host = document.createElement("div"); host.className = classes; host.style.position = "absolute"; host.style.visibility = "hidden";
  const el = document.createElement("div"); el.style.width = `var(${name})`; host.append(el);
  cell.append(host); const value = getComputedStyle(el).width; host.remove();
  return px(value);
};
/** A two-value padding token (block, inline), each resolved in the cell's density. */
const pad = (name: string) => (cell: HTMLElement) => {
  const el = document.createElement("div"); el.style.position = "absolute"; el.style.padding = `var(${name})`;
  cell.append(el); const style = getComputedStyle(el); const value = `${style.paddingTop} ${style.paddingLeft}`; el.remove();
  return px(value);
};
const colour = (name: string) => (cell: HTMLElement) => getComputedStyle(cell).getPropertyValue(name).trim();
function TokenCell(props: { row: TokenRow; density?: "desktop" | "phone" }) {
  const [value, setValue] = createSignal("");
  let el!: HTMLDivElement;
  const measure = () => requestAnimationFrame(() => setValue(props.row.read(el)));
  onMount(() => { measure(); addEventListener("gallery:tune", measure); onCleanup(() => removeEventListener("gallery:tune", measure)); });
  return <div ref={el} class="g-scale-cell" data-density={props.density}>
    {props.row.sample && <div class="g-scale-sample">{props.row.sample()}</div>}
    <div class="g-scale-spec"><span>{value()}</span></div>
  </div>;
}
/** density: false for tokens that do not change with it (colours): one value column. */
function TokenTable(props: { groups: TokenGroup[]; density?: boolean }) {
  const dense = props.density !== false;
  return <div class="g-scale" data-columns={dense ? 3 : 2}>
    <div class="g-scale-head"><span>Token</span>{dense ? <><span>Desktop</span><span>Phone</span></> : <span>Value</span>}</div>
    <For each={props.groups}>{(group) => <>
      <div class="g-scale-group">{group.title}</div>
      <For each={group.rows}>{(row) => <div class="g-scale-row">
        <div class="g-scale-name"><strong>{row.name}</strong><small>{row.use}</small></div>
        {dense ? <><TokenCell row={row} density="desktop" /><TokenCell row={row} density="phone" /></> : <TokenCell row={row} />}
      </div>}</For>
    </>}</For>
  </div>;
}

const COLOUR_MARKS: Mark[] = [
  { selector: ".g-scene-frame", label: "--frame: the frame, behind the panes", read: bg },
  { selector: ".g-scene-pane", label: "--background: a pane", read: bg },
  { selector: ".ui-menu", label: "--frost-fill: frost", read: bg },
  { selector: ".ui-menu", label: "--frost-stroke: frost's edge", read: edge },
  { selector: ".ui-title", label: "--muted-foreground: a section label (and meta, icons at rest)", read: fg },
  { selector: ".ui-row[data-checked]", label: "--foreground: the current row", read: fg },
  { selector: ".ui-row[data-highlighted]", label: "--tint (frost's): the cursor's wash", read: bg },
  { selector: ".ui-section + .ui-section", label: "--tint (frost's): a rule between sections", read: edge },
  { selector: ".ui-row[data-destructive]", label: "--destructive: a destructive row", read: fg },
  { selector: ".ui-button[data-variant='secondary']", label: "--tint: a control's line, on the ground (Controls has each surface's)", read: edge },
];
const colourScene = () => <div class="g-scene-frame"><div class="g-scene-pane">
  <Menu><Section title="Section"><Item icon={<MonitorIcon />} checked>Current</Item><Item icon={<FolderIcon />} active>Cursor</Item><Item meta="2m">At rest</Item></Section><Section><Item icon={<Trash2Icon />} destructive>Delete</Item></Section></Menu>
  <Button variant="secondary" size="sm">Control</Button>
</div></div>;

const SPACE_MARKS: Mark[] = [
  { selector: ".ui-menu", label: "a popover's inset round its rows (--frost-inset)", read: (el) => px(style(el).paddingTop) },
  { selector: ".ui-row", label: "a row's height (--row-min)", read: tall },
  { selector: ".ui-row", label: "its padding, top and side (--row-pad)", read: (el) => `${px(style(el).paddingTop)} ${px(style(el).paddingLeft)}` },
  { selector: ".ui-row", label: "icon to label (--row-gap)", read: (el) => px(style(el).columnGap) },
  { selector: ".ui-row .ui-icon svg", label: "the icon (--u-icon)", read: (el) => px(`${el.getBoundingClientRect().width}px`) },
  { selector: ".ui-row .ui-label", label: "its text (--row-text)", read: (el) => px(style(el).fontSize) },
  { selector: ".ui-title", label: "a section label's height", read: tall },
];
const spaceScene = () => <Menu><Section title="Section"><Item icon={<FolderIcon />} meta="2m">A row</Item><Item icon={<MonitorIcon />}>Another</Item></Section></Menu>;

const RADIUS_MARKS: Mark[] = [
  { selector: ".ui-menu", label: "surface: a popover or card", read: rounding },
  { selector: ".ui-overlay", label: "surface: an overlay", read: rounding },
  { selector: ".ui-row[data-highlighted]", label: "control: a row", read: rounding },
  { selector: ".ui-keycap", label: "control: a keycap", read: rounding },
  { selector: ".ui-bubble", label: "message: the user's message", read: rounding },
  { selector: ".ui-pill-field", label: "message: the composer (the phone's field here; the desktop composer the same)", read: rounding },
  { selector: ".ui-pill[data-solo]", label: "round: a pill, a circle alone", read: rounding },
];
const radiusScene = () => <div class="g-scene-stack">
  <Menu><Section><Item icon={<FolderIcon />} active keys={["Ctrl", "K"]}>A row</Item><Item>Another</Item></Section></Menu>
  <Overlay label="Overlay" style={{ "--overlay-width": "100%" }}><OverlayBar lead={<PlusIcon />} placeholder="An overlay" /></Overlay>
  <Bubble>A message</Bubble>
  <div class="g-scene-row"><PillButton label="Camera" icon={<CameraIcon />} /><PillField placeholder="Message" /></div>
</div>;

const ICON_MARKS: Mark[] = [
  { selector: ".ui-row:not([data-checked]) .ui-icon svg", label: "a row's, at rest", read: icon },
  { selector: ".ui-row[data-checked] .ui-icon svg", label: "a current row's: the heavier stroke", read: icon },
  { selector: ".ui-nav-row svg", label: "the sidebar's", read: icon },
  { selector: ".ui-toolbar svg", label: "the composer toolbar's", read: icon },
  { selector: ".ui-pill:not([data-solo]) svg", label: "a pill group's: --pill-icon, a touch larger", read: icon },
  { selector: ".ui-pill[data-solo] svg", label: "a lone pill's: the same", read: icon },
];
const iconScene = () => <div class="g-scene-stack">
  <Menu><Section><Item icon={<PaperclipIcon />}>At rest</Item><Item icon={<MonitorIcon />} checked>Current</Item></Section></Menu>
  <div class="g-ground"><NavRow icon={<SettingsIcon />}>Sidebar</NavRow></div>
  <Frost class="g-entry"><Toolbar start={<Button variant="ghost" size="icon-sm" aria-label="Attach"><PlusIcon /></Button>} end={<><Button variant="ghost" size="icon-sm" aria-label="Voice"><MicIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Send"><ArrowUpIcon /></Button></>} /></Frost>
  <div class="g-scene-row"><PillGroup actions={[{ label: "Attach", icon: <PlusIcon /> }, { label: "Camera", icon: <CameraIcon /> }]} /><PillButton label="Voice" icon={<MicIcon />} /></div>
</div>;

const swatch = (name: string) => () => <i class="g-swatch-chip" style={{ background: `var(${name})` }} />;
/** An icon drawn at a size token. */
const glyph = (name: string) => () => <FolderIcon style={{ width: `var(${name})`, height: `var(${name})` }} />;
const bar = (name: string) => () => <i class="g-bar-chip" style={{ width: `var(${name})` }} />;
const corner = (name: string) => () => <Frost class="g-radius" style={{ "border-radius": `var(${name})` }} />;
const tok = (name: string, use: string, read: TokenRow["read"], sample?: TokenRow["sample"]): TokenRow => ({ name, use, read, sample });

const SIZES: TokenGroup[] = [{ title: "Five sizes, by role", rows: [
  tok("--text-label", "the section label, keycaps", length("--text-label")),
  tok("--text-caption", "details, hints and data: a heading's detail, the slider's value, key hints; meta, counts, crumbs", length("--text-caption")),
  tok("--text-row", "every row and control: rows, buttons, inputs, the segmented", length("--text-row")),
  tok("--text-body", "messages, what you type, answers; titles too, at the strong weight", length("--text-body")),
  tok("--text-heading", "a page's title (settings)", length("--text-heading")),
] }];
const weight = (name: string) => (cell: HTMLElement) => getComputedStyle(cell).getPropertyValue(name).trim();
const WEIGHTS: TokenGroup[] = [{ title: "Four weights", rows: [
  tok("--weight-rest", "text at rest, on the ground", weight("--weight-rest"), () => <span style={{ "font-weight": "var(--weight-rest)" }}>Rest</span>),
  tok("--weight-lift", "a touch heavier: text over frost, which reads thinner there; small controls", weight("--weight-lift"), () => <span style={{ "font-weight": "var(--weight-lift)" }}>Lift</span>),
  tok("--weight-strong", "headings and titles, buttons, values", weight("--weight-strong"), () => <span style={{ "font-weight": "var(--weight-strong)" }}>Strong</span>),
  tok("--weight-current", "where you are; a match lit while typing", weight("--weight-current"), () => <span style={{ "font-weight": "var(--weight-current)" }}>Current</span>),
] }];
const COLOURS: TokenGroup[] = [
  { title: "Grounds", rows: [tok("--frame", "the frame: the sidebar, behind the panes", colour("--frame"), swatch("--frame")), tok("--background", "a pane", colour("--background"), swatch("--background"))] },
  { title: "Text", rows: [tok("--foreground", "text, and the current item", colour("--foreground"), swatch("--foreground")), tok("--muted-foreground", "muted: labels, meta, captions, icons at rest", colour("--muted-foreground"), swatch("--muted-foreground"))] },
  { title: "Tints", rows: [tok("--tint", "a surface's lines and washes, which its controls read: the app's --border (and --accent, the same value) on the ground, --frost-tint over frost", colour("--tint"), swatch("--tint")), tok("--well", "a surface's well, under an input or an outline button: a step darker than the ground, nothing over frost", colour("--well"), swatch("--well")), tok("--frost-tint", "frost's lines and washes: rules, the cursor", colour("--frost-tint"), swatch("--frost-tint")), tok("--frost-stroke", "frost's edge", colour("--frost-stroke"), swatch("--frost-stroke"))] },
  { title: "Frost", rows: [tok("--frost-fill", "the material's fill (Frost has its blur, highlight and lifts)", colour("--frost-fill"), swatch("--frost-fill")), tok("--frost-core-ground", "core: a solid backing for busy content", colour("--frost-core-ground"), swatch("--frost-core-ground")), tok("--dim", "over what is behind: a desktop overlay (Scrim), the leader's lit composer (Spotlight), the phone's open sidebar; not behind a phone overlay, which fills the screen", colour("--dim"), swatch("--dim"))] },
  { title: "State", rows: [tok("--destructive", "a destructive action", colour("--destructive"), swatch("--destructive")), tok("--live", "a runtime dot: live", colour("--live"), swatch("--live")), tok("--warn", "a runtime dot: warning", colour("--warn"), swatch("--warn"))] },
];
/*
 * The scale: the coefficients, set on every document (the gallery's, each phone frame's at its own
 * mount) and remembered, so the whole gallery can be checked at any setting.
 */
const SCALES = [["--scale-ui", "UI scale", "everything"], ["--scale-transcript", "Transcript scale", "what you read"]] as const;
const storedScale = (token: string) => { try { return Number(localStorage.getItem(`gallery:${token}`)) || 1; } catch { return 1; } };
export function applyScale(doc: Document) {
  for (const [token] of SCALES) { const value = storedScale(token); if (value === 1) doc.documentElement.style.removeProperty(token); else doc.documentElement.style.setProperty(token, String(value)); }
}
/** The scales as one signal, shared by the Space page's sliders and the gallery's Settings (Appearance). */
const [scales, setScales] = createSignal<number[]>(SCALES.map(([token]) => storedScale(token)));
export const scaleOf = (token: (typeof SCALES)[number][0]) => scales()[SCALES.findIndex(([name]) => name === token)]!;
export function setScale(token: (typeof SCALES)[number][0], value: number) {
  const index = SCALES.findIndex(([name]) => name === token);
  try { localStorage.setItem(`gallery:${token}`, String(value)); } catch { /* private window */ }
  setScales((all) => all.map((old, at) => at === index ? value : old));
  for (const doc of [document, ...Array.from(document.querySelectorAll("iframe"), (frame) => frame.contentDocument)]) if (doc) applyScale(doc);
  dispatchEvent(new Event("gallery:tune"));
}
function ScaleControl() {
  return <div class="g-scale-control"><For each={[...SCALES]}>{([token, label, use]) => <label>
    <span><strong>{label}</strong><small>{use}</small></span>
    <input type="range" min="0.75" max="1.5" step="0.05" value={scaleOf(token)} onInput={(event) => setScale(token, Number(event.currentTarget.value))} />
    <code>{scaleOf(token).toFixed(2)}×</code>
    <button type="button" disabled={scaleOf(token) === 1} onClick={() => setScale(token, 1)}>Reset</button>
  </label>}</For></div>;
}
const number = (name: string) => (cell: HTMLElement) => `${Number(getComputedStyle(cell).getPropertyValue(name).trim() || 1)}×`;
const STEPS = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];
const STEP_USE: Record<string, string> = { "2xs": "0.125 units: a hairline's room (a field's 2px)", xs: "0.25: keys apart, a popover's inset (desktop)", sm: "0.375: a row's padding, a button's gap", md: "0.5: the commonest gap; a row's inset", lg: "0.75: a field's text inset, a choice's gap", xl: "1 unit: a card's gap, a list's indent", "2xl": "1.25: a card's edge, a page's top", "3xl": "1.5", "4xl": "2: a page's sides" };
const SPACE: TokenGroup[] = [
  { title: "Scale: the coefficients everything is drawn from (the sliders above)", rows: [tok("--scale-ui", "the whole UI: the unit times this", number("--scale-ui")), tok("--scale-transcript", "what you read: a message, its text, padding and corner", number("--scale-transcript"))] },
  { title: "The unit: the density's (12.8px desktop, 16px phone) times the UI scale", rows: [tok("--u-space", "space and controls", length("--u-space"), bar("--u-space")), tok("--u-type", "type: every size a multiple", length("--u-type"), bar("--u-type")), tok("--u-icon", "icons", length("--u-icon"), bar("--u-icon"))] },
  { title: "Space: nine steps, every gap, padding and margin", rows: STEPS.map((step) => tok(`--space-${step}`, STEP_USE[step]!, length(`--space-${step}`), bar(`--space-${step}`))) },
  { title: "Icons: five sizes", rows: [tok("--icon-xs", "a × in a tiny control: a chip's or a keycap's remove", length("--icon-xs"), glyph("--icon-xs")), tok("--icon-sm", "a chevron, a small control's glyph", length("--icon-sm"), glyph("--icon-sm")), tok("--icon", "the icon: a row's, a button's", length("--icon"), glyph("--icon")), tok("--icon-lg", "a pill's, a slider's value", length("--icon-lg"), glyph("--icon-lg")), tok("--icon-xl", "a ring: an upload's progress", length("--icon-xl"), glyph("--icon-xl"))] },
  { title: "Controls: four heights", rows: [tok("--control-xs", "an icon-xs button, a toast's ×", length("--control-xs"), bar("--control-xs")), tok("--control-sm", "a small button, an icon-sm button", length("--control-sm"), bar("--control-sm")), tok("--control", "a button, an input", length("--control"), bar("--control")), tok("--control-lg", "a rider button, a choice", length("--control-lg"), bar("--control-lg"))] },
  { title: "Rows: every list, menu, palette and settings row, and the sidebar's", rows: [tok("--row-min", "a row's height", length("--row-min"), bar("--row-min")), tok("--row-pad", "its padding", pad("--row-pad")), tok("--row-gap", "between icon, label and meta", length("--row-gap"), bar("--row-gap")), tok("--nav-indent", "a sidebar row under another", length("--nav-indent"), bar("--nav-indent")), tok("--nav-label-pad", "a sidebar group's label", pad("--nav-label-pad"))] },
  { title: "Frost", rows: [tok("--frost-inset", "a popover's padding round its rows", length("--frost-inset"), bar("--frost-inset"))] },
  { title: "Composer", rows: [tok("--composer-width", "declared by the pane, not the composer", (cell) => { const el = document.createElement("div"); el.style.position = "absolute"; el.style.width = "var(--composer-width, 47.5rem)"; cell.append(el); const value = getComputedStyle(el).width; el.remove(); return `${px(value)} (47.5rem unless the pane says)`; }), tok("--cmp-field-min", "the field's least height", classLength("ui-composer-field", "--cmp-field-min")), tok("--cmp-bar-min", "the toolbar's height", classLength("ui-toolbar", "--cmp-bar-min")), tok("--cmp-slot", "a toolbar button", classLength("ui-toolbar", "--cmp-slot"))] },
];
const RADII: TokenGroup[] = [
  { title: "Four radii (DESIGN.md rounded)", rows: [
    tok("--radius-control", "rows, buttons, inputs, keycaps, chips: in the density unit", length("--radius-control"), corner("--radius-control")),
    tok("--radius-surface", "popovers, cards, overlays: a control's plus the inset, so rows nest", length("--radius-surface"), corner("--radius-surface")),
    tok("--radius-message", "the composer (the phone's field too) and the user's message: one value on both; a capsule at one line, held as it grows", length("--radius-message"), corner("--radius-message")),
    tok("--radius-round", "fully round at any size: the phone's pill groups and buttons (they never grow), the slider, a chip's remove", length("--radius-round"), corner("--radius-round")),
  ] },
];

/*
 * Controls: what sits on any surface. A surface sets --tint (its lines and washes) and
 * --well (the fill under an input or a secondary button); a control reads only those.
 */
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
  form("icon", "an icon alone, in any form", () => <div class="g-row"><Button variant="ghost" size="icon-sm" aria-label="Copy"><CopyIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Share"><ShareIcon /></Button><Button variant="secondary" size="icon" aria-label="Add"><PlusIcon /></Button></div>, 'size="icon-sm" | "icon" | "icon-xs"', "1.875 / 2.25 / 1.5 units square · icon --u-icon"),
];
const BUTTON_ALL = "every form: 2.25 units tall · corner --radius-control · --text-row at --weight-strong";
const SEGMENTED: FormRow[] = [
  form("text", "two to four named peers: a settings choice", () => <SegmentedText />, "<Segmented options>", "track: line --tint, corner --radius-control · thumb --tint, corner --radius-control − 2px · labels --text-row --weight-lift, --muted-foreground, chosen --foreground"),
  form("counts", "a filter, each choice with its count: the dashboard's", () => <SegmentedCount />, "options: { count }", "count --text-caption --font-data, --muted-foreground"),
  form("icons", "icons alone: the sidebar's sections", () => <SegmentedIcons />, "<Segmented icons>", "2.25-unit squares · icon 1.125 × --u-icon"),
  form("small", "at a bar's end: chat search's sort", () => <SmallSegmented />, 'size="sm"', "labels --text-caption · 1.40625 units tall"),
];
const KEYCAPS: FormRow[] = [
  form("key", "a key or a chord beside a row, muted", () => <div class="g-row"><Keycap>Ctrl</Keycap><Keycap>K</Keycap></div>, "<Keycap>K</Keycap>", "1.125 units tall · corner 0.6 × --radius-control · fill --tint · --text-label --font-label --weight-lift · --muted-foreground"),
  form("on the cursor", "on the row the cursor is on, white", () => <Menu><Section><Item keys={["Ctrl", "K"]} active>Command palette</Item></Section></Menu>, "<Item keys={[…]} active>", ".ui-row[data-highlighted] .ui-keycap · --foreground"),
  form("leading", "the leader's key, at the row's start: white in the leader", () => <Menu class="ui-leader"><Section><Item keysFirst keys={["A"]}>Attach files</Item></Section></Menu>, "<Item keysFirst keys={[…]}> in <Leader>", ".ui-leader .ui-keys[data-first] · --foreground"),
  form("editable", "Settings · Shortcuts: pressed to record another, × clears it", () => <Keycap label="Ctrl K" onClick={() => {}} onRemove={() => {}}>Ctrl K</Keycap>, "<Keycap onClick onRemove>", "1.5625 units tall · --text-caption · --foreground · × --muted-foreground behind a --tint line · each part --tint washed"),
  form("pressable", "pressed to record another, not cleared here", () => <Keycap label="Ctrl Shift K" onClick={() => {}}>Ctrl Shift K</Keycap>, "<Keycap onClick>", "as editable, without the ×"),
];
function SmallSegmented() { const [value, setValue] = createSignal("recent"); return <Segmented size="sm" label="Sort" value={value()} onChange={setValue} options={[{ value: "recent", label: "Recent" }, { value: "relevant", label: "Relevant" }]} />; }

/** A typeface in the library: a specimen, the weights shipped, where it comes from. */
function Face(props: { family: string; weights?: number[]; sample?: string; source: string }) {
  return <div class="g-face">
    <div class="g-face-specimen" style={{ "font-family": props.family }}>{props.sample ?? "Aa Bb Gg 0123456789"}</div>
    <div class="g-face-sample" style={{ "font-family": props.family }}>The quick brown fox jumps over the lazy dog</div>
    {props.weights && <div class="g-face-weights"><For each={props.weights}>{(weight) => <span style={{ "font-family": props.family, "font-weight": weight }}>{weight}</span>}</For></div>}
    <small class="g-face-source">{props.source}</small>
  </div>;
}

/*
 * The roles: each a token the library draws with, and a switcher over the faces
 * it may take. library.css holds each default (the first option); a pick sets
 * the token on the gallery and its phone frames, and is remembered.
 */
const SANS = "sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Consolas, monospace";
const option = (value: string, label: string, family: string) => ({ value, label, family });
const GEIST = '"Geist Variable"', PAPER = '"Paper Mono"', INCONSOLATA = '"Inconsolata Variable"', MESLO = '"Meslo Nerd Font Mono"', WORDMARK = '"Conduit Wordmark"';
interface FontRole { token: string; title: string; fallback: string; options: ReturnType<typeof option>[]; uses: string; preview: () => JSX.Element }
const ROLES: FontRole[] = [
  { token: "--font-sans", title: "Main UI", fallback: SANS, uses: "Rows, headings, buttons, menus, cards, overlays; messages and the composer's text", options: [option("geist", "Geist", GEIST), option("paper", "Paper Mono", PAPER), option("system", "System", "system-ui")],
    preview: () => <><Menu><Section><Item icon={<FolderIcon />}>Add to a project folder</Item><Item icon={<MonitorIcon />} checked>Assistant</Item></Section></Menu><Bubble>A message in the main face</Bubble></> },
  { token: "--font-label", title: "Section labels", fallback: MONO, uses: "Muted caps over every section (popovers, cards, riders, the slider, the sidebar's groups), keycaps and the leader's crumbs", options: [option("paper", "Paper Mono", PAPER), option("inconsolata", "Inconsolata", INCONSOLATA), option("system", "System", "")],
    preview: () => <Menu><Section title="Profile"><Item icon={<FolderIcon />} keys={["Ctrl", "P"]}>Assistant</Item></Section><Section title="Model"><Item>GPT-6 Luna</Item></Section></Menu> },
  { token: "--font-data", title: "Data", fallback: MONO, uses: "Meta beside a row's title: times, counts, model ids, sizes; tabular, so numbers line up", options: [option("paper", "Paper Mono", PAPER), option("inconsolata", "Inconsolata", INCONSOLATA), option("system", "System", "")],
    preview: () => <Menu><Section><Item meta="2m ago">Lorem ipsum file</Item><Item meta="gpt-6-luna">Model</Item><Item meta="1,024">Tokens</Item></Section></Menu> },
  { token: "--font-code", title: "Code", fallback: MONO, uses: "Code blocks, previews and artifacts, the file editor", options: [option("paper", "Paper Mono", PAPER), option("inconsolata", "Inconsolata", INCONSOLATA), option("system", "System", "")],
    preview: () => <Frost class="g-entry"><pre class="ui-preview">{"~/Conduit $ npm run build\n✓ built in 10.4s  │ ├─ └─\nconst x = { a: 1, b: [2, 3] };"}</pre></Frost> },
  { token: "--font-terminal", title: "Terminal", fallback: MONO, uses: "The terminal pane: Meslo by default for its Nerd Font glyphs (prompt segments, file icons); yours to change", options: [option("meslo", "Meslo", MESLO), option("paper", "Paper Mono", PAPER), option("inconsolata", "Inconsolata", INCONSOLATA), option("system", "System", "")],
    preview: () => <pre class="g-terminal">{"\ue0b6 ~/Conduit \ue0b0 \ue0a0 main \ue0b4\n$ ls\n\uf07b src  \uf07b dist  \ue718 package.json  \uf48a README.md"}</pre> },
  { token: "--font-wordmark", title: "Wordmark", fallback: SANS, uses: "The brand at the top of the sidebar", options: [option("druk", "Druk", WORDMARK), option("geist", "Geist", GEIST), option("paper", "Paper Mono", PAPER)],
    preview: () => <Ground><span class="g-wordmark">Conduit</span></Ground> },
];
const roleKey = (role: FontRole) => `gallery:face${role.token}`;
const stored = (role: FontRole) => { try { return role.options.find((option) => option.value === localStorage.getItem(roleKey(role)))?.value ?? role.options[0]!.value; } catch { return role.options[0]!.value; } };
function applyRole(doc: Document, role: FontRole, value = stored(role)) {
  const family = role.options.find((option) => option.value === value)!.family;
  if (value === role.options[0]!.value) doc.documentElement.style.removeProperty(role.token);
  else doc.documentElement.style.setProperty(role.token, `${family ? family + ", " : ""}${role.fallback}`);
}
/** The picks, on a document: the gallery's at mount, each phone frame's at its own. */
export function applyFaces(doc: Document) { for (const role of ROLES) applyRole(doc, role); }

function Role(props: { role: FontRole }) {
  const [value, setValue] = createSignal(stored(props.role));
  const pick = (next: string) => {
    setValue(next);
    try { localStorage.setItem(roleKey(props.role), next); } catch { /* private window */ }
    for (const doc of [document, ...Array.from(document.querySelectorAll("iframe"), (frame) => frame.contentDocument)]) if (doc) applyRole(doc, props.role, next);
    dispatchEvent(new Event("gallery:tune"));
  };
  return <div class="g-role">
    <Segmented size="sm" label={props.role.title} value={value()} onChange={pick} options={props.role.options.map(({ value, label }) => ({ value, label }))} />
    <div class="g-role-preview">{props.role.preview()}</div>
    <p class="g-role-uses">{props.role.uses}</p>
    <Readout read={(scope) => [[props.role.token, getComputedStyle(scope).getPropertyValue(props.role.token).trim() || "—"]]} />
  </div>;
}

/** A type role: its specimen, drawn by the library, and the element in it that carries the role. */
/** tokens: what the role reads, so it can be named and tuned. */
interface TypeRole { name: string; tokens: string; rule: string; selector: string; sample: () => JSX.Element }
const onFrost = (children: JSX.Element) => <Menu>{children}</Menu>;
const onGround = (children: JSX.Element) => <div class="g-ground">{children}</div>;
const TYPE_ROLES: TypeRole[] = [
  { name: "Section label", tokens: "--text-label · --weight-rest · --font-label caps · muted", rule: "every section heading", selector: ".ui-title", sample: () => onFrost(<Section title="Section label"><Item>Row</Item></Section>) },
  { name: "Row", tokens: "--text-row · --weight-rest · text at 68%", rule: "every list, menu, palette and settings row; over frost", selector: ".ui-row:not([data-checked])", sample: () => onFrost(<Section><Item icon={<FolderIcon />}>Row at rest</Item></Section>) },
  { name: "Row · current", tokens: "--text-row · --weight-current · text", rule: "where you are: white at the current weight", selector: ".ui-row[data-checked]", sample: () => onFrost(<Section><Item icon={<MonitorIcon />} checked>Current row</Item></Section>) },
  { name: "Row · off frost", tokens: "--text-row · --weight-lift", rule: "the same row on the ground, the sidebar's included: a touch lighter and dimmer", selector: ".ui-nav-row", sample: () => onGround(<NavRow icon={<MonitorIcon />}>Row at rest</NavRow>) },
  { name: "Meta", tokens: "--text-caption · muted", rule: "beside a row's title, right-aligned", selector: ".ui-row > small", sample: () => onFrost(<Section><Item meta="2m ago">Row</Item></Section>) },
  { name: "Keycap", tokens: "--text-label · --weight-lift · --font-label", rule: "a key, on the surface's tint", selector: ".ui-keycap", sample: () => onFrost(<Section><Item keys={["Ctrl", "K"]}>Row</Item></Section>) },
  { name: "Heading", tokens: "--text-body · --weight-strong · text", rule: "a popover's or card's title", selector: ".ui-heading-title", sample: () => onFrost(<HeadingSection title="A heading" />) },
  { name: "Caption", tokens: "--text-caption · --weight-rest · muted", rule: "a heading's or card's detail, hints, empty copy", selector: ".ui-heading-detail", sample: () => onFrost(<HeadingSection title="A heading" detail="Its detail, muted" />) },
  { name: "Body", tokens: "--text-body · --weight-rest", rule: "messages and what you type: the type unit", selector: ".ui-bubble", sample: () => <Bubble>A message</Bubble> },
];
/** What a role computes to, in words: size/leading · weight · face, and its colour as the text colour, a share of it, or muted. */
function spec(el: Element | null) {
  if (!el) return ["—", ""];
  const style = getComputedStyle(el);
  const caps = style.textTransform === "uppercase" ? " caps" : "";
  const alpha = /\/ ([\d.]+)\)$/.exec(style.color);
  const colour = alpha ? `text at ${Math.round(Number(alpha[1]) * 100)}%` : /oklch\(0\.[0-7]/.test(style.color) ? "muted" : "text";
  return [px(`${style.fontSize}/${style.lineHeight} · ${style.fontWeight}`), `${face(style.fontFamily)}${caps} · ${colour}`];
}
function ScaleCell(props: { role: TypeRole; density: "desktop" | "phone" }) {
  const [value, setValue] = createSignal(["", ""]);
  let el!: HTMLDivElement;
  const measure = () => requestAnimationFrame(() => setValue(spec(el.querySelector(props.role.selector))));
  onMount(() => { measure(); addEventListener("gallery:tune", measure); onCleanup(() => removeEventListener("gallery:tune", measure)); });
  return <div class="g-scale-cell" data-density={props.density}>
    <div ref={el} class="g-scale-sample">{props.role.sample()}</div>
    <div class="g-scale-spec"><span>{value()[0]}</span><small>{value()[1]}</small></div>
  </div>;
}
function Scale() {
  return <div class="g-scale">
    <div class="g-scale-head"><span>Role</span><span>Desktop</span><span>Phone</span></div>
    <For each={TYPE_ROLES}>{(role) => <div class="g-scale-row">
      <div class="g-scale-name"><strong>{role.name}</strong><small>{role.rule}</small><small class="g-form-tokens">{role.tokens}</small></div>
      <ScaleCell role={role} density="desktop" /><ScaleCell role={role} density="phone" />
    </div>}</For>
  </div>;
}

export const foundationFamilies: Family[] = [
  { title: "Type", rail: "Foundations", note: "the text, top to bottom: the face each role takes, with a switcher; the scale, each role as the library draws it and as it computes; then every face Conduit ships, and the system's own last", groups: [
    { title: "Faces", note: "a token per role; the first option is library.css's default, a pick applies across the gallery", atoms: ROLES.map((role) => lib(`font-role${role.token}`, role.title, "both", "font", `${role.token} · library.css :root`, () => <Role role={role} />)) },
    { title: "Scale", note: "each role once, as DESIGN.md names it: drawn by the library at both densities, and what it computes to. Rest is grey, current white at 660 with no fill; text over frost is a touch heavier and brighter", layout: "desktop", atoms: [
      lib("type-scale", "Roles", "both", "type", "DESIGN.md Typography · library.css", () => <Scale />, "row"),
    ] },
    { title: "Sizes and weights", note: "the tokens Scale's roles are made of: every size and weight in the library is one of these", layout: "desktop", atoms: [
      lib("type-sizes", "Sizes", "both", "type", "library.css --text-*", () => <TokenTable groups={SIZES} />, true),
      lib("type-weights", "Weights", "both", "type", "library.css --weight-*", () => <TokenTable groups={WEIGHTS} density={false} />),
    ] },
    { title: "Icons", note: "Lucide at the type unit, so an icon is sized with the text beside it; muted at rest, its stroke a tenth of its size, an eighth when current (DESIGN.md Icons)", layout: "desktop", atoms: [
      lib("icon-inuse", "Icons in use", "both", "icon", "svg.lucide · --u-icon · --pill-icon", () => <InUse scene={iconScene} marks={ICON_MARKS} />, "row"),
    ] },
    { title: "Shipped", note: "the faces Conduit ships, so it looks the same on every system", layout: "desktop", atoms: [
      lib("font-geist", "Geist Variable", "both", "font", "@fontsource-variable/geist", () => <Face family={GEIST} weights={[400, 450, 500, 560, 600, 660, 700]} source="@fontsource-variable/geist · OFL" />),
      lib("font-paper", "Paper Mono", "both", "font", "components/ui/fonts/PaperMono-Variable.woff2", () => <Face family={PAPER} weights={[400, 500, 600, 700]} source="components/ui/fonts/PaperMono-Variable.woff2 · OFL · the section labels; also the app's optional transcript face" />),
      lib("font-inconsolata", "Inconsolata Variable", "both", "font", "@fontsource-variable/inconsolata", () => <Face family={INCONSOLATA} weights={[400, 500, 600, 700]} source="@fontsource-variable/inconsolata · OFL · drawn after Consolas" />),
      lib("font-meslo", "Meslo LG S Nerd Font Mono", "both", "font", "components/ui/fonts/MesloLGSNerdFontMono-Regular.ttf", () => <Face family={MESLO} sample="~/Conduit $ ls  │ ├─ └─ ✓ ✗" source="components/ui/fonts/MesloLGSNerdFontMono-Regular.ttf · the terminal's default, for its Nerd Font glyphs" />),
      lib("font-wordmark", "Druk Wide Super", "both", "font", "client/assets/fonts/druk-wide-web-super.woff2", () => <Face family={WORDMARK} sample="Conduit" source="client/assets/fonts/druk-wide-web-super.woff2 · as Conduit Wordmark" />),
      lib("font-katex", "KaTeX", "both", "font", "katex/dist/katex.min.css", () => <Face family="KaTeX_Main, serif" sample="∑ x² + ∫ f(t) dt = π" source="katex · math in messages, in its own serif faces" />),
    ] },
    { title: "Fallbacks", note: "the system's own: not shipped, so they differ by system; each role falls back to one", layout: "desktop", atoms: [
      lib("font-system-sans", "System sans", "both", "font", "system-ui, sans-serif", () => <Face family="system-ui, sans-serif" source="Segoe UI on Windows, SF Pro on Apple, Roboto on Android" />),
      lib("font-system-mono", "System mono", "both", "font", MONO, () => <Face family={MONO} sample="claude-opus-5-5  ~/src  12:04" source="SF Mono on Apple, Consolas on Windows, Droid Sans Mono on Android · meta, keycaps and times" />),
      lib("font-consolas", "Consolas", "both", "font", "local only", () => <Face family="Consolas, monospace" sample="claude-opus-5-5  ~/src  12:04" source="Microsoft's, with Windows and Office: not ours to ship · shown from this machine's copy" />),
    ] },
  ] },
  { title: "Colour", rail: "Foundations", note: "every colour once: grounds, text, one tint per surface for its lines and washes, frost's own, state. Text tones by role are in Type · Scale", groups: [{ title: "In use", note: "every colour in one scene: the frame, a pane, a popover on it", layout: "desktop", atoms: [
    lib("colour-inuse", "Colour in use", "both", "colour", "Menu · Section · Item · Button", () => <InUse scene={colourScene} marks={COLOUR_MARKS} density={false} />, "row"),
  ] }, { title: "Tokens", layout: "desktop", atoms: [
    lib("colour-tokens", "Colours", "both", "colour", "styles.css :root · library.css :root", () => <TokenTable groups={COLOURS} density={false} />, "row"),
  ] }] },
  { title: "Space", rail: "Foundations", note: "everything from a few numbers: the density's unit (12.8px desktop, 16px phone) times the UI scale, or the transcript scale for what you read. Every gap, padding and margin is one of nine steps; every control one of four heights; rows keep their measured height and text, in the unit (a phone's never below 44px). Move the scales and every page follows", groups: [{ title: "Scale", note: "the coefficients, remembered and applied to the whole gallery, its phone frames too: try any page at another setting", layout: "desktop", atoms: [
    lib("space-scale", "Scale", "both", "space", "library.css :root --scale-ui · --scale-transcript", () => <ScaleControl />, "row"),
  ] }, { title: "In use", note: "one popover, measured: what each number shapes. Everything is in the unit, so the phone's is the desktop's at 1.25x; rows take more, for a finger", layout: "desktop", atoms: [
    lib("space-inuse", "Space in use", "both", "space", "Menu · Section · Item", () => <InUse scene={spaceScene} marks={SPACE_MARKS} />, "row"),
  ] }, { title: "Tokens", note: "for reference", layout: "desktop", atoms: [
    lib("space-tokens", "Space", "both", "space", "library.css [data-density]", () => <TokenTable groups={SPACE} />, "row"),
  ] }] },
  { title: "Radius", rail: "Foundations", note: "four radii: control, surface (a control's plus the inset, so rows nest), message (the composer and the user's message, one value everywhere), round (pills, at any size)", groups: [{ title: "In use", note: "each shape the library draws, and its corner", layout: "desktop", atoms: [
    lib("radius-inuse", "Radius in use", "both", "radius", "Menu · Overlay · Bubble · PillField · PillButton", () => <InUse scene={radiusScene} marks={RADIUS_MARKS} />, "row"),
  ] }, { title: "Tokens", layout: "desktop", atoms: [
    lib("radius-tokens", "Radii", "both", "radius", "library.css --radius-*", () => <TokenTable groups={RADII} />, "row"),
  ] }] },
  { title: "Controls", rail: "Foundations", stage: true, note: "what sits on any surface. A surface sets two values, --tint (its lines and washes) and --well (the fill under an input or an outline button), and a control reads only those; so each is drawn once, on the surface and at the density picked above", groups: [
    { title: "In use", note: "the same controls on the ground and over frost: what each takes from the surface under it", layout: "desktop", atoms: [
      lib("controls-inuse", "Controls in use", "both", "control", "Button · Input · Segmented · Keycap on [data-surface]", () => <InUse scene={controlsScene} marks={CONTROL_MARKS} />, "row"),
    ] },
    { title: "Button", note: "each form on each surface; outline draws primary, ghost or destructive as a line in its colour. Which form an action takes is the place's choice (Card · actions, the composer, a settings line), not the button's. Every form: 2.25 units tall, corner --radius-control, --text-row at --weight-strong", staged: "density", atoms: [
      lib("button-forms", "Button · forms × surfaces", "both", "control", BUTTON_ALL, () => <FormTable rows={BUTTONS} on={["ground", "frost"]} />, "row"),
    ] },
    { title: "Segmented choice", note: "the frame too: the sidebar's sections", staged: "density", atoms: [
      lib("segmented-forms", "Segmented · forms × surfaces", "both", "control", "Segmented icons size", () => <FormTable rows={SEGMENTED} on={["frame", "ground", "frost"]} />, "row"),
    ] },
    { title: "Keycap", note: "each form on each surface", staged: "density", atoms: [
      lib("keycap-forms", "Keycap · forms × surfaces", "desktop", "control", "Keycap · Item keys", () => <FormTable rows={KEYCAPS} on={["ground", "frost"]} />, "row"),
    ] },
    { title: "Fields", staged: true, atoms: [
      lib("input", "Input", "both", "control", "Input", () => <div class="g-field"><Input placeholder="Replace" /><Input value="Lorem ipsum file" /></div>),
      lib("textarea", "TextArea", "both", "control", "TextArea: multi-line, grows with its lines, bare -- what holds it pads it", () => <div class="g-field"><TextArea placeholder="Type several lines…" /><TextArea value={"Lorem ipsum dolor sit amet,\nconsectetur adipiscing elit."} /></div>),
      lib("select", "Select", "both", "control", "SelectTrigger bare", () => <div class="g-field"><SelectTrigger value="System default" /><div class="g-row"><span>Provider</span><SelectTrigger bare value="OpenAI" /></div></div>),
    ] },
    { title: "Small", staged: true, atoms: [
      lib("slider", "Slider", "both", "control", "Slider", () => <div style={{ width: "240px" }}><Levels /></div>),
      lib("switch", "Switch", "both", "control", "Switch", () => <SwitchDemo />),
      lib("spinner", "Spinner", "both", "control", "Spinner", () => <Spinner />),
    ] },
  ] },
];
