import { a1, colName, key } from "./sheet-format.js";

/*
 * Cell styles in a sheet's look (sheet-styles.d.ts): one key per column (`style:<colId>`), row (`style:<rowId>`) or cell (`style:<rowId>:<colId>`), each
 * a packed string of what it sets, so a styled cell costs one key whatever it wears. A cell wears its own, else its row's, else its column's, attribute by
 * attribute. Shared by the page, which draws them (components/sheet/styles.ts), and the hub, which sets and lists them.
 */
export const STYLE_CELL_LIMIT = 10_000;
/** The inks, named as a paper's are (document-format.js PAPER_INKS), so each theme draws its own. */
export const SHEET_INKS = ["red", "amber", "green", "blue"];
export const SHEET_BORDERS = ["all", "outer", "inner", "top", "bottom", "left", "right", "none"];

// Each attribute's code in the packed string, in the order it is written; a flag stands alone (`b`), a value after `=` (`c=red`), and `-` before
// either is its default set on purpose, over what would be worn from beneath (`-b`: not bold in a bold column). A colour is an ink or, as a workbook
// brings it, `#rrggbb`: data, drawn as it is (components/sheet/shade.ts fits it to the theme); `bc` and `bw` are the colour and weight of every edge drawn.
const FLAGS = { bold: "b", italic: "i", underline: "u", strike: "s", wrap: "w" };
const EDGES = { top: "bt", right: "br", bottom: "bb", left: "bl" };
const VALUES = { color: "c", fill: "f", align: "h", valign: "v", borderColor: "bc", borderWeight: "bw", size: "z" };
const HEX = /^#[0-9a-f]{6}$/;
const colour = (word) => SHEET_INKS.includes(word) || HEX.test(word);
const WORDS = { h: ["left", "center", "right"], v: ["top", "middle", "bottom"], bw: ["medium", "thick"] };
const VALID = { ...Object.fromEntries(Object.entries(WORDS).map(([code, words]) => [code, (word) => words.includes(word)])), c: colour, f: colour, bc: (word) => HEX.test(word), z: (word) => /^\d{1,3}(\.\d)?$/.test(word) && Number(word) >= 1 && Number(word) <= 409 };
const INK = `${SHEET_INKS.join(", ")} or #rrggbb`, SAID = { c: INK, f: INK, bc: "#rrggbb", z: "a size in points, 1 to 409" };
const ORDER = [...Object.values(FLAGS), ...Object.values(VALUES), ...Object.values(EDGES)];
const valued = (code) => Object.hasOwn(VALID, code);
const fault = (message) => Object.assign(new Error(message), { status: 400 });

/** A packed style as attributes by code: true or false for a flag or an edge, a word or null (the default) for a value. */
export function decodeStyle(text) {
  const out = {};
  for (const token of String(text ?? "").split(" ")) {
    const off = token.startsWith("-"), [code, said] = (off ? token.slice(1) : token).split("="), word = said?.toLowerCase();
    if (!ORDER.includes(code)) continue;
    if (off) out[code] = valued(code) ? null : false;
    else if (!valued(code)) out[code] = true;
    else if (VALID[code](word)) out[code] = word;
  }
  return out;
}
export const encodeStyle = (attrs) => ORDER.flatMap((code) => { const value = attrs[code]; return value === undefined ? [] : [value === true ? code : value === false || value === null ? `-${code}` : `${code}=${value}`]; }).join(" ");
const isDefault = (value) => value === false || value === null;

/** A style as an agent says it (SheetStyle) as attributes, checked. */
export function styleAttrs(style) {
  if (!style || typeof style !== "object" || Array.isArray(style)) throw fault("style is an object such as { bold: true, fill: \"amber\", align: \"center\" }");
  const out = {};
  for (const [field, value] of Object.entries(style)) {
    if (Object.hasOwn(FLAGS, field)) { if (typeof value !== "boolean") throw fault(`${field} is true or false`); out[FLAGS[field]] = value; }
    else if (Object.hasOwn(VALUES, field)) { const code = VALUES[field]; const word = typeof value === "number" ? String(value) : typeof value === "string" ? value.toLowerCase() : value; if (word !== null && (typeof word !== "string" || !VALID[code](word))) throw fault(`${field} is ${SAID[code] ?? `one of ${WORDS[code].join(", ")}`}, or null for the default`); out[code] = word; }
    else if (field === "borders") {
      if (!value || typeof value !== "object") throw fault("borders is { top, right, bottom, left }, each true or false");
      for (const [edge, on] of Object.entries(value)) { if (!Object.hasOwn(EDGES, edge) || typeof on !== "boolean") throw fault("borders is { top, right, bottom, left }, each true or false"); out[EDGES[edge]] = on; }
    } else throw fault(`A style has bold, italic, underline, strike, wrap, color, fill, align, valign, borderColor, borderWeight, size and borders, not ${field}`);
  }
  return out;
}
/** Attributes as an agent reads them (SheetStyle). */
export function styleOf(attrs) {
  const out = {}, borders = {};
  for (const [field, code] of Object.entries(FLAGS)) if (attrs[code] !== undefined) out[field] = attrs[code];
  for (const [field, code] of Object.entries(VALUES)) if (attrs[code] !== undefined) out[field] = code === "z" && attrs[code] !== null ? Number(attrs[code]) : attrs[code];
  for (const [edge, code] of Object.entries(EDGES)) if (attrs[code] !== undefined) borders[edge] = attrs[code];
  return Object.keys(borders).length ? { ...out, borders } : out;
}

