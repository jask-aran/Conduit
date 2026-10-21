import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ArrowUpIcon, CameraIcon, FolderIcon, MicIcon, MonitorIcon, PaperclipIcon, PlusIcon, SettingsIcon, Trash2Icon } from "lucide-solid";

import { ServerControl, Reading, ReadingStats, ReadingStat, HeaderPill, Expand, Aura, Slider, Segmented, Preview, Bubble, Button, Frost, HeadingSection, Item, Keycap, Menu, NavRow, Overlay, OverlayBar, PillButton, PillField, PillGroup, Section, Toolbar } from "@/components/ui";
import { px, InUse, style, bg, fg, edge, rounding, tall, icon, form, type Mark } from "./specs";

import { IconsFoundation } from "./icons";
import { HapticsFoundation } from "./haptics";
import { paletteFamilies } from "./palettes";
import { lib, type Family } from "./model";

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
export function TokenTable(props: { groups: TokenGroup[]; density?: boolean }) {
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
      <div class="g-scale-name"><strong>{role.name}</strong><small>{role.rule}</small><small>In the app: {role.where}</small><small class="g-form-tokens">{role.tokens}</small></div>
      <ScaleCell role={role} density="desktop" /><ScaleCell role={role} density="phone" />
    </div>}</For>
  </div>;
}

