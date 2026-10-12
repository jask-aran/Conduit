import { createSignal, For, onCleanup, onMount, type JSX } from "solid-js";
import { ArrowUpIcon, CameraIcon, CopyIcon, FolderIcon, MicIcon, MonitorIcon, PaperclipIcon, PlusIcon, SettingsIcon, Trash2Icon } from "lucide-solid";
import { Segmented, Bubble, Button, Frost, HeadingSection, Item, Menu, NavRow, Overlay, OverlayBar, PillButton, PillField, PillGroup, Section, Toolbar } from "@/components/ui";
import { lib, type Family } from "./library";
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

const px = (value: string) => value.replace(/(\d+\.\d+)px/g, (_, n: string) => `${Number(Number(n).toFixed(2))}px`);
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
/*
 * In use: a small scene drawn by the library, each place a foundation shows numbered
 * on it, and what it computes to beside the number -- at desktop and phone.
 */
interface Mark { selector: string; label: string; read: (el: HTMLElement) => string }
function InUse(props: { scene: () => JSX.Element; marks: Mark[]; density?: boolean }) {
  const columns = props.density === false ? [undefined] : (["desktop", "phone"] as const);
  const [values, setValues] = createSignal<string[][]>(columns.map(() => []));
  const Scene = (scene: { column: number; density?: "desktop" | "phone" }) => {
    const [spots, setSpots] = createSignal<({ x: number; y: number; to: number } | null)[]>([]);
    let el!: HTMLDivElement;
    const measure = () => requestAnimationFrame(() => {
      const box = el.getBoundingClientRect();
      const found = props.marks.map((mark) => el.querySelector<HTMLElement>(mark.selector));
      // Each number in the gutter left of the scene, level with what it marks, a line out to it; marks on one line queue leftward.
      const placed: { x: number; y: number; to: number }[] = [];
      setSpots(found.map((node) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const y = rect.top - box.top + Math.min(rect.height / 2, 12);
        const x = -26 - 20 * placed.filter((spot) => Math.abs(spot.y - y) < 16).length;
        const spot = { x, y, to: rect.left - box.left };
        placed.push(spot);
        return spot;
      }));
      setValues((all) => all.map((row, index) => index === scene.column ? found.map((node, at) => node ? props.marks[at]!.read(node) : "—") : row));
    });
    onMount(() => {
      const observer = new ResizeObserver(measure); observer.observe(el);
      addEventListener("gallery:tune", measure);
      onCleanup(() => { observer.disconnect(); removeEventListener("gallery:tune", measure); });
    });
    return <div class="g-inuse-col" data-density={scene.density}>
      {scene.density && <small class="g-inuse-head">{scene.density === "desktop" ? "Desktop" : "Phone"}</small>}
      <div ref={el} class="g-inuse-scene">{props.scene()}
        <For each={spots()}>{(spot, index) => spot && <>
          <i class="g-lead" style={{ left: `${spot.x + 8}px`, top: `${spot.y}px`, width: `${Math.max(0, spot.to - spot.x - 8)}px` }} />
          <span class="g-badge" style={{ left: `${spot.x}px`, top: `${spot.y}px` }}>{index() + 1}</span>
        </>}</For>
      </div>
    </div>;
  };
  return <div class="g-inuse">
    <div class="g-inuse-scenes"><For each={[...columns]}>{(density, index) => <Scene column={index()} density={density} />}</For></div>
    <div class="g-inuse-legend" data-columns={columns.length}>
      <For each={props.marks}>{(mark, index) => <div class="g-inuse-row">
        <span class="g-badge" data-static="">{index() + 1}</span><span>{mark.label}</span>
        <For each={values()}>{(column) => <code>{column[index()] ?? ""}</code>}</For>
      </div>}</For>
    </div>
  </div>;
}
const style = (el: HTMLElement) => getComputedStyle(el);
const bg = (el: HTMLElement) => style(el).backgroundColor;
const fg = (el: HTMLElement) => style(el).color;
const edge = (el: HTMLElement) => style(el).borderTopColor;
const rounding = (el: HTMLElement) => px(style(el).borderTopLeftRadius);
const tall = (el: HTMLElement) => px(`${el.getBoundingClientRect().height}px`);
const icon = (el: HTMLElement) => `${px(`${el.getBoundingClientRect().width}px`)} · stroke ${style(el).strokeWidth.replace("px", "")}`;

