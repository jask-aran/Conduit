import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ArrowUpIcon, CameraIcon, FolderIcon, MicIcon, MonitorIcon, PaperclipIcon, PlusIcon, SettingsIcon, Trash2Icon } from "lucide-solid";

import { ServerControl, Reading, ReadingStats, ReadingStat, HeaderPill, Expand, Aura, Slider, Segmented, Preview, Bubble, Button, Frost, HeadingSection, Item, Keycap, Menu, NavRow, Overlay, OverlayBar, PillButton, PillField, PillGroup, Section, Toolbar } from "@/components/ui";
import { px, style, bg, fg, edge, rounding, tall, icon } from "./specs";

import { Glyph, HarnessMark, IDENTITY_COLOURS, Icons, MARKS, ThreadHarnessMark } from "@/components/ui";
import { FileTypeIcon, FolderTypeIcon } from "@/components/ui/file-marks";
import { haptic, type Haptic } from "@/components/ui/haptics";
import { palettePages } from "./palettes";
import { row, token, type Page, type Part } from "./model";

import "katex/dist/katex.min.css";

/*
 * Foundations: what every family is built from -- type, colour, space,
 * radius, icons. Nothing here restates a value: each sample is drawn by the
 * library, and the readout beside it is read from the page, so a token
 * changed in foundations.css or in Tune CSS shows here as it does everywhere.
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
export function TokenTable(props: Record<"groups", TokenGroup[]> & { density?: boolean }) {
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

const COLOUR_MARKS: Part[] = [
  { selector: ".g-scene-frame", name: "--frame", does: "the frame, behind the panes", from: bg },
  { selector: ".g-scene-pane", name: "--background", does: "a pane", from: bg },
  { selector: ".ui-menu", name: "--frost-fill", does: "frost", from: bg },
  { selector: ".ui-menu", name: "--frost-stroke", does: "frost's edge", from: edge },
  { selector: ".ui-title", name: "--muted-foreground", does: "a section label (and meta, icons at rest)", from: fg },
  { selector: ".ui-row[data-checked]", name: "--foreground", does: "the current row", from: fg },
  { selector: ".ui-row[data-highlighted]", name: "--tint (frost's)", does: "the cursor's wash", from: bg },
  { selector: ".ui-section + .ui-section", name: "--tint (frost's)", does: "a rule between sections", from: edge },
  { selector: ".ui-row[data-destructive]", name: "--destructive", does: "a destructive row", from: fg },
  { selector: ".ui-button[data-variant='secondary']", name: "--tint", does: "a control's line, on the ground (Controls has each surface's)", from: edge },
];
const colourScene = () => <div class="g-scene-frame"><div class="g-scene-pane">
  <Menu><Section title="Section"><Item icon={<MonitorIcon />} checked>Current</Item><Item icon={<FolderIcon />} active>Cursor</Item><Item meta="2m">At rest</Item></Section><Section><Item icon={<Trash2Icon />} destructive>Delete</Item></Section></Menu>
  <Button variant="secondary" size="sm">Control</Button>
</div></div>;

const SPACE_MARKS: Part[] = [
  { selector: ".ui-menu", name: "a popover's inset", does: "round its rows (--frost-inset)", from: (el) => px(style(el).paddingTop) },
  { selector: ".ui-row", name: "a row's height", does: "set by --row-min", from: tall },
  { selector: ".ui-row", name: "its padding", does: "top and side (--row-pad)", from: (el) => `${px(style(el).paddingTop)} ${px(style(el).paddingLeft)}` },
  { selector: ".ui-row", name: "icon to label", does: "gap set by --row-gap", from: (el) => px(style(el).columnGap) },
  { selector: ".ui-row .ui-icon svg", name: "the icon", does: "(--u-icon)", from: (el) => px(`${el.getBoundingClientRect().width}px`) },
  { selector: ".ui-row .ui-label", name: "its text", does: "(--row-text)", from: (el) => px(style(el).fontSize) },
  { selector: ".ui-title", name: "a section label", does: "its height", from: tall },
];
const spaceScene = () => <Menu><Section title="Section"><Item icon={<FolderIcon />} meta="2m">A row</Item><Item icon={<MonitorIcon />}>Another</Item></Section></Menu>;

const RADIUS_MARKS: Part[] = [
  { selector: ".ui-menu", name: "surface", does: "a popover or card", from: rounding },
  { selector: ".ui-overlay", name: "surface", does: "an overlay", from: rounding },
  { selector: ".ui-row[data-highlighted]", name: "control", does: "a row", from: rounding },
  { selector: ".ui-keycap", name: "control", does: "a keycap", from: rounding },
  { selector: ".ui-bubble", name: "message", does: "the user's message", from: rounding },
  { selector: ".ui-pill-field", name: "message", does: "the composer (the phone's field here; the desktop composer the same)", from: rounding },
  { selector: ".ui-pill[data-solo]", name: "round", does: "a pill, a circle alone", from: rounding },
];
const radiusScene = () => <div class="g-scene-stack">
  <Menu><Section><Item icon={<FolderIcon />} active keys={["Ctrl", "K"]}>A row</Item><Item>Another</Item></Section></Menu>
  <Overlay label="Overlay" style={{ "--overlay-width": "100%" }}><OverlayBar lead={<PlusIcon />} placeholder="An overlay" /></Overlay>
  <Bubble>A message</Bubble>
  <div class="g-scene-row"><PillButton label="Camera" icon={<CameraIcon />} /><PillField placeholder="Message" /></div>
</div>;

const ICON_MARKS: Part[] = [
  { selector: ".ui-row:not([data-checked]) .ui-icon svg", name: "a row's icon", does: "at rest", from: icon },
  { selector: ".ui-row[data-checked] .ui-icon svg", name: "a current row's", does: "the heavier stroke", from: icon },
  { selector: ".ui-nav-row svg", name: "the sidebar's icon", does: "sized with its row", from: icon },
  { selector: ".ui-toolbar svg", name: "the composer toolbar's icon", does: "sized with its controls", from: icon },
  { selector: ".ui-pill:not([data-solo]) svg", name: "a pill group's", does: "--pill-icon, a touch larger", from: icon },
  { selector: ".ui-pill[data-solo] svg", name: "a lone pill's", does: "the same", from: icon },
];
const iconScene = () => <div class="g-scene-stack">
  <Menu><Section><Item icon={<PaperclipIcon />}>At rest</Item><Item icon={<MonitorIcon />} checked>Current</Item></Section></Menu>
  <div class="g-ground"><NavRow icon={<SettingsIcon />}>Sidebar</NavRow></div>
  <Frost class="g-entry"><Toolbar start={<Button variant="ghost" size="icon-sm" aria-label="Attach"><PlusIcon /></Button>} end={<><Button variant="ghost" size="icon-sm" aria-label="Voice"><MicIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Send"><ArrowUpIcon /></Button></>} /></Frost>
  <div class="g-scene-row"><PillGroup actions={[{ label: "Attach", icon: <PlusIcon /> }, { label: "Camera", icon: <CameraIcon /> }]} /><PillButton label="Voice" icon={<MicIcon />} /></div>
</div>;

const swatch = (name: string) => () => <i class="g-swatch-chip" style={{ background: `var(${name})` }} />;
/** A token's value as it computes (a number, a shadow). */
const value = (name: string) => (cell: HTMLElement) => getComputedStyle(cell).getPropertyValue(name).trim();
/** A card standing off the page at a lift. */
const lifted = (name: string) => () => <i class="g-lift" style={{ "box-shadow": `var(${name})` }} />;
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
  tok("--text-heading", "a page's title (settings), a compact dashboard's", length("--text-heading")),
  tok("--text-display", "a dashboard's title: the one page-sized title, larger than a heading (it grows with the window to 1.41×)", length("--text-display")),
] }];
const weight = (name: string) => (cell: HTMLElement) => getComputedStyle(cell).getPropertyValue(name).trim();
const WEIGHTS: TokenGroup[] = [{ title: "Four weights", rows: [
  tok("--weight-rest", "text at rest, on the ground", weight("--weight-rest"), () => <span style={{ "font-weight": "var(--weight-rest)" }}>Rest</span>),
  tok("--weight-lift", "a touch heavier: text over frost, which reads thinner there; small controls", weight("--weight-lift"), () => <span style={{ "font-weight": "var(--weight-lift)" }}>Lift</span>),
  tok("--weight-strong", "headings and titles, buttons, values", weight("--weight-strong"), () => <span style={{ "font-weight": "var(--weight-strong)" }}>Strong</span>),
  tok("--weight-current", "where you are; a match lit while typing", weight("--weight-current"), () => <span style={{ "font-weight": "var(--weight-current)" }}>Current</span>),
] }];
/** Two lines of text at a leading step, so its spacing shows. */
const lines = (name: string) => () => <span style={{ display: "block", "line-height": `var(${name})`, "max-width": "var(--measure-2xs)" }}>Two lines of text at this leading</span>;
const LEADING: TokenGroup[] = [{ title: "Six leading steps", rows: [
  tok("--leading-none", "one line set solid: a display title, a glyph", value("--leading-none"), lines("--leading-none")),
  tok("--leading-tight", "a heading; a row's name over its detail", value("--leading-tight"), lines("--leading-tight")),
  tok("--leading-row", "rows and controls; short notes in a state", value("--leading-row"), lines("--leading-row")),
  tok("--leading-text", "running text that is not a message: notes, captions, a pane's empty state", value("--leading-text"), lines("--leading-text")),
  tok("--leading-code", "code and the terminal", value("--leading-code"), lines("--leading-code")),
  tok("--leading-reading", "a message, read at length", value("--leading-reading"), lines("--leading-reading")),
] }, { title: "Tracking", rows: [
  tok("--label-tracking", "the section label's letter spacing, uppercase (a theme can change the label's face, case and tracking)", value("--label-tracking"), () => <span style={{ "letter-spacing": "var(--label-tracking)", "text-transform": "uppercase", "font-size": "var(--text-label)" }}>Section</span>),
] }];
/** Text at an emphasis step. */
const faded = (name: string) => () => <span style={{ opacity: `var(${name})` }}>Text</span>;
const OPACITY: TokenGroup[] = [{ title: "Four steps down from full", rows: [
  tok("--opacity-rest", "a part quieter than its row at rest: a chevron, a detail, a mark", value("--opacity-rest"), faded("--opacity-rest")),
  tok("--opacity-muted", "quieter again: a branch not taken, a struck-out step, a separator", value("--opacity-muted"), faded("--opacity-muted")),
  tok("--opacity-disabled", "what cannot be used now", value("--opacity-disabled"), faded("--opacity-disabled")),
  tok("--opacity-faint", "barely there: a pulse at its low point", value("--opacity-faint"), faded("--opacity-faint")),
] }];
const COLOURS: TokenGroup[] = [
  { title: "Grounds", rows: [tok("--frame", "the frame: the sidebar, behind the panes", colour("--frame"), swatch("--frame")), tok("--background", "a pane", colour("--background"), swatch("--background")), tok("--popover", "a raised panel on the ground: the editor's tooltips and panels, a line comment", colour("--popover"), swatch("--popover")), tok("--card", "a framed item on the ground: an attachment, a warning, the drop target", colour("--card"), swatch("--card"))] },
  { title: "Text", rows: [tok("--foreground", "text, and the current item", colour("--foreground"), swatch("--foreground")), tok("--muted-foreground", "muted: labels, meta, captions, icons at rest", colour("--muted-foreground"), swatch("--muted-foreground"))] },
  { title: "Tints", rows: [tok("--tint", "a surface's lines and washes, which its controls read: the app's --border on the ground, --frost-tint over frost", colour("--tint"), swatch("--tint")), tok("--well", "a surface's well, under an input or an outline button: a step darker than the ground, nothing over frost", colour("--well"), swatch("--well")), tok("--frost-tint", "frost's lines and washes: rules, the cursor", colour("--frost-tint"), swatch("--frost-tint")), tok("--frost-stroke", "frost's edge", colour("--frost-stroke"), swatch("--frost-stroke"))] },
  { title: "Frost", rows: [tok("--frost-fill", "the material's fill (Frost has its blur, highlight and lifts)", colour("--frost-fill"), swatch("--frost-fill")), tok("--frost-core-ground", "core: a solid backing for busy content", colour("--frost-core-ground"), swatch("--frost-core-ground")), tok("--dim", "over what is behind: a desktop overlay (Scrim), the leader's lit composer (Spotlight), the phone's open sidebar; not behind a phone overlay, which fills the screen", colour("--dim"), swatch("--dim"))] },
  { title: "Filled", rows: [tok("--primary", "the one filled control: a primary button, a switch that is on", colour("--primary"), swatch("--primary")), tok("--primary-foreground", "what sits on it", colour("--primary-foreground"), swatch("--primary-foreground"))] },
  { title: "Focus", rows: [tok("--ring", "a field's edge while typing, a dragged edge, the review's hairline", colour("--ring"), swatch("--ring")), tok("--region-focus", "the cue under a region focus moved to", colour("--region-focus"), swatch("--region-focus"))] },
  { title: "State", rows: [tok("--destructive", "a destructive action", colour("--destructive"), swatch("--destructive")), tok("--live", "a runtime dot: live", colour("--live"), swatch("--live")), tok("--warn", "a runtime dot: warning", colour("--warn"), swatch("--warn"))] },
  { title: "Change", rows: [
    tok("--change-added", "added content", colour("--change-added"), swatch("--change-added")),
    tok("--change-modified", "modified content", colour("--change-modified"), swatch("--change-modified")),
    tok("--change-removed", "removed content", colour("--change-removed"), swatch("--change-removed")),
  ] },
  { title: "Brand", rows: [
    tok("--brand-claude-code", "Claude Code brand", colour("--brand-claude-code"), swatch("--brand-claude-code")),
  ] },
];
/*
 * The scale: the user's Interface size and each region's own size per density (foundations.css, Scale), set on every
 * document (the gallery's, each phone frame's at its own mount) and remembered, so the whole gallery can be checked at
 * any setting and the regions tuned against each other. Copy gives the line foundations.css keeps.
 */
