import { INKS } from "./formula";
import type { SheetLook } from "./host";

// A colour as the canvas draws it: the grid mixes its colours itself and reads only rgb, where the tokens are oklch and color-mix.
const paint = (() => {
  let context: CanvasRenderingContext2D | null = null;
  return (colour: string) => {
    context ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
    if (!context) return colour;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = colour;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${Math.round((a! / 255) * 1000) / 1000})`;
  };
})();

const wash = (tone: string) => `color-mix(in oklch, var(--foreground), transparent var(${tone}))`;
const COLOURS = {
  accentColor: "var(--foreground)", accentFg: "var(--background)", accentLight: wash("--tone-wash"),
  textDark: "var(--foreground)", textMedium: "var(--muted-foreground)", textLight: "var(--muted-foreground)", textBubble: "var(--foreground)",
  bgIconHeader: "var(--muted-foreground)", fgIconHeader: "var(--background)", textHeader: "var(--muted-foreground)", textHeaderSelected: "var(--foreground)",
  bgCell: "var(--background)", bgCellMedium: "var(--well)", bgHeader: "var(--background)", bgHeaderHasFocus: wash("--tone-wash"), bgHeaderHovered: wash("--tone-wash"),
  bgBubble: "var(--card)", bgBubbleSelected: "var(--popover)", bgSearchResult: wash("--tone-line"),
  borderColor: "var(--border)", horizontalBorderColor: "var(--border)", headerBottomBorderColor: "var(--border)", drilldownBorder: "var(--border)",
  linkColor: "var(--foreground)", resizeIndicatorColor: "var(--foreground)",
} as const;

/** The grid's look from the app's tokens as they stand where it is drawn (its surface, the Interface size); read again when either changes. */
export function readLook(where: HTMLElement): SheetLook {
  const probe = document.createElement("i");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  where.append(probe);
  const colour = (value: string) => { probe.style.color = value; return paint(getComputedStyle(probe).color); };
  const length = (value: string) => { probe.style.width = value; return Math.round(probe.getBoundingClientRect().width); };
  const token = (name: string) => getComputedStyle(probe).getPropertyValue(name).trim();
  const text = length("var(--text-row)"), weight = token("--weight-rest") || "400";
  const grid: Record<string, string | number> = Object.fromEntries(Object.entries(COLOURS).map(([name, value]) => [name, colour(value)]));
  Object.assign(grid, {
    fontFamily: token("--font-sans"), baseFontStyle: `${weight} ${text}px`, headerFontStyle: `${weight} ${text}px`, markerFontStyle: `${weight} ${text}px`, editorFontSize: `${text}px`,
    cellHorizontalPadding: length("var(--space-md)"), cellVerticalPadding: length("var(--space-xs)"), headerIconSize: length("var(--icon-sm)"), lineHeight: 1.4,
  });
  const look: SheetLook = {
    grid, row: length("var(--control-sm)"), header: length("var(--control-sm)"), width: length("var(--measure-2xs)"),
    error: colour("var(--destructive)"), mark: colour(wash("--tone-wash")), markCurrent: colour(wash("--tone-line")),
    // A wash of each ink: the grid fills a reference with it and outlines it in the ink itself.
    inks: INKS.map((ink) => colour(`color-mix(in oklch, var(${ink}), transparent var(--tone-wash))`)),
  };
  probe.remove();
  return look;
}
