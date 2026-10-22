/* Palettes: named sets of colours from outside Conduit's own theme. Their values live once, in styles/palettes.css,
   as --<palette>-<colour>; this file lists the same names and labels for the pickers and the gallery, and holds the
   one use that is chosen in TS: workspace identity, saved per workspace as a hue. */

export type PaletteColour = { id: string; label: string };
export type Palette = { id: string; label: string; source: string; colours: readonly PaletteColour[] };

/** A palette colour as CSS: var(--<palette>-<colour>). */
export const paletteColour = (palette: Palette, colour: string) => `var(--${palette.id}-${colour})`;

const named = (...ids: string[]) => ids.map((id) => ({ id, label: id.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") }));

export const CATPPUCCIN_MOCHA: Palette = { id: "catppuccin-mocha", label: "Catppuccin Mocha", source: "catppuccin.com/palette, its accents",
  colours: named("rosewater", "flamingo", "pink", "mauve", "red", "peach", "yellow", "green", "teal", "sky", "sapphire", "blue", "lavender") };
export const ONE_DARK: Palette = { id: "one-dark", label: "One Dark", source: "Atom's One Dark, with a terminal's brights and Conduit's terminal ground",
  colours: named("foreground", "comment", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "invalid", "invalid-text",
    "black", "white", "bright-black", "bright-red", "bright-green", "bright-yellow", "bright-blue", "bright-purple", "bright-cyan", "bright-white",
    "ground", "text", "cursor", "selection") };
export const CONDUIT_CATEGORIES: Palette = { id: "conduit-categories", label: "Conduit categories", source: "Conduit's own: nine hues at one lightness",
  colours: named("violet", "slate", "azure", "amber", "coral", "rose", "gold", "jade", "clay") };
export const PALETTES = [CATPPUCCIN_MOCHA, ONE_DARK, CONDUIT_CATEGORIES] as const;

/** Each use and the palette it takes now; `attribute` is the root attribute that would pick another (theme.css). */
export const PALETTE_USES = [
  { use: "Workspace identity", palette: CATPPUCCIN_MOCHA, where: "palettes.ts IDENTITY_COLOURS: a workspace's glyph, saved as a hue" },
  { use: "Code", palette: ONE_DARK, where: "theme.css --code-* (data-code-palette): syntax roles, inline code" },
  { use: "Terminal", palette: ONE_DARK, where: "theme.css --ansi-* (data-terminal-palette): the sixteen ANSI colours, ground, cursor, selection" },
  { use: "Categories", palette: CONDUIT_CATEGORIES, where: "theme.css --category-* (data-category-palette): the context gauge's kinds of content" },
] as const;

/** The hues a workspace's identity is saved as, so a different identity palette keeps every workspace's hue. */
export const IDENTITY_HUES = ["rose", "coral", "pink", "violet", "red", "orange", "yellow", "green", "teal", "cyan", "azure", "blue", "indigo"] as const;
export type IdentityHue = typeof IDENTITY_HUES[number];

/** Identity's palette, and the colour of it each hue takes. */
const IDENTITY = { palette: CATPPUCCIN_MOCHA, hues: {
  rose: "rosewater", coral: "flamingo", pink: "pink", violet: "mauve", red: "red", orange: "peach", yellow: "yellow",
  green: "green", teal: "teal", cyan: "sky", azure: "sapphire", blue: "blue", indigo: "lavender",
} satisfies Record<IdentityHue, string> };

/** The colours a workspace or other identity takes: one per hue, labelled with the palette's own name for it. */
export const IDENTITY_COLOURS = IDENTITY_HUES.map((hue) => {
  const source = IDENTITY.hues[hue];
  return { id: hue, label: IDENTITY.palette.colours.find((colour) => colour.id === source)!.label, colour: paletteColour(IDENTITY.palette, source) };
});

/** The hue a saved identity colour means: a hue, or the identity palette's own name for one (saved before hues). */
export function identityHue(value: string): IdentityHue | undefined {
  if ((IDENTITY_HUES as readonly string[]).includes(value)) return value as IdentityHue;
  return IDENTITY_HUES.find((hue) => IDENTITY.hues[hue] === value);
}

/** Any CSS colour (a var() included) as #rrggbb, for a colour input. */
export function colourHex(colour: string): string {
  if (/^#[0-9a-f]{6}$/i.test(colour) || typeof document === "undefined") return colour;
  const probe = document.createElement("i");
  probe.style.color = colour;
  document.body.append(probe);
  const [r, g, b] = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(Number);
  probe.remove();
  return `#${[r, g, b].map((part) => Math.round(part || 0).toString(16).padStart(2, "0")).join("")}`;
}
