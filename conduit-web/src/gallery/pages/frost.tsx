import { createSignal, For, onMount, type JSX } from "solid-js";
import { Frost } from "@/components/ui";
import { FROST_SIZES, TokenTable } from "../foundations";
import { type Family, lib } from "../model";

/** A material's own CSS, read live, so a tuned value shows here too. */
export function FrostTokens(props: { names: string[] }) {
  const [values, setValues] = createSignal<string[]>([]);
  let el!: HTMLDListElement;
  onMount(() => { const style = getComputedStyle(el); setValues(props.names.map((name) => style.getPropertyValue(name).trim())); });
  return <dl ref={el} class="g-tokens"><For each={props.names}>{(name, index) => <><dt>{name}</dt><dd>{values()[index()]}</dd></>}</For></dl>;
}
export const FROST_CSS = ["--frost-fill", "--frost-stroke", "--frost-blur", "--frost-highlight", "--frost-lift-rest", "--frost-lift-raised"];
/** Busy content behind a swatch, as a chat's text is behind an overlay. */
export const Busy = (props: { children: JSX.Element }) => <div class="g-busy"><p>{"Created lorem_ipsum.txt in this folder. The second paragraph is now two sentences: lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(4)}</p>{props.children}</div>;

export const frostFamily: Family = { title: "Frost", rail: "Foundations", usage: `import { Frost } from "@/components/ui";

<Frost lift="raised">
  <Menu>…</Menu>
</Frost>

<Frost core>{/* busy content behind: a solid backing */}</Frost>`, api: ["Frost"], note: "two materials: frost, and core -- frost on a solid backing, kept for the phone's full-screen overlays should what is behind them be too busy (off for now; nothing uses it). Over a plain ground they look alike; over text the difference shows. Lift is not a material, only its shadow: rest sits on the page, raised floats above it", groups: [{ atoms: [
    lib("frost", "Frost", "both", "material", "Frost", () => <div class="g-material"><Busy><Frost lift="raised" class="g-swatch" /></Busy><FrostTokens names={FROST_CSS} /></div>, true),
    lib("frost-core", "Core", "both", "material", "Frost core · Overlay core (off for now)", () => <div class="g-material"><Busy><Frost lift="raised" core class="g-swatch" /></Busy><FrostTokens names={["--frost-core-ground", ...FROST_CSS]} /></div>, true),
  ] }, { title: "Sizes", note: "frost's own, read from the unit (Space)", layout: "desktop", atoms: [
    lib("frost-sizes", "Frost sizes", "both", "material", "foundations.css --frost-inset", () => <TokenTable groups={FROST_SIZES} />, "row"),
  ] }] };