const REGIONS = [["chrome", "Chrome", "headers, panes, files, the dashboard: everything not below"], ["sidebar", "Sidebar", "the sidebar, its rail and its head"],
  ["frost", "Frost", "what floats: menus, popovers, overlays (settings, the palette), cards, toasts"], ["composer", "Composer", "the composer, its riders; the phone's composer row"],
  ["transcript", "Transcript", "what you read: messages, the answer, its traces"]] as const;
const DENSITIES = ["desktop", "phone"] as const;
type ScaleToken = "--ui-scale" | `--scale-${(typeof REGIONS)[number][0]}-${(typeof DENSITIES)[number]}`;
const SCALES: ScaleToken[] = ["--ui-scale", ...REGIONS.flatMap(([region]) => DENSITIES.map((density) => `--scale-${region}-${density}` as const))];
// A region's size unless one is picked here: foundations.css's own.
const shipped = (token: ScaleToken) => token === "--ui-scale" ? 1 : Number(getComputedStyle(document.documentElement).getPropertyValue(token).trim()) || 1;
const storedScale = (token: ScaleToken) => { try { const value = localStorage.getItem(`gallery:${token}`); return value === null ? null : Number(value) || null; } catch { return null; } };
export function applyScale(doc: Document) {
  for (const token of SCALES) { const value = storedScale(token); if (value === null) doc.documentElement.style.removeProperty(token); else doc.documentElement.style.setProperty(token, String(value)); }
}
/** The scales as one signal, shared by the Space page's sliders and the gallery's Settings (Appearance). */
const [scales, setScales] = createSignal<Record<string, number | null>>(Object.fromEntries(SCALES.map((token) => [token, storedScale(token)])));
export const scaleOf = (token: ScaleToken) => scales()[token] ?? shipped(token);
export function setScale(token: ScaleToken, value: number | null) {
  try { if (value === null) localStorage.removeItem(`gallery:${token}`); else localStorage.setItem(`gallery:${token}`, String(value)); } catch { /* private window */ }
  setScales((all) => ({ ...all, [token]: value }));
  for (const doc of [document, ...Array.from(document.querySelectorAll("iframe"), (frame) => frame.contentDocument)]) if (doc) applyScale(doc);
  dispatchEvent(new Event("gallery:tune"));
}
function ScaleSlider(props: { token: ScaleToken }) {
  return <span class="g-scale-slider">
    <input type="range" min="0.75" max="1.5" step="0.025" aria-label={props.token} value={scaleOf(props.token)} onInput={(event) => setScale(props.token, Number(event.currentTarget.value))} />
    <code>{scaleOf(props.token).toFixed(3)}×</code>
    <button type="button" title="Back to foundations.css" aria-label={`Reset ${props.token}`} disabled={scales()[props.token] == null} onClick={() => setScale(props.token, null)}>↺</button>
  </span>;
}
function ScaleControl() {
  const line = () => `:root {\n  ${DENSITIES.map((density) => REGIONS.map(([region]) => `--scale-${region}-${density}: ${+scaleOf(`--scale-${region}-${density}`).toFixed(3)};`).join(" ")).join("\n  ")}\n}`;
  return <div class="g-scale-control">
    <label><span><strong>Interface size</strong><small>the user's one setting (Settings · Interface): every region at once</small></span><ScaleSlider token="--ui-scale" /></label>
    <div class="g-scale-regions">
      <span /><strong>Desktop</strong><strong>Phone</strong>
      <For each={[...REGIONS]}>{([region, label, use]) => <>
        <span><strong>{label}</strong><small>{use}</small></span>
        <For each={[...DENSITIES]}>{(density) => <ScaleSlider token={`--scale-${region}-${density}`} />}</For>
      </>}</For>
    </div>
    <p><button type="button" onClick={() => void navigator.clipboard.writeText(line())}>Copy region sizes</button> <small>the :root line for foundations.css, from the sizes picked here</small></p>
  </div>;
}
const number = (name: string) => (cell: HTMLElement) => `${Number(getComputedStyle(cell).getPropertyValue(name).trim() || 1)}×`;
const STEPS = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];
const STEP_USE: Record<string, string> = { "2xs": "0.125 units: a hairline's room (a field's 2px)", xs: "0.25: keys apart, a popover's inset (desktop)", sm: "0.375: a row's padding, a button's gap", md: "0.5: the commonest gap; a row's inset", lg: "0.75: a field's text inset, a choice's gap", xl: "1 unit: a card's gap, a list's indent", "2xl": "1.25: a card's edge, a page's top", "3xl": "1.5", "4xl": "2: a page's sides" };
const DEPTH: TokenGroup[] = [
  { title: "Layers: the page's stack, bottom to top (a piece's own stacking stays inside it)", rows: [
    tok("--layer-nav", "the sidebar's pane, over what slides under its edge", value("--layer-nav")),
    tok("--layer-dock", "the workspace dock floating over the panes, and its edge", value("--layer-dock")),
    tok("--layer-drawer", "a phone's drawer (the sidebar's), its Backdrop just under it", value("--layer-drawer")),
    tok("--layer-drop", "a dragged tab's drop wash over the panes it can land on", value("--layer-drop")),
    tok("--layer-panel", "the phone's workspace panel, over the sidebar's drawer", value("--layer-panel")),
    tok("--layer-cue", "the region cue: the page dimmed round where a key moved focus", value("--layer-cue")),
    tok("--layer-leader", "the leader's dim, its card one above", value("--layer-leader")),
    tok("--layer-drag", "the pill a dragged tab or row travels as", value("--layer-drag")),
    tok("--layer-dialog", "a dialog, and the terminal's full-screen route", value("--layer-dialog")),
    tok("--layer-popover", "a menu, submenu or picker, over everything it opens from", value("--layer-popover")),
    tok("--layer-notification", "a toast, over everything", value("--layer-notification")),
  ] },
  { title: "Elevation: how far a surface stands off the page", rows: [
    tok("--lift-rest", "laid over what it belongs to: a tooltip, a docked card; frost at rest", value("--lift-rest"), lifted("--lift-rest")),
    tok("--lift-raised", "over everything round it: the floating dock, a popover, the drop card; raised frost", value("--lift-raised"), lifted("--lift-raised")),
    tok("--lift-side", "a pane slid over its neighbour from the left (Files' tree, narrow)", value("--lift-side"), lifted("--lift-side")),
  ] },
  { title: "Dims: what is behind, held back", rows: [
    tok("--dim", "a desktop overlay's scrim, the leader's spotlight, the phone's open sidebar", value("--dim"), swatch("--dim")),
    tok("--dim-faint", "the region cue: reads without hiding the page", value("--dim-faint"), swatch("--dim-faint")),
  ] },
];
const SPACE: TokenGroup[] = [
  { title: "Scale: the coefficients everything is drawn from (the sliders above)", rows: [tok("--scale-ui", "the whole UI: the unit times this", number("--scale-ui")), tok("--scale-transcript", "what you read: a message, its text, padding and corner", number("--scale-transcript"))] },
  { title: "The unit: the density's (16px desktop and phone) times the Interface size and the region's size", rows: [tok("--u-space", "space and controls", length("--u-space"), bar("--u-space")), tok("--u-type", "type: every size a multiple", length("--u-type"), bar("--u-type")), tok("--u-icon", "icons", length("--u-icon"), bar("--u-icon"))] },
  { title: "Space: nine steps, every gap, padding and margin", rows: STEPS.map((step) => tok(`--space-${step}`, STEP_USE[step]!, length(`--space-${step}`), bar(`--space-${step}`))) },
  { title: "Icons: five sizes and a dot", rows: [tok("--icon-xs", "a × in a tiny control: a chip's or a keycap's remove", length("--icon-xs"), glyph("--icon-xs")), tok("--icon-sm", "a chevron, a small control's glyph", length("--icon-sm"), glyph("--icon-sm")), tok("--icon", "the icon: a row's, a button's", length("--icon"), glyph("--icon")), tok("--icon-lg", "a pill's, a slider's value", length("--icon-lg"), glyph("--icon-lg")), tok("--icon-xl", "a ring: an upload's progress", length("--icon-xl"), glyph("--icon-xl")), tok("--icon-dot", "a dot: a status, recording", length("--icon-dot"), bar("--icon-dot"))] },
  { title: "Controls: six heights", rows: [tok("--control-2xs", "a keycap, a slider's thumb", length("--control-2xs"), bar("--control-2xs")), tok("--control-xs", "an icon-xs button, a toast's ×", length("--control-xs"), bar("--control-xs")), tok("--control-tool", "a workspace tool's button, a file header's, a tree row", length("--control-tool"), bar("--control-tool")), tok("--control-sm", "a small button, an icon-sm button", length("--control-sm"), bar("--control-sm")), tok("--control", "a button, an input", length("--control"), bar("--control")), tok("--control-lg", "a rider button, a choice", length("--control-lg"), bar("--control-lg"))] },
  { title: "Measures: six lengths for what has a width of its own", rows: [tok("--measure-xs", "a menu's least width, the composer's tallest field, a chip's name", length("--measure-xs"), bar("--measure-xs")), tok("--measure-sm", "a settings rail, a preview's height", length("--measure-sm"), bar("--measure-sm")), tok("--measure-md", "a setting's control column, a step's output", length("--measure-md"), bar("--measure-md")), tok("--measure-lg", "a toast", length("--measure-lg"), bar("--measure-lg")), tok("--measure-xl", "a card, the leader", length("--measure-xl"), bar("--measure-xl")), tok("--measure-2xl", "an overlay, a wide card, the user's message", length("--measure-2xl"), bar("--measure-2xl"))] },
  { title: "Rows: every list, menu, palette and settings row, and the sidebar's", rows: [tok("--row-min", "a row's height", length("--row-min"), bar("--row-min")), tok("--row-pad", "its padding", pad("--row-pad")), tok("--row-gap", "between icon, label and meta", length("--row-gap"), bar("--row-gap")), tok("--nav-indent", "a sidebar row under another", length("--nav-indent"), bar("--nav-indent")), tok("--nav-label-pad", "a sidebar group's label", pad("--nav-label-pad"))] },
];
/** A piece's own sizes, read from the unit: shown with the piece (Frost, DesktopComposer). */
export const FROST_SIZES: TokenGroup[] = [
  { title: "Frost", rows: [tok("--frost-inset", "a popover's padding round its rows", length("--frost-inset"), bar("--frost-inset"))] },
];
export const COMPOSER_SIZES: TokenGroup[] = [
  { title: "Composer", rows: [tok("--composer-width", "declared by the pane, not the composer", (cell) => { const el = document.createElement("div"); el.style.position = "absolute"; el.style.width = "var(--composer-width, var(--reading-width))"; cell.append(el); const value = getComputedStyle(el).width; el.remove(); return `${px(value)} (--reading-width unless the pane says)`; }), tok("--cmp-field-min", "the field's least height", classLength("ui-composer-field", "--cmp-field-min")), tok("--cmp-bar-min", "the toolbar's height", classLength("ui-toolbar", "--cmp-bar-min")), tok("--cmp-slot", "a toolbar button", classLength("ui-toolbar", "--cmp-slot"))] },
];
/** A dot crossing a track, again and again, at a token's pace or along its curve. */
const run = (duration: string, easing: string) => () => <div class="g-run"><span style={{ "animation-duration": duration, "animation-timing-function": easing }} /></div>;
/** The page's moves, on a sketch of it: sidebar, reading, and the composer that stays put. */
const LEVELS = Array.from({ length: 11 }, (_, i) => ({ value: (i / 10).toFixed(1), label: (i / 10).toFixed(1) }));
/* Aura: the field on a pill-shaped and a round surface, its level moved by hand or by a voice, its strength by hand. */
function AuraDemo() {
  const [level, setLevel] = createSignal(0), [voice, setVoice] = createSignal(false), [strength, setStrength] = createSignal("1.0");
  let t = 0;
  const timer = setInterval(() => { if (!voice()) return; t += 1; setLevel(Math.max(0, Math.min(1, (Math.sin(t / 3) * .5 + .5) * (Math.sin(t / 11) * .4 + .6) * (.5 + Math.random() * .5)))); }, 70);
  onCleanup(() => clearInterval(timer));
  return <div class="g-aura">
    <div class="g-aura-row"><div class="ui-frost ui-pill g-aura-wide"><Aura on level={level()} strength={Number(strength())} /></div><div class="ui-frost ui-pill g-aura-short"><Aura on level={level()} strength={Number(strength())} /></div><div class="ui-frost g-aura-round"><Aura on level={level()} strength={Number(strength())} /></div></div>
    <div class="g-aura-row"><Button variant="secondary" size="sm" onClick={() => setVoice(!voice())}>{voice() ? "Stop the voice" : "Speak"}</Button><Slider label="Level" options={LEVELS} value={(Math.round(level() * 10) / 10).toFixed(1)} onChange={(v) => { setVoice(false); setLevel(Number(v)); }} /><Slider label="Strength" options={LEVELS} value={strength()} onChange={setStrength} /><code>--aura-level {level().toFixed(2)}</code></div>
  </div>;
}