/** The edges a border choice gives a cell, by where it stands in the range. */
const edgesOf = (kind, top, bottom, left, right) => {
  if (kind === "all" || kind === "none") return { bt: kind === "all", br: kind === "all", bb: kind === "all", bl: kind === "all" };
  const out = {};
  // Inside borders: every edge two cells of the range share, as each cell's own.
  if (kind === "inner") { if (!top) out.bt = true; if (!bottom) out.bb = true; if (!left) out.bl = true; if (!right) out.br = true; return out; }
  if (top && (kind === "outer" || kind === "top")) out.bt = true;
  if (bottom && (kind === "outer" || kind === "bottom")) out.bb = true;
  if (left && (kind === "outer" || kind === "left")) out.bl = true;
  if (right && (kind === "outer" || kind === "right")) out.br = true;
  return out;
};
const without = (from, taken) => Object.fromEntries(Object.entries(from).filter(([code, value]) => taken[code] !== value));

const span = (sheet, area) => { const { rows, cols } = sheet.size(); return { ...area, bottom: Math.min(area.bottom, rows - 1), right: Math.min(area.right, cols - 1) }; };
const read = (look, name) => decodeStyle(look.get(name));
const put = (look, name, attrs) => { const text = encodeStyle(attrs); if (text) look.set(name, text); else look.delete(name); };

/**
 * Sets a style (SheetStyle: only what it names changes) and a border choice on `area`, in the caller's transaction. `whole`: the area's whole columns
 * or rows take what is the same along them, their cells' own of it going; a cell's own is kept only where it differs from what it would wear.
 */
export function writeStyle(look, sheet, area, { style, borders } = {}, whole = null) {
  if (borders !== undefined && !SHEET_BORDERS.includes(borders)) throw fault(`borders is one of ${SHEET_BORDERS.join(", ")}`);
  const attrs = style === undefined ? {} : styleAttrs(style), at = span(sheet, area);
  const patchAt = (r, c) => ({ ...attrs, ...(borders ? edgesOf(borders, r === at.top, r === at.bottom, c === at.left, c === at.right) : {}) });
  const setCell = (r, c, patch) => {
    const rowId = sheet.rowAt(r), colId = sheet.colAt(c), name = `style:${key(rowId, colId)}`, under = { ...read(look, `style:${colId}`), ...read(look, `style:${rowId}`) }, next = read(look, name);
    for (const [code, value] of Object.entries(patch)) if ((under[code] ?? (valued(code) ? null : false)) === value) delete next[code]; else next[code] = value;
    put(look, name, next);
  };
  if (!whole) {
    const count = (at.bottom - at.top + 1) * (at.right - at.left + 1);
    if (count > STYLE_CELL_LIMIT) throw fault(`That is ${count} cells; at most ${STYLE_CELL_LIMIT} take a style of their own at once: style whole columns or rows instead`);
    for (let r = at.top; r <= at.bottom; r++) for (let c = at.left; c <= at.right; c++) setCell(r, c, patchAt(r, c));
    return;
  }
  const byCols = whole === "cols", from = byCols ? at.left : at.top, to = byCols ? at.right : at.bottom, idAt = (n) => byCols ? sheet.colAt(n) : sheet.rowAt(n);
  // Read once: the cells with a style of their own by the line they are on, the rows that have one, and what any column of the tab wears.
  const cells = new Map(), styledRows = [], worn = new Set();
  for (const [name, text] of look.entries()) {
    const ids = name.split(":");
    if (ids[0] !== "style") continue;
    if (ids.length === 3) { const line = byCols ? ids[2] : ids[1]; cells.set(line, [...cells.get(line) ?? [], name]); }
    else if (sheet.indexOfCol(ids[1]) >= 0) for (const code of Object.keys(decodeStyle(text))) worn.add(code);
    else if (sheet.indexOfRow(ids[1]) >= 0) styledRows.push([sheet.indexOfRow(ids[1]), decodeStyle(text)]);
  }
  for (let n = from; n <= to; n++) {
    const id = idAt(n), line = byCols ? patchAt(-1, n) : patchAt(n, -1), next = { ...read(look, `style:${id}`), ...line };
    // A column's default is said by nothing; a row's is kept only where a column would show through it.
    for (const [code, value] of Object.entries(next)) if (isDefault(value) && (byCols || !worn.has(code))) delete next[code];
    put(look, `style:${id}`, next);
    for (const name of cells.get(id) ?? []) { const own = read(look, name); for (const code of Object.keys(line)) delete own[code]; put(look, name, own); }
    // A row that says otherwise would show over the column just set: its cell there says the column's.
    if (byCols) for (const [r, across] of styledRows) {
      const differs = Object.fromEntries(Object.entries(line).filter(([code, value]) => across[code] !== undefined && across[code] !== value));
      if (Object.keys(differs).length) setCell(r, n, differs);
    }
  }
  // What is not the same along a line (a range's outer edges at its ends) is its end cells' own.
  for (const end of new Set(byCols ? [at.top, at.bottom] : [at.left, at.right])) for (let n = from; n <= to; n++) {
    const r = byCols ? end : n, c = byCols ? n : end, rest = without(patchAt(r, c), byCols ? patchAt(-1, c) : patchAt(r, -1));
    if (Object.keys(rest).length) setCell(r, c, rest);
  }
}

