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
  if (!tag || ["1", "true"].includes(attr(tag, "auto"))) return undefined;
  const rgb = attr(tag, "rgb"), index = attr(tag, "theme"), legacy = attr(tag, "indexed");
  const hex = rgb ? rgb.slice(-6).toLowerCase() : index !== undefined ? theme[Number(index)] : legacy !== undefined ? INDEXED[Number(legacy)] : undefined;
  return hex && /^[0-9a-f]{6}$/.test(hex) ? `#${tinted(hex, Number(attr(tag, "tint") ?? 0))}` : undefined;
};
const HEAVY = { thick: 2, double: 2, slantDashDot: 1 };
const SIDES = [["left", "bl"], ["right", "br"], ["top", "bt"], ["bottom", "bb"]], STROKES = ["thin", "medium", "thick"];

// The ribbon's inks as a workbook writes them, as text and as a fill (Excel's Bad, Neutral, Good and a light accent); read back as the inks.
const INKS = { red: ["c00000", "ffc7ce"], amber: ["9c5700", "ffeb9c"], green: ["006100", "c6efce"], blue: ["0070c0", "ddebf7"] };
const inkOf = (hex, fill) => Object.keys(INKS).find((ink) => `#${INKS[ink][fill]}` === hex) ?? hex;

/** Each cell format of a workbook's `styles.xml` as a packed style (sheet-styles.js), by its index. */
export function readStyles(stylesXml, themeXml) {
  const theme = themeColours(themeXml ?? ""), fonts = all(within(stylesXml, "fonts"), "font"), base = fonts[0] ?? "";
  const baseInk = colourOf(first(base, "color"), theme), baseSize = Number(attr(first(base, "sz"), "val")) || 11;
  const fontOf = fonts.map((font) => {
    const out = {}, size = Number(attr(first(font, "sz"), "val")), ink = colourOf(first(font, "color"), theme);
    for (const [name, code] of [["b", "b"], ["i", "i"], ["u", "u"], ["strike", "s"]]) if (on(font, name)) out[code] = true;
    if (ink && ink !== baseInk && ink !== "#000000") out.c = inkOf(ink, 0);
    if (size && size !== baseSize) out.z = String(Math.round((size * 11) / baseSize * 10) / 10);
    const face = attr(first(font, "name"), "val"), baseFace = attr(first(base, "name"), "val");
    if (face && face !== baseFace && /^[^_=]{1,64}$/.test(face)) out.n = face.replace(/ /g, "_");
    if (/^double/.test(attr(first(font, "u"), "val") ?? "")) out.u2 = true;
    return out;
  });
  const fillOf = all(within(stylesXml, "fills"), "fill").map((fill) => {
    const pattern = first(fill, "patternFill"), kind = (attr(pattern, "patternType") ?? "none").toLowerCase(), ink = kind !== "none" ? colourOf(first(pattern, "fgColor"), theme) : undefined;
    if (!ink) return {};
    const under = kind === "solid" ? undefined : colourOf(first(pattern, "bgColor"), theme);
    return { f: kind === "solid" ? inkOf(ink, 1) : ink, ...(kind === "solid" ? {} : { fp: kind }), ...(under ? { fb: under } : {}) };
  });
  const borderOf = all(within(stylesXml, "borders"), "border").map((border) => {
    const out = {};
    let weight = 0, ink;
    for (const [side, code] of SIDES) {
      const tag = first(border, side), kind = attr(tag, "style");
      if (!kind || kind === "none") continue;
      out[code] = true;
      weight = Math.max(weight, HEAVY[kind] ?? (kind.startsWith("medium") ? 1 : 0));
      if (!STROKES.includes(kind)) out.bs ??= kind.toLowerCase();
      ink ??= colourOf(first(tag, "color"), theme);
    }
    const diagonal = attr(first(border, "diagonal"), "style"), up = ["1", "true"].includes(attr(border, "diagonalUp")), down = ["1", "true"].includes(attr(border, "diagonalDown"));
    if (diagonal && diagonal !== "none" && (up || down)) { out.bd = up && down ? "both" : up ? "up" : "down"; ink ??= colourOf(first(first(border, "diagonal"), "color"), theme); }
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
    if (["centerContinuous", "fill", "justify", "distributed"].includes(across)) attrs.hx = across.toLowerCase();
    if (Number(attr(align, "indent")) > 0) attrs.in = String(Number(attr(align, "indent")));
    if (Number(attr(align, "textRotation")) > 0) attrs.r = String(Number(attr(align, "textRotation")));
    if (["1", "true"].includes(attr(align, "shrinkToFit"))) attrs.k = true;
    return encodeStyle(attrs);
  });
}

