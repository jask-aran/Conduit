import { createSignal, For, onCleanup, onMount, type JSX } from "solid-js";
import { CopyIcon, FolderIcon, MonitorIcon, PaperclipIcon, SearchIcon, SettingsIcon } from "lucide-solid";
import { Bubble, Frost, HeadingSection, Item, Menu, NavGroup, NavRow, OverlayHints, Section, TextArea } from "@/components/ui";
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
const face = (family: string) => /mono|consolas|menlo/i.test(family) ? "mono" : "sans";
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

/** A typeface: a specimen in it, and where the app uses it. */
function Face(props: { family: string; weights?: number[]; sample?: string; uses: string[] }) {
  return <div class="g-face">
    <div class="g-face-specimen" style={{ "font-family": props.family }}>{props.sample ?? "Aa Bb Gg 0123456789"}</div>
    <div class="g-face-sample" style={{ "font-family": props.family }}>The quick brown fox jumps over the lazy dog</div>
    {props.weights && <div class="g-face-weights"><For each={props.weights}>{(weight) => <span style={{ "font-family": props.family, "font-weight": weight }}>{weight}</span>}</For></div>}
    <ul class="g-face-uses"><For each={props.uses}>{(use) => <li>{use}</li>}</For></ul>
  </div>;
}
/** The terminal's face is loaded by the terminal when it opens; here, when its cell does. */
function TerminalFace() {
  onMount(() => { const font = new FontFace("Conduit Terminal Font", `url(${terminalFontUrl}) format('truetype')`); void font.load().then((loaded) => document.fonts.add(loaded)); });
  return <Face family={'"Conduit Terminal Font", monospace'} sample="~/Conduit $ ls  │ ├─ └─ ✓ ✗  0123" uses={["The terminal pane: Meslo LG S Nerd Font Mono, for its box drawing and icons"]} />;
}

export const foundationFamilies: Family[] = [
  { title: "Fonts", rail: "Foundations", note: "the typefaces, and where each is used. Geist for all UI; the system's mono for what is read as data; the rest each have one job", groups: [{ layout: "desktop", atoms: [
    lib("font-geist", "Geist Variable", "both", "font", "@fontsource-variable/geist · --font-sans", () => <Face family="var(--font-sans)" weights={[400, 450, 500, 550, 560, 600, 650, 660, 700]}
      uses={["All UI: rows, labels, headings, buttons, menus, cards, overlays", "The transcript and the composer's text, by default (Settings → Appearance)", "The weights above are the ones the app uses: rest 400–500, current 660, labels 700"]} />, true),
    lib("font-mono", "ui-monospace", "both", "font", "ui-monospace, SFMono-Regular, Consolas, monospace", () => <Face family="ui-monospace, SFMono-Regular, Consolas, monospace" sample="claude-opus-5-5  ~/src  12:04  Ctrl K"
      uses={["The system's own mono, not a webfont: SF Mono on Apple, Consolas on Windows", "Data: model ids, paths, keycaps, times and counts in meta, status, waveforms (tabular figures)", "Code: inline code, code blocks and artifacts, the file editor", "The crumbs' place caps, the one uppercase label"]} />),
    lib("font-paper", "Paper Mono", "both", "font", "client/fonts/PaperMono-Variable.woff2", () => <Face family={'"Paper Mono", ui-monospace, monospace'} weights={[400, 500, 600, 700]}
      uses={["Optional: the transcript face when chosen in Settings → Appearance", "Then the messages, the composer's text and the voice captions; the rest of the UI stays Geist"]} />),
    lib("font-wordmark", "Conduit Wordmark", "both", "font", "client/assets/fonts/druk-wide-web-super.woff2", () => <Face family={'"Conduit Wordmark", sans-serif'} sample="Conduit"
      uses={["Druk Wide Super, for the brand only: the wordmark at the top of the sidebar"]} />),
    lib("font-terminal", "Conduit Terminal Font", "both", "font", "client/assets/MesloLGSNerdFontMono-Regular.ttf", () => <TerminalFace />),
    lib("font-katex", "KaTeX", "both", "font", "katex/dist/katex.min.css", () => <Face family="KaTeX_Main, serif" sample="∑ x² + ∫ f(t) dt = π"
      uses={["Math in messages, typeset by KaTeX in its own serif faces (KaTeX_Main, _Math, _Size…)"]} />),
  ] }] },
  { title: "Type", rail: "Foundations", note: "the roles, each as the library draws it and as it computes. Rest is grey; current is white at 660, never a fill; over frost a row is a touch heavier and brighter. Labels are sentence case and bold at half the text colour -- the crumbs the one uppercase", groups: [{ atoms: [
    lib("type-frost", "Rows over frost", "both", "type", "Menu > Section > Item", () => <Spec read={roles(["Group label", ".ui-title"], ["Row · rest", ".ui-row:not([data-checked])"], ["Row · current", ".ui-row[data-checked]"], ["Meta", ".ui-row > small"], ["Keycap", ".ui-keycap"])}>
      <Menu><Section title="Group label"><Item icon={<FolderIcon />} meta="2m">Row at rest</Item><Item icon={<MonitorIcon />} checked>Current row</Item><Item icon={<SearchIcon />} keys={["Ctrl", "K"]}>Row with keys</Item></Section></Menu>
    </Spec>),
    lib("type-ground", "Rows on the ground", "both", "type", "Section > Item, outside frost", () => <Spec read={roles(["Group label", ".ui-title"], ["Row · rest", ".ui-row:not([data-checked])"], ["Row · current", ".ui-row[data-checked]"])}>
      <Ground><Section title="Group label"><Item icon={<FolderIcon />}>Row at rest</Item><Item icon={<MonitorIcon />} checked>Current row</Item></Section></Ground>
    </Spec>),
    lib("type-sidebar", "Sidebar", "both", "type", "NavGroup > NavRow", () => <Spec read={roles(["Group label", ".ui-nav-label"], ["Row · rest", ".ui-nav-row:not([aria-current])"], ["Row · current", ".ui-nav-row[aria-current]"])}>
      <Ground><NavGroup label="Group label"><NavRow icon={<MonitorIcon />}>Row at rest</NavRow><NavRow icon={<SettingsIcon />} current>Current row</NavRow></NavGroup></Ground>
    </Spec>),
    lib("type-headings", "Headings", "both", "type", "HeadingSection · Card", () => <Spec read={roles(["Heading", ".ui-heading-title"], ["Detail", ".ui-heading-detail"])}>
      <Menu><HeadingSection title="A heading" detail="Its detail · muted" /></Menu>
    </Spec>),
    lib("type-text", "Text", "both", "type", "Bubble · TextArea · OverlayHints", () => <Spec read={roles(["Message", ".ui-bubble"], ["Entry", ".ui-textarea"], ["Hints", ".ui-overlay-hints"])}>
      <Bubble>A message, at the type unit</Bubble>
      <Frost class="g-entry"><TextArea value="What you type, at the type unit" /></Frost>
      <Frost class="g-entry"><OverlayHints start={[[["↑", "↓"], "Move"], [["Enter"], "Open"]]} /></Frost>
    </Spec>, true),
  ] }] },
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