export const foundationFamilies: Family[] = [
  { title: "Type", rail: "Foundations", note: "the text, top to bottom: the face each role takes, with a switcher; the scale, each role as the library draws it and as it computes; then every face Conduit ships, and the system's own last. Type lens (the bar above) names every text on any page, the phone and desktop previews too, by these roles: hover one for its sizes, pick a role to see only it, and red dashed marks a combination with no role", groups: [
    { title: "Faces", note: "a token per role; the first option is foundations.css's default, a pick applies across the gallery", atoms: ROLES.map((role) => lib(`font-role${role.token}`, role.title, "both", "font", `${role.token} · foundations.css :root`, () => <Role role={role} />)) },
    { title: "Scale", note: "each role once, as DESIGN.md names it: drawn by the library at both densities, and what it computes to. Rest is grey, current white at 660 with no fill; text over frost is a touch heavier and brighter", layout: "desktop", atoms: [
      lib("type-scale", "Roles", "both", "type", "DESIGN.md Typography · foundations.css", () => <Scale />, "row"),
    ] },
    { title: "Sizes, weights and leading", note: "the tokens Scale's roles are made of: every size, weight and line height in the library is one of these", layout: "desktop", atoms: [
      lib("type-sizes", "Sizes", "both", "type", "foundations.css --text-*", () => <TokenTable groups={SIZES} />, true),
      lib("type-weights", "Weights", "both", "type", "foundations.css --weight-*", () => <TokenTable groups={WEIGHTS} density={false} />),
      lib("type-leading", "Leading and tracking", "both", "type", "foundations.css --leading-* · --label-tracking", () => <TokenTable groups={LEADING} density={false} />),
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
  { title: "Colour", rail: "Foundations", note: "Conduit's own colours, each once: grounds, text, one tint per surface for its lines and washes, frost's own, the filled control, focus, state. Colours from named palettes (code, the terminal, categories, identity) are in Palettes; text tones by role are in Type · Scale", groups: [{ title: "In use", note: "every colour in one scene: the frame, a pane, a popover on it", layout: "desktop", atoms: [
    lib("colour-inuse", "Colour in use", "both", "colour", "Menu · Section · Item · Button", () => <InUse scene={colourScene} marks={COLOUR_MARKS} density={false} />, "row"),
  ] }, { title: "Tokens", layout: "desktop", atoms: [
    lib("colour-tokens", "Colours", "both", "colour", "styles.css :root · foundations.css :root", () => <TokenTable groups={COLOURS} density={false} />, "row"),
    lib("colour-opacity", "Emphasis", "both", "colour", "foundations.css --opacity-*", () => <TokenTable groups={OPACITY} density={false} />),
  ] }] },
  ...paletteFamilies,
  { title: "Icons", rail: "Foundations", api: ["HarnessMark", "ThreadHarnessMark", "Glyph", "FileTypeIcon", "FolderTypeIcon"], note: "one glyph per concept (components/ui/icons.tsx, imported as Icons), at the type unit so an icon sits with the text beside it; and the library's own marks: harnesses, file types, a workspace's or place's glyph", groups: [
    { title: "In use", note: "Lucide at the type unit, so an icon is sized with the text beside it; muted at rest, its stroke a tenth of its size, an eighth when current (DESIGN.md Icons)", layout: "desktop", atoms: [
      lib("icon-inuse", "Icons in use", "both", "icon", "svg.lucide · --u-icon · --pill-icon", () => <InUse scene={iconScene} marks={ICON_MARKS} />, "row"),
    ] },
    { title: "Vocabulary and marks", layout: "desktop", atoms: [
      lib("icon-map", "Icons · marks", "both", "icon", "components/ui/icons.tsx · marks.tsx · file-marks.tsx", () => <IconsFoundation />, "row"),
    ] },
  ] },
  { title: "Space", rail: "Foundations", note: "everything from a few numbers: the density's unit (16px on desktop and phone) times the user's Interface size times the region's own size (chrome, sidebar, frost, composer, transcript), per density. Every gap, padding and margin is one of nine steps; every control one of four heights; rows keep their measured height and text, in the unit (a phone's never below 40px). Move the scales and every page follows", groups: [{ title: "Scale", note: "the coefficients, remembered and applied to the whole gallery, its phone frames too: try any page at another setting", layout: "desktop", atoms: [
    lib("space-scale", "Scale", "both", "space", "foundations.css :root --ui-scale · --scale-<region>-<density>", () => <ScaleControl />, "row"),
  ] }, { title: "In use", note: "one popover, measured: what each number shapes. Everything is in the unit, the same 16px on both; the phone's rows take more, for a finger, and its frost a wider inset", layout: "desktop", atoms: [
    lib("space-inuse", "Space in use", "both", "space", "Menu · Section · Item", () => <InUse scene={spaceScene} marks={SPACE_MARKS} />, "row"),
  ] }, { title: "Tokens", note: "for reference", layout: "desktop", atoms: [
    lib("space-tokens", "Space", "both", "space", "foundations.css [data-density]", () => <TokenTable groups={SPACE} />, "row"),
  ] }] },
  { title: "Radius", rail: "Foundations", note: "four radii: control, surface (a control's plus the inset, so rows nest), message (the composer and the user's message, one value everywhere), round (pills, at any size)", groups: [{ title: "In use", note: "each shape the library draws, and its corner", layout: "desktop", atoms: [
    lib("radius-inuse", "Radius in use", "both", "radius", "Menu · Overlay · Bubble · PillField · PillButton", () => <InUse scene={radiusScene} marks={RADIUS_MARKS} />, "row"),
  ] }, { title: "Tokens", layout: "desktop", atoms: [
    lib("radius-tokens", "Radii", "both", "radius", "foundations.css --radius-*", () => <TokenTable groups={RADII} />, "row"),
  ] }] },
  { title: "Depth", rail: "Foundations", note: "what stands over what: the page's layers, how far a surface stands off it, and the dims that hold back what is behind", groups: [{ title: "Tokens", layout: "desktop", atoms: [
    lib("depth-tokens", "Layers · elevation · dims", "both", "depth", "foundations.css --layer-* · --lift-* · --dim*", () => <TokenTable groups={DEPTH} density={false} />, "row"),
  ] }] },
  { title: "Motion", rail: "Foundations", note: "motion explains a change of place (DESIGN Motion): quick out, gentle in; a change in place is quick and plain. Only transform and opacity, but for a fold the reader opens. The foundation is these tokens and four shapes (a fade in or out, a rise, a drop back the way it came); each piece owns its moves, shown on its own page under Motion. Reduced motion keeps the end state", groups: [{ title: "Tokens", note: "a dot runs each curve, and each duration at its curve", layout: "desktop", atoms: [
    lib("motion-tokens", "Motion", "both", "motion", "foundations.css :root --ease-* · --duration-*", () => <TokenTable groups={MOTION} density={false} />, "row"),
  ] }, { title: "The page", note: "no piece's own: the page's regions fade on the tokens, and the composer never moves. The first open fades in everything but the composer; a route (a dashboard's send opening its chat) fades the reading out quick, then the new one in gentle. The app's motion-rules.ts takes these at the port", layout: "desktop", atoms: [
    lib("motion-page", "The page", "desktop", "motion", "ui-fade-in · ui-fade-out on the page's regions", () => <PageMoves />, "row"),
  ] }] },
  { title: "Haptics", rail: "Foundations", note: "what a touch that changes something feels like on a phone: five kinds, each a piece's own, so callers never fire them (components/ui/haptics.ts). Only a touch screen with nothing that hovers feels them", groups: [{ title: "Kinds", layout: "desktop", atoms: [
    lib("haptics", "Haptics", "phone", "haptics", "components/ui/haptics.ts · haptic(kind)", () => <HapticsFoundation />, "row"),
  ] }] },
  { title: "Aura", rail: "Foundations", usage: `import { Aura } from "@/components/ui";

<Aura on={listening()} level={level()} strength={0.6} />`, api: ["Aura"], note: "a field of colour behind a surface, made of numbers: each blob comes in from a direction in its hue, circles near that edge on its own period and breathes as it turns, so at rest the colours trade places; a level (0-1, the voice's) brightens them all and grows some while shrinking others. The mic's pill is filled with one while listening", groups: [{ title: "The field", layout: "desktop", atoms: [
    lib("motion-aura", "Aura", "both", "motion", "Aura · --aura-level · styles/pill.css .ui-aura", () => <AuraDemo />, "row"),
  ] }] },

];
