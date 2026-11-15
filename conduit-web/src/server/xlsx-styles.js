import { colIndex, colName } from "../sheet-format.js";
import { decodeStyle, encodeStyle } from "../sheet-styles.js";

/*
 * Cell styles between an .xlsx's own parts and a sheet's look (sheet-styles.js), which SheetJS Community Edition neither reads nor writes: `xl/styles.xml`
 * (fonts, fills, borders and alignment, by each cell format), each cell's `s`, and each row's and column's own. Colours come as the workbook means them,
 * theme and tint resolved, as `#rrggbb`; a workbook's default text colour, black text and black edges are the sheet's own. Sizes are points of an
 * 11-point sheet. Not read: font faces, fill patterns but solid, diagonal and dashed edges (drawn solid), indent, rotation, conditional formats.
 */
const unescaped = (text) => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (tag, name) => { const found = new RegExp(`\\s${name}="([^"]*)"`).exec(tag ?? ""); return found ? unescaped(found[1]) : undefined; };
const all = (xml, name) => xml.match(new RegExp(`<${name}\\b(?:[^>]*/>|[^>]*>[\\s\\S]*?</${name}>)`, "g")) ?? [];
const within = (xml, name) => new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)?.[1] ?? "";
const first = (xml, name) => new RegExp(`<${name}\\b[^>]*?(?:/>|>[\\s\\S]*?</${name}>)`).exec(xml)?.[0];
const on = (xml, name) => { const tag = new RegExp(`<${name}\\b[^>]*>`).exec(xml)?.[0]; return Boolean(tag) && !/^(0|false|none)$/.test(attr(tag, "val") ?? ""); };

// The legacy palette `indexed` colours name; 64 and over are the system's (the default text and background).
const INDEXED = "000000ffffffff000000ff000000ffffff00ff00ff00ffff000000ffffffff000000ff000000ffffff00ff00ff00ffff800000008000000080808000800080008080c0c0c08080809999ff993366ffffccccffff660066ff80800066ccccccff000080ff00ffffff0000ffff8000808000000080800000ff00ccffccffffccffccffff9999ccffff99cccc99ffffcc993366ff33cccc99cc00ffcc00ff9900ff6600666699969696003366339966003300333300993300993366333399333333".match(/.{6}/g);
// A theme's colours in the order `theme` counts them: its first two pairs stand the other way round in the theme part.
const SCHEME = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
const themeColours = (xml) => SCHEME.map((name) => { const part = within(xml, `a:${name}`); return (attr(part, "val") && /srgbClr/.test(part) ? attr(part, "val") : attr(part, "lastClr"))?.toLowerCase(); });

/** A colour lightened (tint over 0) or darkened as Excel does, in HLS. */
const tinted = (hex, tint) => {
  if (!tint) return hex;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255), most = Math.max(r, g, b), least = Math.min(r, g, b), d = most - least;
  let l = (most + least) / 2, h = 0;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  if (d) h = most === r ? ((g - b) / d + 6) % 6 : most === g ? (b - r) / d + 2 : (r - g) / d + 4;
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h % 2) - 1)), m = l - c / 2;
  const [R, G, B] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [R, G, B].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
};
/** A `<color>`, `<fgColor>`… as `#rrggbb`, or undefined for the default (auto, the system's, or none). */
const colourOf = (tag, theme) => {
  if (!tag || attr(tag, "auto") === "1") return undefined;
  const rgb = attr(tag, "rgb"), index = attr(tag, "theme"), legacy = attr(tag, "indexed");
  const hex = rgb ? rgb.slice(-6).toLowerCase() : index !== undefined ? theme[Number(index)] : legacy !== undefined ? INDEXED[Number(legacy)] : undefined;
  return hex && /^[0-9a-f]{6}$/.test(hex) ? `#${tinted(hex, Number(attr(tag, "tint") ?? 0))}` : undefined;
};
const HEAVY = { medium: "medium", mediumDashed: "medium", mediumDashDot: "medium", mediumDashDotDot: "medium", slantDashDot: "medium", thick: "thick", double: "thick" };
const SIDES = [["left", "bl"], ["right", "br"], ["top", "bt"], ["bottom", "bb"]];

