import { createSignal, For, onMount, type JSX } from "solid-js";
import { Frost } from "@/components/ui";
import { FROST_SIZES } from "../foundations";
import { row, token, type Page } from "../model";

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

const frost = () => <div class="g-material"><Busy><Frost lift="raised" class="g-swatch" /></Busy><FrostTokens names={FROST_CSS} /></div>;
const core = () => <div class="g-material"><Busy><Frost lift="raised" core class="g-swatch" /></Busy><FrostTokens names={["--frost-core-ground", ...FROST_CSS]} /></div>;

export const frostPage: Page = {
  title: "Frost", rail: "Foundations",
  summary: "Two materials: frost, and core, which adds a solid backing for busy content behind a phone's full-screen overlay (currently unused). They look alike over plain ground; text behind them shows the difference. Lift changes only the shadow: rest sits on the page, raised floats above it.",
  preview: frost,
  usage: `import { Frost } from "@/components/ui";

<Frost lift="raised">
  <Menu>…</Menu>
</Frost>

<Frost core>{/* busy content behind: a solid backing */}</Frost>`,
  examples: [
    row("Frost", "Raised frost over text.", frost, { surfaces: ["ground"] }),
    row("Core", "Raised frost with a solid backing; currently unused in overlays.", core, { surfaces: ["ground"] }),
  ],
  tokens: [
    { title: "Material", tokens: [
      token("--frost-fill", "glass fill"),
      token("--frost-stroke", "glass edge"),
      token("--frost-blur", "background blur"),
      token("--frost-highlight", "lit edge"),
      token("--frost-lift-rest", "shadow at rest"),
      token("--frost-lift-raised", "raised shadow"),
      token("--frost-core-ground", "solid core backing"),
    ] },
    ...FROST_SIZES.map((group) => ({ title: group.title, tokens: group.rows })),
  ],
  api: ["Frost"],
};
