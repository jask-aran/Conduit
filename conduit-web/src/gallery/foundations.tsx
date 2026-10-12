import { createSignal, For, onCleanup, onMount, type JSX } from "solid-js";
import { CopyIcon, FolderIcon, MonitorIcon, PaperclipIcon, SettingsIcon } from "lucide-solid";
import { Segmented, Bubble, Frost, HeadingSection, Item, Menu, NavGroup, NavRow, Section } from "@/components/ui";
import { lib, type Family } from "./library";
import "katex/dist/katex.min.css";
import terminalFontUrl from "../client/assets/MesloLGSNerdFontMono-Regular.ttf";

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

const px = (value: string) => value.replace(/(\d+\.\d{2})\d+px/g, "$1px");
/** The face a role resolves to: the first family of its stack (the one drawn once it loads). */
const face = (family: string) => family.split(",")[0]!.trim().replace(/^"|"$/g, "");
/** A role as it computes: size/leading · weight · face, and its colour. */
const role = (label: string, selector: string): Read => (scope) => {
  const el = scope.querySelector(selector);
  if (!el) return [[label, "—"]];
  const style = getComputedStyle(el);
  const tabular = style.fontVariantNumeric.includes("tabular") ? " tabular" : "";
  const caps = style.textTransform === "uppercase" ? " caps" : "";
  return [[label, px(`${style.fontSize}/${style.lineHeight} · ${style.fontWeight} · ${face(style.fontFamily)}${tabular}${caps}`)], ["", style.color]];
};
const roles = (...pairs: [string, string][]): Read => (scope) => pairs.flatMap(([label, selector]) => role(label, selector)(scope));
/** A token's value; a calc() resolved to the length it comes to. */
const tokens = (...names: string[]): Read => (scope) => names.map((name) => {
  const value = getComputedStyle(scope).getPropertyValue(name).trim();
  if (!value.includes("calc(")) return [name, px(value)];
  const el = document.createElement("div");
  el.style.width = `var(${name})`; el.style.position = "absolute";
  scope.append(el);
  const width = getComputedStyle(el).width;
  el.remove();
  return [name, px(width)];
});
/** A piece's own value of a property, read off a bare element with its classes (radii, icon sizes the CSS derives). */
function probe(scope: HTMLElement, classes: string, property: string, surface?: string) {
  const el = document.createElement("div");
  el.className = classes;
  if (surface) el.dataset.surface = surface;
  el.style.position = "absolute"; el.style.visibility = "hidden";
  scope.append(el);
  const value = getComputedStyle(el).getPropertyValue(property);
  el.remove();
  return px(value);
}

const Spec = (props: { read: Read; children: JSX.Element }) => <div class="g-spec">{props.children}<Readout read={props.read} /></div>;
const Ground = (props: { children: JSX.Element }) => <div class="g-surface" data-surface="ground"><small>ground</small>{props.children}</div>;

/** The radii, each read from the piece that draws it. */
const radii: [string, string, string?][] = [
  ["Popover · Card", "ui-frost ui-menu"], ["Overlay", "ui-frost ui-overlay"], ["Row", "ui-row"], ["Sidebar row", "ui-nav-row"],
  ["Composer", "ui-frost ui-desktop-composer"], ["Phone field", "ui-frost ui-pill-field"], ["Pill", "ui-frost ui-pill"], ["Keycap", "ui-keycap"],
];
function Radii() {
  const [values, setValues] = createSignal<string[]>([]);
  return <div class="g-spec">
    <div class="g-radii"><For each={radii}>{([label], index) => <figure><Frost class="g-radius" style={{ "border-radius": values()[index()] }} /><figcaption>{label}</figcaption></figure>}</For></div>
    <Readout read={(scope) => { const read = radii.map(([, classes]) => probe(scope, classes, "border-top-left-radius")); setValues(read); return radii.map(([label], index) => [label, read[index]!]); }} />
  </div>;
}

const lengths = ["--u-type", "--u-space", "--u-icon", "--row-min", "--row-gap", "--nav-min", "--nav-gap", "--nav-indent", "--frost-inset"];
function Space() {
  return <div class="g-spec">
    <div class="g-lengths"><For each={lengths}>{(name) => <div><code>{name}</code><i style={{ width: `var(${name})` }} /></div>}</For></div>
    <Readout read={tokens(...lengths, "--row-pad", "--nav-pad", "--nav-label-pad")} />
  </div>;
}

