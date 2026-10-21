import { createSignal, For, onMount } from "solid-js";
import { IDENTITY_COLOURS, PALETTE_USES, PALETTES, paletteColour, type Palette } from "@/components/ui/palettes";
import { row, token, type Page } from "./model";

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

export const palettePages: Page[] = [
  { title: "Palettes", rail: "Foundations",
    summary: "Palettes supply colours outside Conduit's theme, each under its own names. Uses point at palette colours, so a palette changes in one place. The theme's own colours are in Colour.",
    preview: () => <Chips chips={() => PALETTES.slice(0, 1).flatMap((palette) => paletteChips(palette)())} />,
    examples: [
      ...PALETTES.map((palette) => row(palette.label, `--${palette.id}-* in palettes.css · ${palette.source}`,
        () => <Chips chips={paletteChips(palette)} />, { surfaces: ["ground"] })),
      ...PALETTE_USES.map((use) => row(`${use.use} · ${use.palette.label}`, `${use.where}; each token names the palette colour it takes. CSS uses are selected in theme.css; workspace identity is saved as a hue.`,
        () => <Chips chips={use.use === "Workspace identity" ? identityChips : useChips(use.palette, TOKENS[use.use] ?? [])} />, { surfaces: ["ground"] })),
    ],
    tokens: [{ title: "Palette sample", tokens: PALETTES.flatMap((palette) => palette.colours.map((colour) =>
      token(`--${palette.id}-${colour.id}`, `${palette.label} · ${colour.label}`))).slice(0, 8) }],
  },
];