function PageMoves() {
  const [run, setRun] = createSignal<"open" | "leave" | "arrive">("arrive"), [n, setN] = createSignal(0);
  const play = (move: "open" | "leave") => { setRun(move); setN(n() + 1); if (move === "leave") setTimeout(() => setRun("arrive"), parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--duration-quick"))); };
  return <div class="g-replay">
    <div class="g-replay-bar"><Button size="sm" variant="ghost" outline onClick={() => play("open")}>First open</Button><Button size="sm" variant="ghost" outline onClick={() => play("leave")}>Change route</Button></div>
    <Show when={n() + 1} keyed>{(_) => <div class="g-sketch" data-run={run()}>
      <div class="g-sketch-side"><NavRow current>Chats</NavRow><NavRow>Japan</NavRow><NavRow>Conduit</NavRow></div>
      <div class="g-sketch-main"><div class="g-sketch-read"><Bubble>make the second paragraph shorter</Bubble><p class="g-muted">Done -- the paragraph is two sentences now.</p></div>
        <Frost class="g-sketch-composer">Send a message…</Frost></div>
    </div>}</Show>
  </div>;
}

const MOTION: TokenGroup[] = [
  { title: "Three curves", rows: [
    tok("--ease-arrive", "arriving, opening, settling: long and gentle", colour("--ease-arrive"), run("1.2s", "var(--ease-arrive)")),
    tok("--ease-leave", "leaving, folding away: it accelerates out", colour("--ease-leave"), run("1.2s", "var(--ease-leave)")),
    tok("--ease-change", "a change in place: a wash, a turn, a colour", colour("--ease-change"), run("1.2s", "var(--ease-change)")),
  ] },
  { title: "Two durations: quick out, gentle in", rows: [
    tok("--duration-quick", "leaving, folding away; a change in place", colour("--duration-quick"), run("var(--duration-quick)", "var(--ease-leave)")),
    tok("--duration-gentle", "arriving, opening, settling into place", colour("--duration-gentle"), run("var(--duration-gentle)", "var(--ease-arrive)")),
  ] },
  { title: "Expand: the fold, both ways on one curve", rows: [
    tok("--duration-fold", "what opens in place under its row: a folder's chats, a search folder's", colour("--duration-fold"), run("var(--duration-fold)", "var(--ease-fold)")),
  ] },
  { title: "Travel: something large going further", rows: [
    tok("--duration-travel", "the composer docking after a first send; a split opening beside the chat", colour("--duration-travel"), run("var(--duration-travel)", "var(--ease-arrive)")),
  ] },
  { title: "Effects keep their own time", rows: [
    tok("--duration-follow", "a level following a voice (the aura)", colour("--duration-follow"), run("var(--duration-follow)", "linear")),
    tok("--duration-flash", "a copy's wash fading", colour("--duration-flash"), run("var(--duration-flash)", "ease-out")),
    tok("--duration-spin", "a spinner's turn; three times slower when motion is reduced", colour("--duration-spin"), run("var(--duration-spin)", "linear")),
    tok("--duration-pulse", "a recording's dot", colour("--duration-pulse"), run("var(--duration-pulse)", "ease-in-out")),
    tok("--duration-breathe", "something live: a pressed mic, a block still writing", colour("--duration-breathe"), run("var(--duration-breathe)", "ease-in-out")),
  ] },
];

const RADII: TokenGroup[] = [
  { title: "Four radii and an inset (DESIGN.md rounded)", rows: [
    tok("--radius-control", "rows, buttons, inputs, keycaps, chips: in the density unit", length("--radius-control"), corner("--radius-control")),
    tok("--radius-inset", "a keycap's or inline code's: a control's, nested", length("--radius-inset"), corner("--radius-inset")),
    tok("--radius-surface", "popovers, cards, overlays: a control's plus the inset, so rows nest", length("--radius-surface"), corner("--radius-surface")),
    tok("--radius-message", "the composer (the phone's field too), its riders and the user's message, one value among them: 1.125 units at the transcript's scale (14.4px desktop, 18px phone): under half a one-line bubble's height, so one line is a rounded box, never a pill", length("--radius-message"), corner("--radius-message")),
    tok("--radius-round", "fully round at any size: the phone's pill groups and buttons (they never grow), the slider, a chip's remove", length("--radius-round"), corner("--radius-round")),
  ] },
];

/*
 * Controls: what sits on any surface. A surface sets --tint (its lines and washes) and
 * --well (the fill under an input or a secondary button); a control reads only those.
 */
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
 * it may take. foundations.css holds each default (the first option); a pick sets
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
    preview: () => <Frost class="g-entry"><Preview>{"~/Conduit $ npm run build\n✓ built in 10.4s  │ ├─ └─\nconst x = { a: 1, b: [2, 3] };"}</Preview></Frost> },
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
/** sig: what the role computes to, in tokens -- the type lens names text by it. A role made of two (Field: the label's
 *  voice and a caption) has none of its own. where: the app's places that use it. */
export type TypeSig = { size: "label" | "caption" | "row" | "body" | "heading" | "display"; weight: "rest" | "lift" | "strong" | "current"; face: "sans" | "mono"; caps?: boolean };
export interface TypeRole { name: string; tokens: string; rule: string; where: string; sig?: TypeSig; selector: string; sample: () => JSX.Element }
const onFrost = (children: JSX.Element) => <Menu>{children}</Menu>;
const onGround = (children: JSX.Element) => <div class="g-ground">{children}</div>;
export const TYPE_ROLES: TypeRole[] = [
  { name: "Section label", tokens: "--text-label · --weight-rest · --font-label caps · muted", rule: "every section heading", where: "every menu and popover section (SERVERS, MODEL, APP), the sidebar's PROJECTS, a settings group's title", sig: { size: "label", weight: "rest", face: "mono", caps: true }, selector: ".ui-title", sample: () => onFrost(<Section title="Section label"><Item>Row</Item></Section>) },
  { name: "Row", tokens: "--text-row · --weight-rest · text at 68%", rule: "every list, menu, palette and settings row; over frost", where: "menu, palette, chat search and settings rows; the chat menu's Share, Rename; the plus menu's choices", sig: { size: "row", weight: "rest", face: "sans" }, selector: ".ui-row:not([data-checked])", sample: () => onFrost(<Section><Item icon={<FolderIcon />}>Row at rest</Item></Section>) },
  { name: "Row · current", tokens: "--text-row · --weight-current · text", rule: "where you are: white at the current weight", where: "the server you are on, the picked model or profile, the sidebar server line's name", sig: { size: "row", weight: "current", face: "sans" }, selector: ".ui-row[data-checked]", sample: () => onFrost(<Section><Item icon={<MonitorIcon />} checked>Current row</Item></Section>) },
  { name: "Row · off frost", tokens: "--text-row · --weight-lift", rule: "the same row on the ground, the sidebar's included: a touch lighter and dimmer", where: "the sidebar's chats, projects and folders; the dashboard's lists", sig: { size: "row", weight: "lift", face: "sans" }, selector: ".ui-nav-row", sample: () => onGround(<NavRow icon={<MonitorIcon />}>Row at rest</NavRow>) },
  { name: "Meta", tokens: "--text-caption · --font-data · muted", rule: "beside a row's title, right-aligned: a time, a count, a latency", where: "a menu row's latency (14 ms), a chat's age, a model's harness (conduit-test), counts", sig: { size: "caption", weight: "rest", face: "mono" }, selector: ".ui-row > small", sample: () => onFrost(<Section><Item meta="2m ago">Row</Item></Section>) },
  { name: "Data", tokens: "--text-caption · --weight-rest · --font-data · muted", rule: "a figure, state or value that is not a row's meta: a server's state and latency, a reading's shares, a row's second line when it is a value (Item detailData: an address, a command); a description there stays Caption", where: "the sidebar server line's Connected · 14 ms, Route's address, the terminal's commands and sessions, a reading's shares", sig: { size: "caption", weight: "rest", face: "mono" }, selector: ".ui-server-copy > small", sample: () => onGround(<div style={{ width: "calc(16 * var(--u-space))" }}><ServerControl name="Desktop-Dev" detail="Connected · 14 ms" connectivity="online" /></div>) },
  { name: "Figure", tokens: "--text-row · --weight-rest · --font-data · text", rule: "a reading's number, the one thing its tile says", where: "the context reading's plan tiles (17%)", sig: { size: "row", weight: "rest", face: "mono" }, selector: ".ui-reading-stat > dd:first-of-type", sample: () => onFrost(<Reading><ReadingStats title="Plan"><ReadingStat label="Weekly" value="17%" detail="resets Tue" /></ReadingStats></Reading>) },
  { name: "Field", tokens: "Section label · its value --text-caption · --font-sans · quiet", rule: "a section's title that unfolds or slides: the name in the label's voice, its value quiet beside it", where: "the chat menu's CONTEXT and DETAILS rows", selector: ".ui-row[data-field] > small", sample: () => onFrost(<Section><Item field meta="8% used" opens>Context</Item></Section>) },
  { name: "Pill title", tokens: "--text-caption · --weight-strong · text, two lines", rule: "a phone's header pill naming the page", where: "the phone header's chat title pill", sig: { size: "caption", weight: "strong", face: "sans" }, selector: ".ui-header-pill > strong", sample: () => <span>a phone's alone: see the Phone canvas<HeaderPill label="Researching Gassho Houses in Japan" /></span> },
  { name: "Keycap", tokens: "--text-label · --weight-lift · --font-label", rule: "a key, on the surface's tint", where: "shortcuts in the command palette, menus and the leader", sig: { size: "label", weight: "lift", face: "mono" }, selector: ".ui-keycap", sample: () => onFrost(<Section><Item keys={["Ctrl", "K"]}>Row</Item></Section>) },
  { name: "Heading", tokens: "--text-body · --weight-strong · text", rule: "a popover's or card's title", where: "a popover's, card's or dialog's title", sig: { size: "body", weight: "strong", face: "sans" }, selector: ".ui-heading-title", sample: () => onFrost(<HeadingSection title="A heading" />) },
  { name: "Caption", tokens: "--text-caption · --weight-rest · muted", rule: "a heading's or card's detail, hints, empty copy", where: "a heading's detail, a row's description (a profile's blurb), hints, empty copy, a Field's value", sig: { size: "caption", weight: "rest", face: "sans" }, selector: ".ui-heading-detail", sample: () => onFrost(<HeadingSection title="A heading" detail="Its detail, muted" />) },
  { name: "Body", tokens: "--text-body · --weight-rest", rule: "messages and what you type: the type unit", where: "messages, the composer, what you type", sig: { size: "body", weight: "rest", face: "sans" }, selector: ".ui-bubble", sample: () => <Bubble>A message</Bubble> },
];
/** What a role computes to, in words: size/leading · weight · face, and its colour as the text colour, a share of it, or muted. */
function spec(el: Element | null) {
  if (!el) return ["—", ""];
  const style = getComputedStyle(el);
  const caps = style.textTransform === "uppercase" ? " caps" : "";
  const alpha = /\/ ([\d.]+)\)$/.exec(style.color);
  const colour = alpha ? `text at ${Math.round(Number(alpha[1]) * 100)}%` : /oklch\(0\.[0-7]/.test(style.color) ? "muted" : "text";
  return [px(`${style.fontSize}/${style.lineHeight} · ${style.fontWeight}`), `${face(style.getPropertyValue("font-family"))}${caps} · ${colour}`];
}
function TypeSample(props: { role: TypeRole }) {
  const [value, setValue] = createSignal(["", ""]);
  let el!: HTMLDivElement;
  const measure = () => requestAnimationFrame(() => setValue(spec(el.querySelector(props.role.selector))));
  onMount(() => { measure(); addEventListener("gallery:tune", measure); onCleanup(() => removeEventListener("gallery:tune", measure)); });
  return <div class="g-scale-cell">
    <div ref={el} class="g-scale-sample">{props.role.sample()}</div>
    <div class="g-scale-spec"><span>{value()[0]}</span><small>{value()[1]}</small></div>
  </div>;
}
const vocabulary: [keyof typeof Icons, string, number][] = [
  ["Add", "Add an item or open creation options.", 6],
  ["ArrowDown", "Download, move downward or reach recent content.", 4],
  ["ArrowUp", "Move upward or publish changes.", 4],
  ["Attach", "Attach files to a message.", 3],
  ["Back", "Return to the previous view.", 3],
  ["Backspace", "Delete text before the cursor.", 2],
  ["Boxes", "A collection or grouped identity.", 0],
  ["Camera", "Capture a photo attachment.", 2],
  ["Chat", "A chat or its messages.", 6],
  ["Check", "A selected, successful or completed state.", 7],
  ["ChevronDown", "Expand a choice or move to the next match.", 15],
  ["ChevronLeft", "Return to the previous item.", 4],
  ["ChevronRight", "Open a child item or move forward.", 11],
  ["Close", "Close or dismiss the current surface.", 19],
  ["Code", "Run a script or show code.", 2],
  ["CollapseFiles", "Collapse the file navigation.", 3],
  ["Compact", "Compact the chat context.", 1],
  ["Copy", "Copy content to the clipboard.", 10],
  ["Dashboard", "The application dashboard.", 3],
  ["Delete", "Delete the selected item.", 12],
  ["Download", "Download a file or update.", 7],
  ["Edit", "Edit or rename the selected item.", 16],
  ["ExpandFiles", "Expand the file navigation.", 2],
  ["ExternalLink", "Open a destination outside the current view.", 4],
  ["Fetch", "Fetch content from the web.", 2],
  ["File", "A file with no more specific type.", 3],
  ["FileCode", "A source file, file path or source view.", 4],
  ["FileDiff", "File changes or an unstaged diff.", 6],
  ["FileText", "A text file, prompt or document view.", 6],
  ["Focus", "Give keyboard focus to the terminal.", 2],
  ["Folder", "A folder or workspace location.", 13],
  ["GitBranch", "A source-control branch.", 2],
  ["GitCompareArrows", "Review source-control changes.", 5],
  ["Hide", "Hide content from view.", 2],
  ["Home", "The home directory or home view.", 2],
  ["Image", "An image file or attachment.", 2],
  ["InsertText", "Insert or edit text at the cursor.", 2],
  ["Keyboard", "Keyboard input and shortcuts.", 4],
  ["LocalModel", "A model hosted on this machine.", 1],
  ["LogOut", "Sign out of the server.", 3],
  ["Maximize", "Expand a pane or attachment.", 6],
  ["Message", "A message or agent narration.", 3],
  ["Microphone", "Microphone.", 3],
  ["Minimize", "Restore a pane to its smaller size.", 2],
  ["Monitor", "This computer or display appearance.", 4],
  ["More", "Additional actions for this item.", 7],
  ["MoveToFolder", "Move a chat into a folder.", 3],
  ["NewChat", "Start a new chat.", 5],
  ["NewFolder", "Create a folder.", 5],
  ["Notification", "An agent notification.", 1],
  ["Permissions", "Agent permissions and approval policy.", 4],
  ["Pin", "Keep an item in place.", 3],
  ["PinOff", "Release a pinned item.", 3],
  ["Play", "Continue or start an operation.", 3],
  ["Preview", "View content or show a preview.", 5],
  ["Proceed", "Confirm a location or sign in.", 2],
  ["Profile", "A harness profile or grouped profiles.", 3],
  ["QrCode", "Scan or show a pairing code.", 4],
  ["Reasoning", "Reasoning controls or thinking content.", 2],
  ["Refresh", "Refresh, retry, reload or regenerate.", 8],
  ["Reset", "Reset a value or restart an action.", 2],
  ["Runtime", "Runtime activity and status.", 2],
  ["Search", "Find content, commands or items.", 18],
  ["Send", "Send a message.", 3],
  ["Server", "A connected server.", 2],
  ["ServiceLevel", "The model service level.", 1],
  ["Settings", "Application, workspace and terminal settings.", 6],
  ["Share", "Share a chat or its link.", 2],
  ["Shell", "A shell command or terminal tool.", 3],
  ["Sidebar", "Show or hide the left sidebar.", 5],
  ["Split", "Show two panes or comparison columns.", 8],
  ["Stop", "Stop the current operation.", 5],
  ["Swap", "Swap pane or comparison sides.", 3],
  ["Terminal", "A terminal, command or command palette.", 11],
  ["Thinking", "Agent thinking or reasoning.", 2],
  ["Tool", "A tool without a more specific kind.", 2],
  ["Undo", "Undo an edit or discard changes.", 4],
  ["Upload", "Upload a file.", 2],
  ["Warning", "A warning or failed operation.", 3],
  ["Workspace", "Show or hide the workspace panel.", 6],
  ["WorkspaceIdentity", "Edit the workspace identity.", 3],
  ["WrapText", "Toggle line wrapping.", 5],
  ["WriteFile", "A file-writing tool.", 2],
];

const KINDS: { kind: Haptic; what: string; pieces: string; strength: string }[] = [
  { kind: "select", what: "a side chosen", pieces: "Segmented, PillSwitch", strength: "light" },
  { kind: "press", what: "a press that acts at once", pieces: "PillButton with haptic=\"press\": the mic, Send, Stop", strength: "light" },
  { kind: "hold", what: "a long press opening a context menu", pieces: "ContextMenu on a touch screen", strength: "medium" },
  { kind: "fold", what: "what a row holds opening or shutting, just after a touch", pieces: "Expand, Disclosure", strength: "light" },
  { kind: "dismiss", what: "an overlay closing, just after a touch", pieces: "Menu, submenu, Popover, Dialog, the phone's drawer", strength: "light" },
];

export const typePage: Page = {
  title: "Type", rail: "Foundations",
  summary: "Text roles define each face, size, weight and line height, with face switches and shipped and system font samples. The Type lens names text across the gallery and phone and desktop previews: hover for sizes, pick a role to isolate it, and use red dashed marks to find combinations with no role.",
  preview: ROLES[0]!.preview,
  examples: [
    ...ROLES.map((role) => row(role.title, role.uses, () => <Role role={role} />, { surfaces: ["ground"], phone: true })),
    ...TYPE_ROLES.map((role) => row(role.name, `${role.rule}; in the app: ${role.where}; ${role.tokens}`, () => <TypeSample role={role} />, { surfaces: ["ground"], phone: role.name === "Pill title" ? "only" : true })),
    row("Geist Variable", "@fontsource-variable/geist", () => <Face family={GEIST} weights={[400, 450, 500, 560, 600, 660, 700]} source="@fontsource-variable/geist · OFL" />, { surfaces: ["ground"] }),
    row("Paper Mono", "components/ui/fonts/PaperMono-Variable.woff2", () => <Face family={PAPER} weights={[400, 500, 600, 700]} source="components/ui/fonts/PaperMono-Variable.woff2 · OFL · the section labels; also the app's optional transcript face" />, { surfaces: ["ground"] }),
    row("Inconsolata Variable", "@fontsource-variable/inconsolata", () => <Face family={INCONSOLATA} weights={[400, 500, 600, 700]} source="@fontsource-variable/inconsolata · OFL · drawn after Consolas" />, { surfaces: ["ground"] }),
    row("Meslo LG S Nerd Font Mono", "components/ui/fonts/MesloLGSNerdFontMono-Regular.ttf", () => <Face family={MESLO} sample="~/Conduit $ ls  │ ├─ └─ ✓ ✗" source="components/ui/fonts/MesloLGSNerdFontMono-Regular.ttf · the terminal's default, for its Nerd Font glyphs" />, { surfaces: ["ground"] }),
    row("Druk Wide Super", "client/assets/fonts/druk-wide-web-super.woff2", () => <Face family={WORDMARK} sample="Conduit" source="client/assets/fonts/druk-wide-web-super.woff2 · as Conduit Wordmark" />, { surfaces: ["ground"] }),
    row("KaTeX", "katex/dist/katex.min.css", () => <Face family="KaTeX_Main, serif" sample="∑ x² + ∫ f(t) dt = π" source="katex · math in messages, in its own serif faces" />, { surfaces: ["ground"] }),
    row("System sans", "system-ui, sans-serif", () => <Face family="system-ui, sans-serif" source="Segoe UI on Windows, SF Pro on Apple, Roboto on Android" />, { surfaces: ["ground"] }),
    row("System mono", MONO, () => <Face family={MONO} sample="claude-opus-5-5  ~/src  12:04" source="SF Mono on Apple, Consolas on Windows, Droid Sans Mono on Android · meta, keycaps and times" />, { surfaces: ["ground"] }),
    row("Consolas", "local only", () => <Face family="Consolas, monospace" sample="claude-opus-5-5  ~/src  12:04" source="Microsoft's, with Windows and Office: not ours to ship · shown from this machine's copy" />, { surfaces: ["ground"] })
  ],
  tokens: [...SIZES.map((group) => ({ title: group.title, tokens: group.rows, density: true })), ...WEIGHTS.map((group) => ({ title: group.title, tokens: group.rows })), ...LEADING.map((group) => ({ title: group.title, tokens: group.rows }))],
};

export const colourPage: Page = {
  title: "Colour", rail: "Foundations",
  summary: "Conduit's colours cover grounds, text, each surface's lines and washes, frost, filled controls, focus and state. Named palettes are in Palettes; text tones by role are in Type.",
  preview: colourScene,
  anatomy: { scene: colourScene, parts: COLOUR_MARKS },
  tokens: [...COLOURS.map((group) => ({ title: group.title, tokens: group.rows })), ...OPACITY.map((group) => ({ title: group.title, tokens: group.rows }))],
};

export const iconsPage: Page = {
  title: "Icons", rail: "Foundations",
  summary: "One glyph per concept (components/ui/icons.tsx, imported as Icons), at the type unit so an icon sits with the text beside it; and the library's own marks: harnesses, file types, a workspace's or place's glyph.",
  api: ["HarnessMark", "ThreadHarnessMark", "Glyph", "FileTypeIcon", "FolderTypeIcon"],
  preview: iconScene,
  anatomy: { scene: iconScene, parts: ICON_MARKS },
  examples: [
    row("vocabulary", "one glyph per concept: its name in Icons, what it means, how many files use it", () => <div class="g-icon-grid">
      <For each={vocabulary}>{([key, meaning, files]) => { const Icon = Icons[key]; return <figure><Icon /><figcaption><code>{key}</code><small>{meaning} · {files}</small></figcaption></figure>; }}</For>
    </div>, { code: "<Icons.Name />" }),
    row("harness marks", "each harness: its tinted mark, its artwork where it has one, and the lively form that lights with its row", () => <div class="g-icon-grid">
      <For each={Object.entries(MARKS)}>{([id, mark]) => <figure><span class="g-row"><HarnessMark id={id} />{mark.artwork && <HarnessMark id={id} artwork />}<ThreadHarnessMark id={id} lively /></span><figcaption><code>{id}</code></figcaption></figure>}</For>
    </div>, { code: "<HarnessMark id />", surfaces: ["ground"] }),
    row("glyphs", "a workspace's or place's own mark: an icon or a monogram in its identity colour, at --icon and --icon-lg", () => <div class="g-row">
      <For each={IDENTITY_COLOURS.slice(3, 6)}>{({ colour }) => <For each={["var(--icon)", "var(--icon-lg)"]}>{(size) => <>
        <span style={{ display: "grid", width: size, height: size }}><Glyph icon={Icons.Boxes} colour={colour} /></span>
        <span style={{ display: "grid", width: size, height: size, "--glyph-text": `calc(.55 * ${size})` }}><Glyph monogram="AB" colour={colour} /></span>
      </>}</For>}</For>
    </div>, { code: "<Glyph icon | monogram colour />", surfaces: ["ground"] }),
    row("file types", "a file's name picks its icon", () => <div class="g-icon-grid">
      <For each={["index.ts", "App.vue", "Page.svelte", "README.md", "package.json", "photo.png", "notes.xyz"]}>{(name) => <figure><FileTypeIcon name={name} /><figcaption><code>{name}</code></figcaption></figure>}</For>
    </div>, { code: "<FileTypeIcon name />" }),
    row("folders", "closed and open", () => <div class="g-icon-grid">
      <For each={["src", "node_modules", "docs"]}>{(name) => <figure><span class="g-row"><FolderTypeIcon name={name} expanded={false} /><FolderTypeIcon name={name} expanded /></span><figcaption><code>{name}</code></figcaption></figure>}</For>
    </div>, { code: "<FolderTypeIcon name expanded />" }),
  ],
  tokens: [{ title: "Marks", tokens: [token("--icon", "harness and thread marks"), token("--icon-sm", "file icons"), token("--muted-foreground", "thread and generic file marks"), token("--opacity-rest", "a thread mark at rest")] }],
};

export const spacePage: Page = {
  title: "Space", rail: "Foundations",
  summary: "Everything from a few numbers: the density's unit (16px on desktop and phone) times the user's Interface size times the region's own size (chrome, sidebar, frost, composer, transcript), per density. Every gap, padding and margin is one of nine steps; every control one of four heights; rows keep their measured height and text, in the unit (a phone's never below 40px). Move the scales and every page follows.",
  preview: spaceScene,
  anatomy: { scene: spaceScene, parts: SPACE_MARKS },
  examples: [row("Scale", "foundations.css :root --ui-scale · --scale-<region>-<density>", () => <ScaleControl />, { surfaces: ["ground"] })],
  tokens: [...SPACE.map((group) => ({ title: group.title, tokens: group.rows, density: true }))],
};

export const radiusPage: Page = {
  title: "Radius", rail: "Foundations",
  summary: "Four radii: control, surface (a control's plus the inset, so rows nest), message (the composer and the user's message, one value everywhere), round (pills, at any size).",
  preview: radiusScene,
  anatomy: { scene: radiusScene, parts: RADIUS_MARKS },
  tokens: [...RADII.map((group) => ({ title: group.title, tokens: group.rows, density: true }))],
};

export const depthPage: Page = {
  title: "Depth", rail: "Foundations",
  summary: "What stands over what: the page's layers, how far a surface stands off it, and the dims that hold back what is behind.",
  preview: () => <div class="g-row" style={{ gap: "var(--space-3xl)" }}>
    <Frost class="g-depth-chip">rest</Frost><Frost lift="raised" class="g-depth-chip">raised</Frost>
  </div>,
  tokens: [...DEPTH.map((group) => ({ title: group.title, tokens: group.rows }))],
};

export const motionPage: Page = {
  title: "Motion", rail: "Foundations",
  summary: "Motion explains a change of place: quick out, gentle in; a change in place is quick and plain. It uses transform and opacity, except for folds the reader opens, with tokens and four shapes: fade in, fade out, rise and drop back. Each piece owns its moves, and reduced motion keeps the end state.",
  preview: () => <PageMoves />,
  motion: [row("The page", "First open fades everything but the composer; a route change fades the reading out quick and the new one in gentle. motion-rules.ts applies these at the port.", () => <PageMoves />, { surfaces: ["ground"] })],
  tokens: [...MOTION.map((group) => ({ title: group.title, tokens: group.rows }))],
};

export const hapticsPage: Page = {
  title: "Haptics", rail: "Foundations",
  preview: () => <div class="g-row"><For each={KINDS}>{(k) => <Button variant="secondary" size="sm" onClick={() => haptic(k.kind)}>{k.kind}</Button>}</For></div>,
  summary: "What a touch that changes something feels like on a phone: five kinds, each a piece's own, so callers never fire them (components/ui/haptics.ts). Only a touch screen with nothing that hovers feels them.",
  examples: KINDS.map((k) => row(k.kind, `${k.what}; fired by ${k.pieces}; impact: ${k.strength}`, () => <Button variant="secondary" size="sm" onClick={() => haptic(k.kind)}>Feel it</Button>, { code: `haptic("${k.kind}")`, phone: "only" })),
};

export const auraPage: Page = {
  title: "Aura", rail: "Foundations",
  summary: "A field of colour behind a surface, made of numbers: each blob comes in from a direction in its hue, circles near that edge on its own period and breathes as it turns, so at rest the colours trade places; a level (0-1, the voice's) brightens them all and grows some while shrinking others. The mic's pill is filled with one while listening.",
  preview: () => <div class="ui-frost ui-pill g-aura-wide"><Aura on level={0.45} /></div>,
  usage: `import { Aura } from "@/components/ui";

<Aura on={listening()} level={level()} strength={0.6} />`,
  api: ["Aura"],
  motion: [row("Aura", "The field on pill-shaped and round surfaces; adjust its level and strength, or press Speak.", () => <AuraDemo />, { surfaces: ["ground"] })],
  tokens: [{ title: "Field", tokens: [token("--duration-gentle", "field fade"), token("--duration-follow", "voice level response"), token("--ease-arrive", "field arrival"), token("--ease-leave", "field departure"), token("--frost-sheen", "glass sheen"), token("--frost-highlight", "lit rim"), token("--frost-glow", "inner glow")] }],
};

export const foundationPages: Page[] = [typePage, colourPage, ...palettePages, iconsPage, spacePage, radiusPage, depthPage, motionPage, hapticsPage, auraPage];