const sizes: [string, string][] = [["--u-icon", "row, toolbar"], ["--nav-icon", "sidebar"], ["--pill-icon", "pill"], ["--pill-solo-icon", "lone pill"]];

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
const GEIST = '"Geist Variable"', PAPER = '"Paper Mono"', INCONSOLATA = '"Inconsolata Variable"', MESLO = '"Conduit Terminal Font"', WORDMARK = '"Conduit Wordmark"';
interface FontRole { token: string; title: string; fallback: string; options: ReturnType<typeof option>[]; uses: string; preview: () => JSX.Element }
const ROLES: FontRole[] = [
  { token: "--font-sans", title: "Main UI", fallback: SANS, uses: "Rows, headings, buttons, menus, cards, overlays; messages and the composer's text", options: [option("geist", "Geist", GEIST), option("paper", "Paper Mono", PAPER), option("system", "System", "system-ui")],
    preview: () => <><Menu><Section><Item icon={<FolderIcon />}>Add to a project folder</Item><Item icon={<MonitorIcon />} checked>Assistant</Item></Section></Menu><Bubble>A message in the main face</Bubble></> },
  { token: "--font-label", title: "Section labels", fallback: MONO, uses: "Muted caps over every section (popovers, cards, riders, the slider, the sidebar's groups), keycaps and the leader's crumbs", options: [option("paper", "Paper Mono", PAPER), option("inconsolata", "Inconsolata", INCONSOLATA), option("system", "System", "")],
    preview: () => <Menu><Section title="Profile"><Item icon={<FolderIcon />} keys={["Ctrl", "P"]}>Assistant</Item></Section><Section title="Model"><Item>GPT-6 Luna</Item></Section></Menu> },
  { token: "--font-code", title: "Code", fallback: MONO, uses: "Code blocks, previews and artifacts, the file editor; the terminal draws in Meslo today", options: [option("system", "System", ""), option("meslo", "Meslo", MESLO), option("paper", "Paper Mono", PAPER), option("inconsolata", "Inconsolata", INCONSOLATA)],
    preview: () => <Frost class="g-entry"><pre class="ui-preview">{"~/Conduit $ npm run build\n✓ built in 10.4s  │ ├─ └─\nconst x = { a: 1, b: [2, 3] };"}</pre></Frost> },
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
/** Faces loaded by script rather than CSS: the terminal's, which the terminal loads when it opens. */
function loadTerminalFace() { if (![...document.fonts].some((font) => font.family === "Conduit Terminal Font")) void new FontFace("Conduit Terminal Font", `url(${terminalFontUrl}) format('truetype')`).load().then((font) => document.fonts.add(font)); }

function Role(props: { role: FontRole }) {
  const [value, setValue] = createSignal(stored(props.role));
  onMount(loadTerminalFace);
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
    { title: "Shipped", note: "the faces Conduit ships, so it looks the same on every system", layout: "desktop", atoms: [
      lib("font-geist", "Geist Variable", "both", "font", "@fontsource-variable/geist", () => <Face family={GEIST} weights={[400, 450, 500, 560, 600, 660, 700]} source="@fontsource-variable/geist · OFL" />),
      lib("font-paper", "Paper Mono", "both", "font", "components/ui/fonts/PaperMono-Variable.woff2", () => <Face family={PAPER} weights={[400, 500, 600, 700]} source="components/ui/fonts/PaperMono-Variable.woff2 · OFL · the section labels; also the app's optional transcript face" />),
      lib("font-inconsolata", "Inconsolata Variable", "both", "font", "@fontsource-variable/inconsolata", () => <Face family={INCONSOLATA} weights={[400, 500, 600, 700]} source="@fontsource-variable/inconsolata · OFL · drawn after Consolas" />),
      lib("font-meslo", "Meslo LG S Nerd Font Mono", "both", "font", "client/assets/MesloLGSNerdFontMono-Regular.ttf", () => { onMount(loadTerminalFace); return <Face family={MESLO} sample="~/Conduit $ ls  │ ├─ └─ ✓ ✗" source="client/assets/MesloLGSNerdFontMono-Regular.ttf · the terminal's, for box drawing and icons" />; }),
      lib("font-wordmark", "Druk Wide Super", "both", "font", "client/assets/fonts/druk-wide-web-super.woff2", () => <Face family={WORDMARK} sample="Conduit" source="client/assets/fonts/druk-wide-web-super.woff2 · as Conduit Wordmark" />),
      lib("font-katex", "KaTeX", "both", "font", "katex/dist/katex.min.css", () => <Face family="KaTeX_Main, serif" sample="∑ x² + ∫ f(t) dt = π" source="katex · math in messages, in its own serif faces" />),
    ] },
    { title: "Fallbacks", note: "the system's own: not shipped, so they differ by system; each role falls back to one", layout: "desktop", atoms: [
      lib("font-system-sans", "System sans", "both", "font", "system-ui, sans-serif", () => <Face family="system-ui, sans-serif" source="Segoe UI on Windows, SF Pro on Apple, Roboto on Android" />),
      lib("font-system-mono", "System mono", "both", "font", MONO, () => <Face family={MONO} sample="claude-opus-5-5  ~/src  12:04" source="SF Mono on Apple, Consolas on Windows, Droid Sans Mono on Android · meta, keycaps and times" />),
      lib("font-consolas", "Consolas", "both", "font", "local only", () => <Face family="Consolas, monospace" sample="claude-opus-5-5  ~/src  12:04" source="Microsoft's, with Windows and Office: not ours to ship · shown from this machine's copy" />),
    ] },
  ] },
  { title: "Colour", rail: "Foundations", note: "the grounds and frost's tints, read from :root; text tones are mixes of the text colour, read off the pieces that use them", groups: [{ atoms: [
    lib("colour-grounds", "Grounds and lines", "both", "colour", "styles.css :root · library.css :root", () => <Spec read={tokens("--frame", "--background", "--border", "--accent", "--foreground", "--muted-foreground", "--destructive")}>
      <div class="g-chips"><For each={["--frame", "--background", "--border", "--accent", "--foreground", "--muted-foreground", "--destructive"]}>{(name) => <i style={{ background: `var(${name})` }} title={name} />}</For></div>
    </Spec>),
    lib("colour-frost", "Frost's tints", "both", "colour", "library.css :root", () => <Spec read={tokens("--frost-fill", "--frost-stroke", "--frost-wash", "--frost-rule", "--frost-core-ground")}>
      <Ground><div class="g-chips"><For each={["--frost-fill", "--frost-stroke", "--frost-wash", "--frost-rule", "--frost-core-ground"]}>{(name) => <i style={{ background: `var(${name})` }} title={name} />}</For></div></Ground>
    </Spec>),
    lib("colour-text", "Text tones", "both", "colour", "Item · NavGroup", () => <Spec read={(scope) => [".ui-row[data-checked]", "[data-surface='frost'] .ui-row:not([data-checked])", ".g-surface .ui-row:not([data-checked])", ".ui-title", ".ui-row > small"].map((selector, index) =>
      [["Current", "Rest over frost", "Rest on the ground", "Label", "Meta"][index]!, scope.querySelector(selector) ? getComputedStyle(scope.querySelector(selector)!).color : "—"])}>
      <Menu><Section title="Label"><Item checked>Current</Item><Item meta="meta">Rest over frost</Item></Section></Menu>
      <Ground><Item>Rest on the ground</Item></Ground>
    </Spec>),
  ] }] },
  { title: "Space", rail: "Foundations", note: "the density: every size is a multiple of the unit, 12.8px on desktop and 16px on a phone. Rows and the sidebar take their own measured sizes (a phone row is ~1.8x, for a finger). A pane declares the composer's width (--composer-width)", groups: [{ atoms: [
    lib("space-density", "Density", "both", "space", "library.css [data-density]", () => <Space />, "row"),
  ] }] },
  { title: "Radius", rail: "Foundations", note: "rows round at 8px at most; a popover is 8px on desktop; pills are capsules. Each read from the piece that draws it", groups: [{ atoms: [
    lib("radius", "Radii", "both", "radius", "library.css", () => <Radii />, "row"),
  ] }] },
  { title: "Icons", rail: "Foundations", note: "lucide, at the icon unit; a heavier stroke (3) when current", groups: [{ atoms: [
    lib("icon-sizes", "Sizes", "both", "icon", "--u-icon · --nav-icon · --pill-icon", () => <Spec read={tokens(...sizes.map(([name]) => name))}>
      <div class="g-icon-sizes"><For each={sizes}>{([name, use]) => <figure><span style={{ width: `var(${name})`, height: `var(${name})` }}><CopyIcon /></span><figcaption>{use}</figcaption></figure>}</For></div>
    </Spec>),
    lib("icon-stroke", "Stroke", "both", "icon", "Item · NavRow", () => <Spec read={(scope) => [["Rest", ".ui-row:not([data-checked]) svg"], ["Current", ".ui-row[data-checked] svg"], ["Sidebar current", ".ui-nav-row[aria-current] svg"]].map(([label, selector]) =>
      [label!, scope.querySelector(selector!) ? `stroke ${getComputedStyle(scope.querySelector(selector!)!).strokeWidth}` : "—"])}>
      <Menu><Section><Item icon={<PaperclipIcon />}>At rest</Item><Item icon={<MonitorIcon />} checked>Current</Item></Section></Menu>
      <Ground><NavGroup><NavRow icon={<SettingsIcon />} current>Current</NavRow></NavGroup></Ground>
    </Spec>),
  ] }] },
];