/** What a cell's own style must say over what it would wear from beneath: what differs, and the defaults of what beneath sets. */
export const ownOver = (under, own) => {
  const out = {};
  for (const code of new Set([...Object.keys(under), ...Object.keys(own)])) if (own[code] !== under[code]) out[code] = own[code] ?? (typeof under[code] === "boolean" ? false : null);
  return out;
};

/**
 * What the cells of `from` (rows and columns by position) wear laid on `to`, in the caller's transaction, tiled as a paste is: over a range a whole
 * number of copies of `from`, else from `to`'s first cell at `from`'s size; each cell of it is given its own style, what makes it wear its source's.
 * `each` is told each source and target cell (formats.ts copies number formats by it). Cells past the tab's are left.
 */
export function paintStyle(look, sheet, from, to, each) {
  const { rows, cols } = sheet.size(), tall = from.rows.length, wide = from.cols.length;
  const height = (to.bottom - to.top + 1) % tall === 0 ? to.bottom - to.top + 1 : tall, width = (to.right - to.left + 1) % wide === 0 ? to.right - to.left + 1 : wide;
  const count = Math.min(height, rows - to.top) * Math.min(width, cols - to.left);
  if (count > STYLE_CELL_LIMIT) throw fault(`That is ${count} cells; at most ${STYLE_CELL_LIMIT} take a style of their own at once`);
  const lines = (r, c) => ({ ...read(look, `style:${sheet.colAt(c)}`), ...read(look, `style:${sheet.rowAt(r)}`) });
  const worn = from.rows.map((r) => from.cols.map((c) => ({ ...lines(r, c), ...read(look, `style:${key(sheet.rowAt(r), sheet.colAt(c))}`) })));
  for (let y = 0; y < height && to.top + y < rows; y++) for (let x = 0; x < width && to.left + x < cols; x++) {
    const r = to.top + y, c = to.left + x;
    put(look, `style:${key(sheet.rowAt(r), sheet.colAt(c))}`, ownOver(lines(r, c), worn[y % tall][x % wide]));
    each?.(from.rows[y % tall], from.cols[x % wide], r, c);
  }
}

/** The styles set within `area`, as sheet.json names them: a column's by its letter (`B`), a row's by its number (`5`), a cell's own by its address (`C4`). */
export function listStyles(look, sheet, area) {
  const at = span(sheet, area), out = {}, own = [];
  for (let c = at.left; c <= at.right; c++) { const text = look.get(`style:${sheet.colAt(c)}`); if (text) out[colName(c)] = styleOf(decodeStyle(text)); }
  for (let r = at.top; r <= at.bottom; r++) { const text = look.get(`style:${sheet.rowAt(r)}`); if (text) out[String(r + 1)] = styleOf(decodeStyle(text)); }
  for (const name of look.keys()) {
    const [what, row, col] = name.split(":");
    if (what !== "style" || col === undefined) continue;
    const r = sheet.indexOfRow(row), c = sheet.indexOfCol(col);
    if (r >= at.top && r <= at.bottom && c >= at.left && c <= at.right) own.push([r, c, look.get(name)]);
  }
  for (const [r, c, text] of own.sort((a, b) => a[0] - b[0] || a[1] - b[1])) out[a1(r, c)] = styleOf(decodeStyle(text));
  return out;
}