/**
 * A sheet's styles by where they stand: each column's and row's own (`<col style>`, `<row s customFormat>`), and each cell's `s` (one with none counts
 * only over a row's or column's) within `size` or where `shows` says its format can be seen empty (a fill or an edge), as cell format indexes. `reach`:
 * the rows and columns the tab grows to for the seen cells, rows and columns touching it, stopping at a gap; `heights`: each row's own height in points
 * (one set by hand, or one well over the default, which Excel sized to its text).
 */
const HEIGHTS = 20_000;
export function sheetStyles(sheetXml, size, shows) {
  const cols = new Map(), rows = new Map(), heights = new Map(), cells = [], reach = { rows: 0, cols: 0 };
  for (const tag of sheetXml.match(/<col\b[^>]*>/g) ?? []) { const style = attr(tag, "style"); if (style && style !== "0") for (let c = Number(attr(tag, "min")) - 1; c < Math.min(Number(attr(tag, "max")), 16384); c++) cols.set(c, Number(style)); }
  const usual = Number(attr(/<sheetFormatPr\b[^>]*>/.exec(sheetXml)?.[0], "defaultRowHeight")) || 15;
  for (const tag of sheetXml.match(/<row\b[^>]*>/g) ?? []) {
    const r = Number(attr(tag, "r")) - 1, height = Number(attr(tag, "ht"));
    if (["1", "true"].includes(attr(tag, "customFormat")) && attr(tag, "s")) rows.set(r, Number(attr(tag, "s")));
    // At most as many as a tab keeps cell styles: a file setting every row's height keeps its first.
    if ((["1", "true"].includes(attr(tag, "customHeight")) ? height && height !== usual : height > 1.25 * usual) && heights.size < HEIGHTS) heights.set(r, height);
  }
  // A cell's `r` may stand after its other attributes, or be left out for the one after the cell before it (and a row's, for the row after).
  const shown = [], lines = cols.size || rows.size;
  let r = -1, c = -1;
  for (const found of within(sheetXml, "sheetData").matchAll(/<(row|c)\b([^>]*?)\/?>/g)) {
    if (found[1] === "row") { const at = /\sr="(\d+)"/.exec(found[2]); r = at ? Number(at[1]) - 1 : r + 1; c = -1; continue; }
    const place = /\sr="([A-Z]+)(\d+)"/.exec(found[2]), s = Number(/\ss="(\d+)"/.exec(found[2])?.[1] ?? 0);
    if (place) { r = Number(place[2]) - 1; c = colIndex(place[1]); } else c += 1;
    if (!s && !lines) continue;
    if (shows[s]) shown.push([r, c, s]);
    else if (r < size.rows && c < size.cols) cells.push([r, c, s]);
  }
  // A run of one style from the values to past column AMJ is a whole row's style written cell by cell (as LibreOffice writes one): it is the row's.
  const byRow = new Map();
  for (const [r, c, s] of shown) (byRow.get(r) ?? byRow.set(r, new Map()).get(r)).set(c, s);
  for (const [r, at] of byRow) {
    let end = -1;
    for (const c of at.keys()) end = Math.max(end, c);
    if (end < 1023) continue;
    const s = at.get(end);
    let start = end;
    while (at.get(start - 1) === s) start--;
    if (start > size.cols || (rows.has(r) && rows.get(r) !== s)) continue;
    for (let c = start; c <= end; c++) at.delete(c);
    if (!rows.has(r)) rows.set(r, s);
  }
  for (const [r, at] of byRow) for (const [c, s] of at) cells.push([r, c, s]);
  // The tab grows through what can be seen touching it, a step at a time; a column style counts unless it runs to the sheet's edge.
  const wide = new Set();
  for (const tag of sheetXml.match(/<col\b[^>]*>/g) ?? []) if (Number(attr(tag, "max")) >= 1024) for (let c = Number(attr(tag, "min")) - 1; c < 16384; c++) wide.add(c);
  const seenCells = cells.filter(([, , s]) => shows[s]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  reach.rows = size.rows; reach.cols = size.cols;
  // Each cell is looked at once: by row until its row is reached, then, if its column is not yet, waiting under its column.
  const reached = (r, c) => { reach.rows = Math.max(reach.rows, r + 1); reach.cols = Math.max(reach.cols, c + 1); }, waiting = [];
  let next = 0, scanned = reach.cols;
  for (let was = -1; was !== reach.rows * 16384 + reach.cols;) {
    was = reach.rows * 16384 + reach.cols;
    for (; next < seenCells.length && seenCells[next][0] <= reach.rows; next++) { const [r, c] = seenCells[next]; if (c <= reach.cols) reached(r, c); else (waiting[c] ??= []).push(r); }
    while (scanned < reach.cols) { scanned++; for (const r of waiting[scanned] ?? []) reached(r, scanned); }
    while (shows[rows.get(reach.rows)]) reach.rows++;
    while (!wide.has(reach.cols) && shows[cols.get(reach.cols)]) reach.cols++;
  }
  return { cols, rows, heights, cells, reach, wide };
}
/** Whether a packed style can be seen on an empty cell. */
export const seen = (packed) => /(^| )(f=|b[trbl](?= |$))/.test(packed);

export { ownOver } from "../sheet-styles.js";

/** A colour as Excel writes it (RRGGBB): an ink as its font (or `fill`) colour, a #rrggbb as itself. */
export const rgbOf = (colour, fill) => (colour.startsWith("#") ? colour.slice(1) : INKS[colour]?.[fill ? 1 : 0] ?? "000000").toUpperCase();
const STROKE = { 1: "thin", medium: "medium", thick: "thick" };
// The lower-case words the look keeps (sheet-styles.js) in Excel's own case.
const EXCEL_WORD = Object.fromEntries(["hair", "dotted", "dashed", "dashDot", "dashDotDot", "double", "mediumDashed", "mediumDashDot", "mediumDashDotDot", "slantDashDot", "darkGray", "mediumGray", "lightGray", "gray125", "gray0625", "darkHorizontal", "darkVertical", "darkDown", "darkUp", "darkGrid", "darkTrellis", "lightHorizontal", "lightVertical", "lightDown", "lightUp", "lightGrid", "lightTrellis", "centerContinuous", "fill", "justify", "distributed"].map((word) => [word.toLowerCase(), word]));
const FACE = '<name val="Calibri"/><family val="2"/><scheme val="minor"/>';

/**
 * A written workbook's `styles.xml` and sheets given the look's styles: `styles` the part SheetJS wrote (its number formats are kept), `sheets` each tab's
 * XML with `styleAt(r, c)`, the packed style a cell wears (empty for none), `cols` and `rows`, each line's own, and `size`, the tab's rows and columns.
 * A line's style is written on its `<col>` or `<row>`; each cell's `s` is rewritten, and an empty cell is added only where it wears other than its line's.
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
    const font = idOf("font", `<font>${flag("b", "b")}${flag("i", "i")}${a.u2 ? '<u val="double"/>' : flag("u", "u")}${flag("s", "strike")}<sz val="${a.z ?? 11}"/>${a.c ? `<color rgb="FF${rgbOf(a.c)}"/>` : '<color theme="1"/>'}${a.n ? `<name val="${escaped(a.n.replace(/_/g, " "))}"/>` : FACE}</font>`);
    const fill = a.f ? idOf("fill", `<fill><patternFill patternType="${a.fp ? EXCEL_WORD[a.fp] : "solid"}"><fgColor rgb="FF${rgbOf(a.f, !a.fp)}"/>${a.fb ? `<bgColor rgb="FF${rgbOf(a.fb)}"/>` : '<bgColor indexed="64"/>'}</patternFill></fill>`) : 0;
    const line = a.bs ? EXCEL_WORD[a.bs] : STROKE[a.bw ?? 1], ink = a.bc ? `<color rgb="FF${rgbOf(a.bc)}"/>` : '<color indexed="64"/>';
    const side = (name, code) => (a[code] ? `<${name} style="${line}">${ink}</${name}>` : `<${name}/>`);
    const diagonal = a.bd ? `<diagonal style="${line}">${ink}</diagonal>` : "<diagonal/>", slant = a.bd ? `${a.bd !== "down" ? ' diagonalUp="1"' : ""}${a.bd !== "up" ? ' diagonalDown="1"' : ""}` : "";
    const border = idOf("border", `<border${slant}>${side("left", "bl")}${side("right", "br")}${side("top", "bt")}${side("bottom", "bb")}${diagonal}</border>`);
    const across = a.hx ? EXCEL_WORD[a.hx] : a.h;
    const align = [across && `horizontal="${across}"`, a.v && `vertical="${a.v === "middle" ? "center" : a.v}"`, a.r && `textRotation="${a.r}"`, a.w && 'wrapText="1"', a.in && `indent="${a.in}"`, a.k && 'shrinkToFit="1"'].filter(Boolean).join(" ");
    const id = idOf("xf", `<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${format ? ' applyNumberFormat="1"' : ""}${font ? ' applyFont="1"' : ""}${fill ? ' applyFill="1"' : ""}${border ? ' applyBorder="1"' : ""}${align ? ` applyAlignment="1"><alignment ${align}/></xf>` : "/>"}`);
    xfOf.set(name, id);
    return id;
  };
  const written = sheets.map(({ xml, styleAt, cols, rows: across, size }) => {
    const rows = new Map(), data = within(xml, "sheetData");
    for (const row of all(data, "row")) {
      const r = Number(attr(row, "r")) - 1, cells = new Map();
      for (const found of within(row, "row").matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(\/>|>[\s\S]*?<\/c>)/g)) cells.set(colIndex(found[1]), found[0]);
      rows.set(r, { open: /<row\b[^>]*?(?=\/?>)/.exec(row)[0], cells });
    }
    const rowOf = (r) => rows.get(r) ?? rows.set(r, { open: `<row r="${r + 1}"`, cells: new Map() }).get(r);
    for (const [r, packed] of across) rowOf(r).open += ` s="${xfFor(0, packed)}" customFormat="1"`;
    const place = (r, c) => {
      // What an empty cell shows without one: its row's style, else its column's.
      const packed = styleAt(r, c), cell = rows.get(r)?.cells.get(c);
      if (!cell && packed === (across.get(r) ?? cols.get(c) ?? "")) return;
      const open = cell && /^<c\b[^>]*?(?=\/?>)/.exec(cell)[0], s = xfFor(open ? formats[Number(attr(open, "s") ?? 0)] ?? 0 : 0, packed), worn = s ? ` s="${s}"` : "";
      rowOf(r).cells.set(c, open ? `${open.replace(/\s+s="\d+"/, "")}${worn}${cell.slice(open.length)}` : `<c r="${colName(c)}${r + 1}"${worn}/>`);
    };
    for (let r = 0; r < size.rows; r++) for (let c = 0; c < size.cols; c++) place(r, c);
    // Past the tab's values, where a styled row crosses a styled column: a workbook shows the row's style alone there, the sheet both.
    for (const r of across.keys()) for (const c of cols.keys()) if (r >= size.rows || c >= size.cols) place(r, c);
    // SheetJS's <col>s with each column's style, neighbours alike as one range.
    const kept = new Map();
    for (const tag of xml.match(/<col\b[^>]*>/g) ?? []) for (let c = Number(attr(tag, "min")) - 1; c < Number(attr(tag, "max")); c++) kept.set(c, tag.replace(/<col|\s(min|max|style)="[^"]*"|\/?>/g, ""));
    for (const c of cols.keys()) if (!kept.has(c)) kept.set(c, ' width="9.140625"');
    const runs = [];
    for (const [c, rest] of [...kept].sort((x, y) => x[0] - y[0])) {
      const said = `${rest}${cols.has(c) ? ` style="${xfFor(0, cols.get(c))}"` : ""}`, last = runs.at(-1);
      if (last && last.to === c - 1 && last.said === said) last.to = c; else runs.push({ from: c, to: c, said });
    }
    const columns = runs.map(({ from, to, said }) => `<col min="${from + 1}" max="${to + 1}"${said}/>`).join("");
    const lined = columns ? (/<cols>[\s\S]*?<\/cols>/.test(xml) ? xml.replace(/<cols>[\s\S]*?<\/cols>/, () => `<cols>${columns}</cols>`) : xml.replace("<sheetData", () => `<cols>${columns}</cols><sheetData`)) : xml;
    const body = [...rows].sort((a, b) => a[0] - b[0]).map(([, row]) => `${row.open}>${[...row.cells].sort((a, b) => a[0] - b[0]).map(([, cell]) => cell).join("")}</row>`).join("");
    return lined.replace(/<sheetData\/>|<sheetData>[\s\S]*<\/sheetData>/, () => `<sheetData>${body}</sheetData>`);
  });
  const block = (kind, tag) => `<${tag} count="${lists[kind].length}">${lists[kind].join("")}</${tag}>`;
  const out = styles.replace(/<fonts\b[\s\S]*?<\/fonts>/, () => block("font", "fonts")).replace(/<fills\b[\s\S]*?<\/fills>/, () => block("fill", "fills")).replace(/<borders\b[\s\S]*?<\/borders>/, () => block("border", "borders")).replace(/<cellXfs\b[\s\S]*?<\/cellXfs>/, () => block("xf", "cellXfs"));
  return { styles: out, sheets: written };
}

const CELL_IS = { lessThan: "<", greaterThan: ">", lessThanOrEqual: "<=", greaterThanOrEqual: ">=", equal: "=", notEqual: "<>", between: "between", notBetween: "notBetween" };
const OPERATOR = Object.fromEntries(Object.entries(CELL_IS).map(([word, op]) => [op, word]));
// A text rule's kind in a file, its operator there, and the formula a workbook keeps beside it (`{t}` the text, `{c}` the range's first cell).
const TEXT_RULES = { contains: ["containsText", "containsText", "NOT(ISERROR(SEARCH({t},{c})))"], notContains: ["notContainsText", "notContains", "ISERROR(SEARCH({t},{c}))"], begins: ["beginsWith", "beginsWith", "LEFT({c},LEN({t}))={t}"], ends: ["endsWith", "endsWith", "RIGHT({c},LEN({t}))={t}"] };
const TEXT_KINDS = Object.fromEntries(Object.entries(TEXT_RULES).map(([op, [type]]) => [type, op]));
const escaped = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// What follows conditional formats in a sheet's part, in the schema's order: they go before the first of these there is.
const AFTER_RULES = /<(?:dataValidations|hyperlinks|printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b|<\/worksheet>/;

/** Each conditional format's style of a workbook's `styles.xml` (`dxfs`) as a packed style: text colour, fill, bold, italic, underline, a line through, edges. */
export function readDxfs(stylesXml, themeXml) {
  const theme = themeColours(themeXml ?? "");
  return all(within(stylesXml, "dxfs"), "dxf").map((dxf) => {
    const font = first(dxf, "font") ?? "", pattern = first(dxf, "patternFill"), out = {};
    for (const [name, code] of [["b", "b"], ["i", "i"], ["u", "u"], ["strike", "s"]]) if (on(font, name)) out[code] = true;
    const ink = colourOf(first(font, "color"), theme), fill = pattern && attr(pattern, "patternType") !== "none" ? colourOf(first(pattern, "bgColor"), theme) ?? colourOf(first(pattern, "fgColor"), theme) : undefined;
    if (ink) out.c = inkOf(ink, 0);
    if (fill) out.f = inkOf(fill, 1);
    // Its edges, drawn at the sheet's one weight.
    for (const [side, code] of SIDES) { const tag = first(within(dxf, "border"), side), kind = attr(tag, "style"); if (kind && kind !== "none") { out[code] = true; out.bc ??= colourOf(first(tag, "color"), theme); } }
    if (out.bc === undefined || out.bc === "#000000") delete out.bc;
    // A sheet's style has no number format: a rule's own is kept beside it (`fmt`), and the dxf as written for a rule the sheet keeps unread.
    return Object.assign(new String(encodeStyle(out)), { fmt: attr(first(dxf, "numFmt"), "formatCode"), xml: dxf });
  });
}
/**
 * A sheet's conditional formats as a look's rules by A1 (sheet-rules.d.ts SheetRuleA1), the first over the rest: cell-value comparisons and formulas.
 * `unread`: the rules of other kinds (colour scales, data bars, icon sets…) by kind, which are left out.
 */
export function sheetRules(sheetXml, dxfs, themeXml) {
  const found = [], unread = {}, kept = [], theme = themeColours(themeXml ?? "");
  for (const block of all(sheetXml, "conditionalFormatting")) {
    const ranges = attr(block, "sqref") ?? "";
    for (const rule of all(block, "cfRule")) {
      const type = attr(rule, "type"), formulas = all(rule, "formula").map((tag) => unescaped(within(tag, "formula")).replace(/_xlfn\.|_xlws\./g, "")), style = dxfs[Number(attr(rule, "dxfId"))];
      const op = CELL_IS[attr(rule, "operator") ?? ""], text = attr(rule, "text");
      if (TEXT_KINDS[type] && style !== undefined && text !== undefined) { found.push({ priority: Number(attr(rule, "priority")) || Infinity, rule: { ranges, kind: "text", op: TEXT_KINDS[type], a: text, style: String(style), ...(["1", "true"].includes(attr(rule, "stopIfTrue")) ? { stop: true } : {}) } }); continue; }
      // A rule the sheet does not draw (a colour scale, data bar, icon set, top 10…) is kept as the file wrote it, with its dxf, and written back.
      if (style === undefined || !formulas.length || (type === "cellIs" ? !op || (op.endsWith("etween") && formulas.length < 2) : type !== "expression")) {
        // The page draws it from its colours, theme and tint resolved, and its dxf as a packed style.
        const colors = all(rule, "color").map((tag) => colourOf(tag, theme) ?? "#000000");
        kept.push({ ranges, xml: rule.replace(/\s(dxfId|priority)="[^"]*"/g, ""), ...(colors.length ? { colors } : {}), ...(style ? { dxf: style.xml, style: String(style), ...(style.fmt ? { fmt: style.fmt } : {}) } : {}) }); continue;
      }
      // Excel stops at a rule that holds and says so, the rules below it unread for that cell.
      const said = { style: String(style), ...(style.fmt ? { fmt: style.fmt } : {}), ...(["1", "true"].includes(attr(rule, "stopIfTrue")) ? { stop: true } : {}) };
      found.push({ priority: Number(attr(rule, "priority")) || Infinity, rule: type === "cellIs" ? { ranges, kind: "value", op, a: formulas[0], ...(op.endsWith("etween") ? { b: formulas[1] } : {}), ...said } : { ranges, kind: "formula", a: formulas[0], ...said } });
    }
  }
  for (const block of sheetXml.match(/<x14:cfRule\b[^>]*>/g) ?? []) { const type = attr(block, "type"); unread[type] = (unread[type] ?? 0) + 1; }
  return { rules: found.sort((a, b) => a.priority - b.priority).map(({ rule }) => rule), unread, kept };
}
/** Each tab's rules (SheetRuleA1[], or none) as a sheet part's `<conditionalFormatting>` blocks, and the `dxfs` they name, for `withRules`. `formula`: a formula as the file stores it. */
export function writeRules(tabsRules, formula, tabsKept = []) {
  const dxfs = [], ids = new Map(), dxfOf = (packed, fmt) => {
    const id = `${packed}|${fmt ?? ""}`;
    if (ids.has(id)) return ids.get(id);
    const a = decodeStyle(packed), flag = (code, tag) => (a[code] ? `<${tag}/>` : "");
    const font = `${flag("b", "b")}${flag("i", "i")}${flag("u", "u")}${flag("s", "strike")}${a.c ? `<color rgb="FF${rgbOf(a.c)}"/>` : ""}`;
    // A conditional format's solid fill is its background colour, as Excel writes it.
    const edges = SIDES.some(([, code]) => a[code]) ? `<border>${SIDES.map(([side, code]) => a[code] ? `<${side} style="thin">${a.bc ? `<color rgb="FF${rgbOf(a.bc)}"/>` : '<color indexed="64"/>'}</${side}>` : "").join("")}</border>` : "";
    const format = typeof fmt === "string" && fmt ? `<numFmt numFmtId="${164 + dxfs.length}" formatCode="${escaped(fmt)}"/>` : "";
    dxfs.push(`<dxf>${font ? `<font>${font}</font>` : ""}${format}${a.f ? `<fill><patternFill patternType="solid"><bgColor rgb="FF${rgbOf(a.f, true)}"/></patternFill></fill>` : ""}${edges}</dxf>`);
    ids.set(id, dxfs.length - 1);
    return dxfs.length - 1;
  };
  let priority = 0;
  const sheets = tabsRules.map((rules, n) => (Array.isArray(rules) ? rules : []).map((rule) => {
    const stop = rule.stop ? ' stopIfTrue="1"' : "";
    if (rule.kind === "text") {
      const [type, operator, kept] = TEXT_RULES[rule.op] ?? TEXT_RULES.contains, quoted = `"${String(rule.a).replace(/"/g, '""')}"`, corner = String(rule.ranges).split(/[\s:]/)[0].replace(/\$/g, "");
      return `<conditionalFormatting sqref="${escaped(rule.ranges)}"><cfRule type="${type}" dxfId="${dxfOf(rule.style ?? "")}" priority="${++priority}"${stop} operator="${operator}" text="${escaped(String(rule.a))}"><formula>${escaped(kept.replaceAll("{t}", quoted).replaceAll("{c}", corner))}</formula></cfRule></conditionalFormatting>`;
    }
    const formulas = [rule.a, ...(rule.kind === "value" && rule.op?.endsWith("etween") ? [rule.b ?? ""] : [])].map((text) => `<formula>${escaped(formula(text))}</formula>`).join("");
    const kind = rule.kind === "formula" ? 'type="expression"' : `type="cellIs" operator="${OPERATOR[rule.op]}"`;
    return `<conditionalFormatting sqref="${escaped(rule.ranges)}"><cfRule ${kind} dxfId="${dxfOf(rule.style ?? "", rule.fmt)}" priority="${++priority}"${rule.stop ? ' stopIfTrue="1"' : ""}>${formulas}</cfRule></conditionalFormatting>`;
  }).join("") + (Array.isArray(tabsKept[n]) ? tabsKept[n] : []).filter((one) => typeof one?.xml === "string" && /^<cfRule\b/.test(one.xml) && typeof one.ranges === "string").map((one) => {
    const dxf = typeof one.dxf === "string" && /^<dxf\b/.test(one.dxf) ? ` dxfId="${dxfs.push(one.dxf) - 1}"` : "";
    return `<conditionalFormatting sqref="${escaped(one.ranges)}">${one.xml.replace(/^<cfRule\b/, `<cfRule${dxf} priority="${++priority}"`)}</conditionalFormatting>`;
  }).join(""));
  return { dxfs: `<dxfs count="${dxfs.length}">${dxfs.join("")}</dxfs>`, sheets };
}
/** A styles part given the rules' `dxfs`, and a sheet part its rules, in their places by the schema. */
export const withDxfs = (stylesXml, dxfs) => /<dxfs\b[^>]*\/>|<dxfs\b[\s\S]*?<\/dxfs>/.test(stylesXml) ? stylesXml.replace(/<dxfs\b[^>]*\/>|<dxfs\b[\s\S]*?<\/dxfs>/, () => dxfs) : stylesXml.replace(/<tableStyles\b|<\/styleSheet>/, (at) => `${dxfs}${at}`);
export const withRules = (sheetXml, blocks) => blocks ? sheetXml.replace(AFTER_RULES, (at) => `${blocks}${at}`) : sheetXml;