const COLOUR_MARKS: Mark[] = [
  { selector: ".g-scene-frame", label: "--frame: the frame, behind the panes", read: bg },
  { selector: ".g-scene-pane", label: "--background: a pane", read: bg },
  { selector: ".ui-menu", label: "--frost-fill: frost", read: bg },
  { selector: ".ui-menu", label: "--frost-stroke: frost's edge", read: edge },
  { selector: ".ui-title", label: "--muted-foreground: a section label (and meta, icons at rest)", read: fg },
  { selector: ".ui-row[data-checked]", label: "--foreground: the current row", read: fg },
  { selector: ".ui-row[data-highlighted]", label: "--frost-tint: the cursor's wash", read: bg },
  { selector: ".ui-section + .ui-section", label: "--frost-tint: a rule between sections", read: edge },
  { selector: ".ui-row[data-destructive]", label: "--destructive: a destructive row", read: fg },
  { selector: ".ui-button[data-variant='outline']", label: "--tint: a control's line, on the ground", read: edge },
];
const colourScene = () => <div class="g-scene-frame"><div class="g-scene-pane">
  <Menu><Section title="Section"><Item icon={<MonitorIcon />} checked>Current</Item><Item icon={<FolderIcon />} active>Cursor</Item><Item meta="2m">At rest</Item></Section><Section><Item icon={<Trash2Icon />} destructive>Delete</Item></Section></Menu>
  <Button variant="outline" size="sm">Control</Button>
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
  { selector: ".ui-pill[data-solo]", label: "message: a pill (a circle at 44px)", read: rounding },
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
  { selector: ".ui-pill:not([data-solo]) svg", label: "a pill group's", read: icon },
  { selector: ".ui-pill[data-solo] svg", label: "a lone pill's: a touch larger", read: icon },
];
const iconScene = () => <div class="g-scene-stack">
  <Menu><Section><Item icon={<PaperclipIcon />}>At rest</Item><Item icon={<MonitorIcon />} checked>Current</Item></Section></Menu>
  <div class="g-ground"><NavRow icon={<SettingsIcon />}>Sidebar</NavRow></div>
  <Frost class="g-entry"><Toolbar start={<Button variant="ghost" size="icon-sm" aria-label="Attach"><PlusIcon /></Button>} end={<><Button variant="ghost" size="icon-sm" aria-label="Voice"><MicIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Send"><ArrowUpIcon /></Button></>} /></Frost>
  <div class="g-scene-row"><PillGroup actions={[{ label: "Attach", icon: <PlusIcon /> }, { label: "Camera", icon: <CameraIcon /> }]} /><PillButton label="Voice" icon={<MicIcon />} /></div>
</div>;

const swatch = (name: string) => () => <i class="g-swatch-chip" style={{ background: `var(${name})` }} />;
const bar = (name: string) => () => <i class="g-bar-chip" style={{ width: `var(${name})` }} />;
const corner = (name: string) => () => <Frost class="g-radius" style={{ "border-radius": `var(${name})` }} />;
const tok = (name: string, use: string, read: TokenRow["read"], sample?: TokenRow["sample"]): TokenRow => ({ name, use, read, sample });

const COLOURS: TokenGroup[] = [
  { title: "Grounds", rows: [tok("--frame", "the frame: the sidebar, behind the panes", colour("--frame"), swatch("--frame")), tok("--background", "a pane", colour("--background"), swatch("--background"))] },
  { title: "Text", rows: [tok("--foreground", "text, and the current item", colour("--foreground"), swatch("--foreground")), tok("--muted-foreground", "muted: labels, meta, captions, icons at rest", colour("--muted-foreground"), swatch("--muted-foreground"))] },
  { title: "Tints", rows: [tok("--tint", "the ground's lines and washes (the app's --border and --accent, the same value)", colour("--tint"), swatch("--tint")), tok("--frost-tint", "frost's lines and washes: rules, the cursor", colour("--frost-tint"), swatch("--frost-tint")), tok("--frost-stroke", "frost's edge", colour("--frost-stroke"), swatch("--frost-stroke"))] },
  { title: "Frost", rows: [tok("--frost-fill", "the material's fill (Frost has its blur, highlight and lifts)", colour("--frost-fill"), swatch("--frost-fill")), tok("--frost-core-ground", "core: a solid backing for busy content", colour("--frost-core-ground"), swatch("--frost-core-ground"))] },
  { title: "State", rows: [tok("--destructive", "a destructive action", colour("--destructive"), swatch("--destructive")), tok("--live", "a runtime dot: live", colour("--live"), swatch("--live")), tok("--warn", "a runtime dot: warning", colour("--warn"), swatch("--warn"))] },
];
const SPACE: TokenGroup[] = [
  { title: "The unit", rows: [tok("--u-type", "type: every size is a multiple", length("--u-type"), bar("--u-type")), tok("--u-space", "space: paddings, gaps, heights", length("--u-space"), bar("--u-space")), tok("--u-icon", "icons", length("--u-icon"), bar("--u-icon"))] },
  { title: "Rows: every list, menu, palette and settings row, and the sidebar's", rows: [tok("--row-min", "a row's height", length("--row-min"), bar("--row-min")), tok("--row-pad", "its padding", length("--row-pad")), tok("--row-gap", "between icon, label and meta", length("--row-gap"), bar("--row-gap")), tok("--nav-indent", "a sidebar row under another", length("--nav-indent"), bar("--nav-indent")), tok("--nav-label-pad", "a sidebar group's label", length("--nav-label-pad"))] },
  { title: "Frost", rows: [tok("--frost-inset", "a popover's padding round its rows", length("--frost-inset"), bar("--frost-inset"))] },
  { title: "Composer", rows: [tok("--composer-width", "declared by the pane, not the composer", (cell) => { const el = document.createElement("div"); el.style.position = "absolute"; el.style.width = "var(--composer-width, 47.5rem)"; cell.append(el); const value = getComputedStyle(el).width; el.remove(); return `${px(value)} (47.5rem unless the pane says)`; }), tok("--cmp-field-min", "the field's least height", classLength("ui-composer-field", "--cmp-field-min")), tok("--cmp-bar-min", "the toolbar's height", classLength("ui-toolbar", "--cmp-bar-min")), tok("--cmp-slot", "a toolbar button", classLength("ui-toolbar", "--cmp-slot"))] },
];
const RADII: TokenGroup[] = [
  { title: "Four radii (DESIGN.md rounded)", rows: [
    tok("--radius-control", "rows, buttons, inputs, keycaps, chips: in the density unit", length("--radius-control"), corner("--radius-control")),
    tok("--radius-surface", "popovers, cards, overlays: a control's plus the inset, so rows nest", length("--radius-surface"), corner("--radius-surface")),
    tok("--radius-message", "the composer, the user's message, the phone's pills: one value on both; a capsule at one line (a 44px pill, a circle), held as it grows", length("--radius-message"), corner("--radius-message")),
    tok("--radius-round", "small fully round bits inside controls: the slider, a pill's buttons, a chip's remove", length("--radius-round"), corner("--radius-round")),
  ] },
];

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
interface TypeRole { name: string; rule: string; selector: string; sample: () => JSX.Element }
const onFrost = (children: JSX.Element) => <Menu>{children}</Menu>;
const onGround = (children: JSX.Element) => <div class="g-ground">{children}</div>;
const TYPE_ROLES: TypeRole[] = [
  { name: "Section label", rule: "every section heading", selector: ".ui-title", sample: () => onFrost(<Section title="Section label"><Item>Row</Item></Section>) },
  { name: "Row", rule: "every list, menu, palette and settings row; over frost", selector: ".ui-row:not([data-checked])", sample: () => onFrost(<Section><Item icon={<FolderIcon />}>Row at rest</Item></Section>) },
  { name: "Row · current", rule: "where you are: white at the current weight", selector: ".ui-row[data-checked]", sample: () => onFrost(<Section><Item icon={<MonitorIcon />} checked>Current row</Item></Section>) },
  { name: "Row · off frost", rule: "the same row on the ground, the sidebar's included: a touch lighter and dimmer", selector: ".ui-nav-row", sample: () => onGround(<NavRow icon={<MonitorIcon />}>Row at rest</NavRow>) },
  { name: "Meta", rule: "beside a row's title, right-aligned", selector: ".ui-row > small", sample: () => onFrost(<Section><Item meta="2m ago">Row</Item></Section>) },
  { name: "Keycap", rule: "a key, in a hairline square", selector: ".ui-keycap", sample: () => onFrost(<Section><Item keys={["Ctrl", "K"]}>Row</Item></Section>) },
  { name: "Heading", rule: "a popover's or card's title", selector: ".ui-heading-title", sample: () => onFrost(<HeadingSection title="A heading" />) },
  { name: "Caption", rule: "a heading's detail, hints, empty copy", selector: ".ui-heading-detail", sample: () => onFrost(<HeadingSection title="A heading" detail="Its detail, muted" />) },
  { name: "Body", rule: "messages and what you type: the type unit", selector: ".ui-bubble", sample: () => <Bubble>A message</Bubble> },
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
      <div class="g-scale-name"><strong>{role.name}</strong><small>{role.rule}</small></div>
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
    { title: "Icons", note: "Lucide at the type unit, so an icon is sized with the text beside it; muted at rest, its stroke a tenth of its size, an eighth when current (DESIGN.md Icons)", layout: "desktop", atoms: [
      lib("icon-inuse", "Icons in use", "both", "icon", "svg.lucide · --u-icon · --pill-solo-icon", () => <InUse scene={iconScene} marks={ICON_MARKS} />, "row"),
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
  { title: "Space", rail: "Foundations", note: "the density: every size a multiple of the unit, 12.8px on desktop and 16px on a phone; rows take their own measured sizes, for a finger on a phone", groups: [{ title: "In use", note: "one popover, measured: what each number shapes. Everything is in the unit, so the phone's is the desktop's at 1.25x; rows take more, for a finger", layout: "desktop", atoms: [
    lib("space-inuse", "Space in use", "both", "space", "Menu · Section · Item", () => <InUse scene={spaceScene} marks={SPACE_MARKS} />, "row"),
  ] }, { title: "Tokens", note: "for reference", layout: "desktop", atoms: [
    lib("space-tokens", "Space", "both", "space", "library.css [data-density]", () => <TokenTable groups={SPACE} />, "row"),
  ] }] },
  { title: "Radius", rail: "Foundations", note: "four radii: control, surface (a control's plus the inset, so rows nest), message (the composer, the user's message and the phone's pills, one value everywhere), round", groups: [{ title: "In use", note: "each shape the library draws, and its corner", layout: "desktop", atoms: [
    lib("radius-inuse", "Radius in use", "both", "radius", "Menu · Overlay · Bubble · PillField · PillButton", () => <InUse scene={radiusScene} marks={RADIUS_MARKS} />, "row"),
  ] }, { title: "Tokens", layout: "desktop", atoms: [
    lib("radius-tokens", "Radii", "both", "radius", "library.css --radius-*", () => <TokenTable groups={RADII} />, "row"),
  ] }] },
];
