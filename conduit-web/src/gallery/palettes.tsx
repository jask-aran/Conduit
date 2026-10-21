import { createSignal, For, onMount } from "solid-js";
import { IDENTITY_COLOURS, PALETTE_USES, PALETTES, paletteColour, type Palette } from "@/components/ui/palettes";
import { lib, type Family } from "./library";

/* Palettes (components/ui/palettes.ts, styles/palettes.css): each named palette once, by its own names; then each use
   and the palette colour every one of its tokens takes, found by matching computed values, so the gallery holds no
   copy of the mapping. */

type Chip = { label: string; token: string; colour: string; from?: string };

const computed = (el: Element, colour: string) => {
  const probe = document.createElement("i");
  probe.style.color = colour;
  el.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
};

function Chips(props: { chips: () => Chip[] }) {
  let el!: HTMLDivElement;
  const [values, setValues] = createSignal<string[]>([]);
  onMount(() => setValues(props.chips().map((chip) => getComputedStyle(el).getPropertyValue(chip.token).trim() || chip.colour)));
  return <div ref={el} class="g-palette">
    <For each={props.chips()}>{(chip, index) => <figure class="g-palette-chip">
      <i class="g-swatch-chip" style={{ background: chip.colour }} />
      <figcaption><strong>{chip.label}</strong><small>{chip.token}</small>{chip.from && <small>{chip.from}</small>}<small>{values()[index()]}</small></figcaption>
    </figure>}</For>
  </div>;
}

const paletteChips = (palette: Palette) => () => palette.colours.map((colour) =>
  ({ label: colour.label, token: `--${palette.id}-${colour.id}`, colour: paletteColour(palette, colour.id) }));

/** A use's tokens, each labelled with the palette colour it resolves to. */
const useChips = (palette: Palette, tokens: string[]) => () => {
  const root = document.documentElement;
  const of = (colour: string) => computed(root, colour);
  return tokens.map((token) => {
    const value = of(`var(${token})`);
    const match = palette.colours.find((colour) => of(paletteColour(palette, colour.id)) === value);
    return { label: token.replace(/^--(code|ansi|category|syntax)-/, ""), token, colour: `var(${token})`, from: match ? `${palette.label} · ${match.label}` : "not from the palette" };
  });
};

const CODE = ["foreground", "comment", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "invalid", "invalid-foreground"].map((name) => `--code-${name}`);
const TERMINAL = ["background", "foreground", "cursor", "cursor-accent", "selection", "selection-foreground",
  ...["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"].flatMap((name) => [name, `bright-${name}`])].map((name) => `--ansi-${name}`);
const CATEGORIES = Array.from({ length: 9 }, (_, index) => `--category-${index + 1}`);
const SYNTAX = ["keyword", "string", "number", "title", "variable", "type", "meta", "comment"].map((name) => `--syntax-${name}`);
const TOKENS: Record<string, string[]> = { Code: [...CODE, ...SYNTAX], Terminal: TERMINAL, Categories: CATEGORIES };

const identityChips = () => IDENTITY_COLOURS.map((option) => ({ label: option.id, token: option.colour.slice(4, -1), colour: option.colour, from: `saved as "${option.id}" · ${option.label}` }));

export const paletteFamilies: Family[] = [
  { title: "Palettes", rail: "Foundations", note: "colours from outside Conduit's own theme, each palette once under its own names; a use points at a palette's colours, so a palette swaps in one place. The theme's own colours are in Colour", groups: [
    { title: "Palettes", note: "each one by its own names: --<palette>-<colour> in palettes.css, the same names and labels in palettes.ts", layout: "desktop", atoms: PALETTES.map((palette) =>
      lib(`palette-${palette.id}`, palette.label, "both", "palette", `palettes.css --${palette.id}-* · ${palette.source}`, () => <Chips chips={paletteChips(palette)} />, "row")) },
    { title: "Uses", note: "what each palette colours, and the palette colour each of a use's tokens takes now. CSS uses point at a palette in theme.css, picked by a root attribute; identity is chosen in palettes.ts, since it is saved per workspace as a hue", layout: "desktop", atoms: PALETTE_USES.map((use) =>
      lib(`palette-use-${use.use.toLowerCase().replace(/\s+/g, "-")}`, `${use.use} · ${use.palette.label}`, "both", "palette", use.where,
        () => <Chips chips={use.use === "Workspace identity" ? identityChips : useChips(use.palette, TOKENS[use.use] ?? [])} />, "row")) },
  ] },
];