/** Each cell format of a workbook's `styles.xml` as a packed style (sheet-styles.js), by its index. */
export function readStyles(stylesXml, themeXml) {
  const theme = themeColours(themeXml ?? ""), fonts = all(within(stylesXml, "fonts"), "font"), base = fonts[0] ?? "";
  const baseInk = colourOf(first(base, "color"), theme), baseSize = Number(attr(first(base, "sz"), "val")) || 11;
  const fontOf = fonts.map((font) => {
    const out = {}, size = Number(attr(first(font, "sz"), "val")), ink = colourOf(first(font, "color"), theme);
    for (const [name, code] of [["b", "b"], ["i", "i"], ["u", "u"], ["strike", "s"]]) if (on(font, name)) out[code] = true;
    if (ink && ink !== baseInk && ink !== "#000000") out.c = ink;
    if (size && size !== baseSize) out.z = String(Math.round((size * 11) / baseSize * 10) / 10);
    return out;
  });
  const fillOf = all(within(stylesXml, "fills"), "fill").map((fill) => { const pattern = first(fill, "patternFill"), ink = /patternType="(?!none)/.test(pattern ?? "") ? colourOf(first(pattern, "fgColor"), theme) : undefined; return ink ? { f: ink } : {}; });
  const borderOf = all(within(stylesXml, "borders"), "border").map((border) => {
    const out = {};
    let weight = 0, ink;
    for (const [side, code] of SIDES) {
      const tag = first(border, side), kind = attr(tag, "style");
      if (!kind || kind === "none") continue;
      out[code] = true;
      weight = Math.max(weight, HEAVY[kind] === "thick" ? 2 : HEAVY[kind] ? 1 : 0);
      ink ??= colourOf(first(tag, "color"), theme);
    }
    if (weight) out.bw = weight === 2 ? "thick" : "medium";
    if (ink && ink !== "#000000") out.bc = ink;
    return out;
  });
  return all(within(stylesXml, "cellXfs"), "xf").map((xf) => {
    // A cell format's font, fill and border are its own whatever its apply* flags say: Excel draws them so.
    const align = first(xf, "alignment"), across = attr(align, "horizontal"), down = attr(align, "vertical");
    const attrs = { ...fontOf[Number(attr(xf, "fontId") ?? 0)], ...fillOf[Number(attr(xf, "fillId") ?? 0)], ...borderOf[Number(attr(xf, "borderId") ?? 0)] };
    if (across === "left" || across === "right" || across === "center" || across === "centerContinuous") attrs.h = across === "centerContinuous" ? "center" : across;
    if (down === "top") attrs.v = "top";
    if (attr(align, "wrapText") === "1" || attr(align, "wrapText") === "true") attrs.w = true;
    return encodeStyle(attrs);
  });
}

/**
 * A sheet's styles by where they stand, within its first `size` rows and columns: each column's and row's own (`<col style>`, `<row s customFormat>`), and
 * each cell's `s` that could show (one with none counts only over a row's or column's), as cell format indexes.
 */
export function sheetStyles(sheetXml, size) {
  const cols = new Map(), rows = new Map(), cells = [];
  for (const tag of sheetXml.match(/<col\b[^>]*>/g) ?? []) { const style = attr(tag, "style"); if (style && style !== "0") for (let c = Number(attr(tag, "min")) - 1; c < Math.min(Number(attr(tag, "max")), 16384); c++) cols.set(c, Number(style)); }
  for (const tag of sheetXml.match(/<row\b[^>]*>/g) ?? []) if (attr(tag, "customFormat") === "1" && attr(tag, "s")) rows.set(Number(attr(tag, "r")) - 1, Number(attr(tag, "s")));
  const any = cols.size || rows.size;
  for (const found of sheetXml.matchAll(any ? /<c r="([A-Z]+)(\d+)"([^>]*?)\/?>/g : /<c r="([A-Z]+)(\d+)"([^>]*?\ss="[1-9]\d*"[^>]*?)\/?>/g)) {
    const r = Number(found[2]) - 1, c = colIndex(found[1]);
    if (r < size.rows && c < size.cols) cells.push([r, c, Number(attr(found[3], "s") ?? 0)]);
  }
  return { cols, rows, cells };
}

/** What a cell's own style must say over what it would wear from beneath: what differs, and the defaults of what beneath sets. */
export const ownOver = (under, own) => {
  const out = {};
  for (const code of new Set([...Object.keys(under), ...Object.keys(own)])) if (own[code] !== under[code]) out[code] = own[code] ?? (typeof under[code] === "boolean" ? false : null);
  return out;
};

// The ribbon's inks as a workbook writes them, as text and as a fill (Excel's Bad, Neutral, Good and a light accent).
const INKS = { red: ["c00000", "ffc7ce"], amber: ["9c5700", "ffeb9c"], green: ["006100", "c6efce"], blue: ["0070c0", "ddebf7"] };
const rgbOf = (colour, fill) => (colour.startsWith("#") ? colour.slice(1) : INKS[colour]?.[fill ? 1 : 0] ?? "000000").toUpperCase();
const STROKE = { 1: "thin", medium: "medium", thick: "thick" };
const FACE = '<name val="Calibri"/><family val="2"/><scheme val="minor"/>';

/**
 * A written workbook's `styles.xml` and sheets given the look's styles: `styles` the part SheetJS wrote (its number formats are kept), `sheets` each tab's
 * XML with `styleAt(r, c)`, the packed style a cell wears (empty for none), and `size`, the tab's rows and columns. Each cell's `s` is rewritten, and a
 * cell with a style but nothing in it is added.
 */
export function writeStyles(styles, sheets) {
  const formats = all(within(styles, "cellXfs"), "xf").map((xf) => Number(attr(xf, "numFmtId") ?? 0));
  const lists = { font: [`<font><sz val="11"/><color theme="1"/>${FACE}</font>`], fill: ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'], border: ["<border><left/><right/><top/><bottom/><diagonal/></border>"], xf: ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'] };
  const ids = { font: new Map([[lists.font[0], 0]]), fill: new Map([[lists.fill[0], 0]]), border: new Map([[lists.border[0], 0]]), xf: new Map([[lists.xf[0], 0]]) };
  const idOf = (kind, xml) => { let id = ids[kind].get(xml); if (id === undefined) { id = lists[kind].push(xml) - 1; ids[kind].set(xml, id); } return id; };
  const xfOf = new Map();
  const xfFor = (format, packed) => {
    const name = `${format}|${packed}`;
    if (xfOf.has(name)) return xfOf.get(name);
    const a = decodeStyle(packed), flag = (code, tag) => (a[code] ? `<${tag}/>` : "");
    const font = idOf("font", `<font>${flag("b", "b")}${flag("i", "i")}${flag("u", "u")}${flag("s", "strike")}<sz val="${a.z ?? 11}"/>${a.c ? `<color rgb="FF${rgbOf(a.c)}"/>` : '<color theme="1"/>'}${FACE}</font>`);
    const fill = a.f ? idOf("fill", `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgbOf(a.f, true)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const side = (name, code) => (a[code] ? `<${name} style="${STROKE[a.bw ?? 1]}">${a.bc ? `<color rgb="FF${rgbOf(a.bc)}"/>` : '<color indexed="64"/>'}</${name}>` : `<${name}/>`);
    const border = idOf("border", `<border>${side("left", "bl")}${side("right", "br")}${side("top", "bt")}${side("bottom", "bb")}<diagonal/></border>`);
    const align = [a.h && `horizontal="${a.h}"`, a.v && `vertical="${a.v === "middle" ? "center" : a.v}"`, a.w && 'wrapText="1"'].filter(Boolean).join(" ");
    const id = idOf("xf", `<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${format ? ' applyNumberFormat="1"' : ""}${font ? ' applyFont="1"' : ""}${fill ? ' applyFill="1"' : ""}${border ? ' applyBorder="1"' : ""}${align ? ` applyAlignment="1"><alignment ${align}/></xf>` : "/>"}`);
    xfOf.set(name, id);
    return id;
  };
  const written = sheets.map(({ xml, styleAt, size }) => {
    const rows = new Map(), data = within(xml, "sheetData");
    for (const row of all(data, "row")) {
      const r = Number(attr(row, "r")) - 1, cells = new Map();
      for (const found of within(row, "row").matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(\/>|>[\s\S]*?<\/c>)/g)) cells.set(colIndex(found[1]), found[0]);
      rows.set(r, { open: /<row\b[^>]*?(?=\/?>)/.exec(row)[0], cells });
    }
    for (let r = 0; r < size.rows; r++) for (let c = 0; c < size.cols; c++) {
      const packed = styleAt(r, c), cell = rows.get(r)?.cells.get(c);
      if (!packed && !cell) continue;
      const open = cell && /^<c\b[^>]*?(?=\/?>)/.exec(cell)[0], s = xfFor(open ? formats[Number(attr(open, "s") ?? 0)] ?? 0 : 0, packed), worn = s ? ` s="${s}"` : "";
      const row = rows.get(r) ?? rows.set(r, { open: `<row r="${r + 1}"`, cells: new Map() }).get(r);
      row.cells.set(c, open ? `${open.replace(/\s+s="\d+"/, "")}${worn}${cell.slice(open.length)}` : `<c r="${colName(c)}${r + 1}"${worn}/>`);
    }
    const body = [...rows].sort((a, b) => a[0] - b[0]).map(([, row]) => `${row.open}>${[...row.cells].sort((a, b) => a[0] - b[0]).map(([, cell]) => cell).join("")}</row>`).join("");
    return xml.replace(/<sheetData\/>|<sheetData>[\s\S]*<\/sheetData>/, () => `<sheetData>${body}</sheetData>`);
  });
  const block = (kind, tag) => `<${tag} count="${lists[kind].length}">${lists[kind].join("")}</${tag}>`;
  const out = styles.replace(/<fonts\b[\s\S]*?<\/fonts>/, () => block("font", "fonts")).replace(/<fills\b[\s\S]*?<\/fills>/, () => block("fill", "fills")).replace(/<borders\b[\s\S]*?<\/borders>/, () => block("border", "borders")).replace(/<cellXfs\b[\s\S]*?<\/cellXfs>/, () => block("xf", "cellXfs"));
  return { styles: out, sheets: written };
}
