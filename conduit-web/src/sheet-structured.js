import { colName } from "./sheet-format.js";

/*
 * Excel's structured references (`Table1[Amount]`, `[@Qty]`, `Table1[[#Totals],[Tax]]`) over a workbook's tables (sheet-tables.js). The engine has
 * none: a cell keeps the structured text and the engine is given A1 (`toA1`). A reference to a missing table or column is given `#REF!`, its text kept.
 * The tables, each `{ name, tab, sheet, header, first, last, total, left, right, columns }` by its lowercased name (`tab` its id, `sheet` its name as a
 * formula writes it before `!`, rows and columns by index, -1 for no header or total row), are the caller's (tableInfos).
 */
const SHEET = String.raw`(?:'(?:[^']|'')*'|[A-Za-z_À-￿][\w.À-￿]*)!`, CELL = String.raw`\$?[A-Za-z]{1,3}\$?\d+`;
const ERROR = String.raw`#(?:REF!|VALUE!|NAME\?|N\/A|DIV\/0!|NUM!|NULL!)`;
const REF = new RegExp(`(?:${SHEET})?(?:${CELL}(?::(?:${SHEET})?${CELL})?|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}|\\$?\\d+:\\$?\\d+|${ERROR})`, "iy");
const IDENT = /[A-Za-z_\\À-￿][\w.\\À-￿]*/y, NUMBER = /\d*\.?\d+(?:E[+-]?\d+)?/iy, WORD = /[\w.\\À-￿]/;
/** Excel's special items, which name a table's rows. */
export const SPECIALS = ["#All", "#Data", "#Headers", "#Totals", "#This Row"];

const quoted = (text, at, mark) => { for (let i = at + 1; i < text.length; i++) if (text[i] === mark) { if (text[i + 1] === mark) i++; else return i + 1; } return text.length; };
const bracketEnd = (text, at) => { let depth = 0; for (let i = at; i < text.length; i++) { const ch = text[i]; if (ch === "'") i++; else if (ch === "[") depth++; else if (ch === "]" && --depth === 0) return i + 1; } return text.length; };
/**
 * A formula's references in order: `a1` (a cell, range or error, sheet-qualified or not), `struct` (`table` its name, or null for the cell's own) and
 * `name` (a bare name: a table's whole data where it names one). Nothing inside a string literal is one.
 */
export function referencesOf(text) {
  const out = [];
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '"') { i = quoted(text, i, '"'); continue; }
    if (ch === "[") { const end = bracketEnd(text, i); out.push({ kind: "struct", start: i, end, table: null, open: i }); i = end; continue; }
    if (WORD.test(text[i - 1] ?? "") && ch !== "'") { i++; continue; }
    if (ch === "'" || ch === "$" || ch === "#" || WORD.test(ch)) {
      REF.lastIndex = i;
      const ref = REF.exec(text), end = ref ? i + ref[0].length : i;
      if (ref && !WORD.test(text[end] ?? "") && text[end] !== "(" && text[end] !== "[") { out.push({ kind: "a1", start: i, end }); i = end; continue; }
      if (ch === "'") { i = quoted(text, i, "'"); continue; }
      if (/\d|\./.test(ch)) { NUMBER.lastIndex = i; i += NUMBER.exec(text)?.[0].length || 1; continue; }
      IDENT.lastIndex = i;
      const word = IDENT.exec(text)?.[0];
      if (!word) { i++; continue; }
      const after = i + word.length;
      if (text[after] === "[") { const close = bracketEnd(text, after); out.push({ kind: "struct", start: i, end: close, table: word, open: after }); i = close; continue; }
      if (text[after] !== "(" && text[after] !== "!") out.push({ kind: "name", start: i, end: after, table: word });
      i = after; continue;
    }
    i++;
  }
  return out;
}

const unescape = (text) => text.replace(/'(.)/g, "$1");
/** A column's name as brackets hold it: `'` before each `'`, `#`, `[` and `]`. */
export const escapeName = (name) => name.replace(/['#[\]]/g, "'$&"), escape = escapeName;
const special = (text) => SPECIALS.find((one) => one.toLowerCase() === text.trim().replace(/\s+/g, " ").toLowerCase());
// Items in brackets `[a],[b]:[c]` from `at`: each `{ text, start, end }` (its inside), `range` when joined to the one before by `:`.
const itemsOf = (text, at, stop) => {
  const items = [];
  for (let i = at; i < stop;) {
    if (text[i] === "[") { const end = bracketEnd(text, i); items.push({ text: text.slice(i + 1, end - 1), start: i + 1, end: end - 1, range: text.slice(at, i).trim().endsWith(":") && items.length > 0 }); at = i = end; continue; }
    if (/[\s,:]/.test(text[i])) { i++; continue; }
    return null;
  }
  return items;
};
/**
 * A structured reference's parts: its specials, its columns (each `{ name, start, end }`, `to` the second of `[A]:[B]`), whether it is `@` (this row).
 * Positions are in `text`. Null where it is not one.
 */
function partsOf(text, ref) {
  const inner = ref.open + 1, stop = ref.end - 1, body = text.slice(inner, stop), specials = [], columns = [];
  let row = false, items;
  if (body.startsWith("@")) {
    row = true;
    const rest = body.slice(1).trimStart(), from = stop - rest.length;
    items = rest === "" ? [] : rest.startsWith("[") ? itemsOf(text, from, stop) : [{ text: rest, start: from, end: stop }];
  } else items = body.trimStart().startsWith("[") ? itemsOf(text, inner, stop) : body.trim() === "" ? [] : [{ text: body, start: inner, end: stop }];
  if (!items) return null;
  for (const item of items) {
    const said = special(unescape(item.text));
    if (item.text.trimStart().startsWith("#")) { if (!said) return null; if (said === "#This Row") row = true; else specials.push({ said, ...item }); }
    else if (item.range && columns.length) columns[columns.length - 1].to = { name: unescape(item.text), start: item.start, end: item.end };
    else columns.push({ name: unescape(item.text), start: item.start, end: item.end });
  }
  return { row, specials, columns, items };
}
const columnOf = (table, name) => { const low = name.toLowerCase(), at = table.columns.findIndex((one) => one.toLowerCase() === low); return at >= 0 ? at : table.columns.findIndex((one) => one.trim().toLowerCase() === low.trim()); };
/** The table holding a cell (its header and total rows too), or undefined. */
export const tableAt = (tables, at) => { for (const one of tables.values()) if (one.tab === at.tab && at.row >= (one.header >= 0 ? one.header : one.first) && at.row <= (one.total >= 0 ? one.total : one.last) && at.col >= one.left && at.col <= one.right) return one; };
const tableOf = (tables, ref, at) => ref.table === null ? tableAt(tables, at) : tables.get(ref.table.toLowerCase());
// The area a reference's parts name in its table, or the error the engine is given.
function areaOf(table, parts, at) {
  let left = table.left, right = table.right;
  if (parts.columns.length > 1) return "#REF!";
  if (parts.columns.length) {
    const one = parts.columns[0], from = columnOf(table, one.name), to = one.to ? columnOf(table, one.to.name) : from;
    if (from < 0 || to < 0) return "#REF!";
    left = table.left + Math.min(from, to); right = table.left + Math.max(from, to);
  }
  const has = (name) => parts.specials.some((one) => one.said === name), top = table.header >= 0 ? table.header : table.first, bottom = table.total >= 0 ? table.total : table.last;
  if (parts.row) return at.tab === table.tab && at.row >= table.first && at.row <= table.last ? { top: at.row, bottom: at.row, left, right } : "#VALUE!";
  if (has("#All")) return { top, bottom, left, right };
  const headers = has("#Headers"), totals = has("#Totals"), data = has("#Data") || (!headers && !totals);
  if ((headers && table.header < 0 && !data) || (totals && table.total < 0 && !data)) return "#REF!";
  return { top: headers && table.header >= 0 ? table.header : data ? table.first : table.total, bottom: totals && table.total >= 0 ? table.total : data ? table.last : table.header, left, right };
}
const a1Of = (table, area, at) => {
  const corner = (row, col) => `${colName(col)}${row + 1}`, ends = area.top === area.bottom && area.left === area.right ? corner(area.top, area.left) : `${corner(area.top, area.left)}:${corner(area.bottom, area.right)}`;
  return table.tab === at.tab ? ends : `${table.sheet}!${ends}`;
};

/**
 * A formula's structured references as A1 for the engine, at its cell `at` ({ tab, row, col }): `{ a1, stored, names }`, `stored` the text with each
 * table, column and special name in its own casing, `names` the lowercased table names it reads (missing ones too, so a table made later is found).
 * Null for a formula with none.
 */
export function toA1(text, tables, at) {
  const refs = referencesOf(text).filter((ref) => ref.kind === "struct" || (ref.kind === "name" && tables.has(ref.table.toLowerCase())));
  if (!refs.length) return null;
  let a1 = "", stored = "", from = 0, kept = 0;
  const names = new Set();
  for (const ref of refs) {
    const table = tableOf(tables, ref, at);
    // A bare one outside any table is noted under "", so a table grown or made round its cell finds it.
    names.add(ref.table !== null ? ref.table.toLowerCase() : table ? table.name.toLowerCase() : "");
    a1 += text.slice(from, ref.start);
    from = ref.end;
    if (ref.kind === "name") { a1 += a1Of(table, { top: table.first, bottom: table.last, left: table.left, right: table.right }, at); stored += text.slice(kept, ref.start) + table.name; kept = ref.end; continue; }
    const parts = partsOf(text, ref);
    if (!table || !parts) { a1 += "#REF!"; continue; }
    // Names in their own casing, kept as typed otherwise.
    const fixes = [...ref.table === null ? [] : [[ref.start, ref.start + ref.table.length, table.name]], ...parts.specials.map((one) => [one.start, one.end, one.said]),
      ...parts.columns.flatMap((one) => [one, ...one.to ? [one.to] : []]).flatMap((one) => { const n = columnOf(table, one.name); return n < 0 ? [] : [[one.start, one.end, escape(table.columns[n])]]; })];
    for (const [start, end, name] of fixes.sort((a, b) => a[0] - b[0])) { stored += text.slice(kept, start) + (unescape(text.slice(start, end)) === name || text.slice(start, end) === name ? text.slice(start, end) : name); kept = end; }
    const area = areaOf(table, parts, at);
    a1 += typeof area === "string" ? area : area.top > area.bottom ? "#REF!" : a1Of(table, area, at);
  }
  return { a1: a1 + text.slice(from), stored: stored + text.slice(kept), names: [...names] };
}

/**
 * A formula the engine rewrote (its A1 refs moved by a row or column inserted, deleted or moved), as the stored structured text: each A1 reference
 * of `stored` takes the engine's, in order, each structured one stays. `stored` itself where they do not pair up.
 */
export function alignA1(stored, engine, tables) {
  const mine = referencesOf(stored).filter((ref) => ref.kind !== "name" || tables.has(ref.table.toLowerCase())), theirs = referencesOf(engine).filter((ref) => ref.kind === "a1");
  if (mine.length !== theirs.length) return stored;
  let out = "", from = 0;
  mine.forEach((ref, n) => { if (ref.kind === "a1") { out += stored.slice(from, ref.start) + engine.slice(theirs[n].start, theirs[n].end); from = ref.end; } });
  return out + stored.slice(from);
}

const plain = (name) => /^[\p{L}\p{N}_]+$/u.test(name);
/** A column as a reference names it: `[Amount]`, or `[@Amount]` / `[@[Net amount]]` for this row. */
const column = (name, row) => row ? (plain(name) ? `[@${name}]` : `[@[${escape(name)}]]`) : `[${escape(name)}]`;
/**
 * A range of a tab (`area` by index on tab `tab`) as a structured reference from the cell `at`, or null where it is not a whole part of one table:
 * `[@Amount]` for this row of the cell's own table (`Table1[@Amount]` from outside it), `Table1[Amount]`, `Table1[[#Totals],[Amount]]`,
 * `Table1[[Amount]:[Tax]]`, `Table1[#All]`, `Table1` for all its data.
 */
export function structuredFor(tables, at, tab, area) {
  const table = tableAt(tables, { tab, row: area.top, col: area.left });
  if (!table || area.bottom > (table.total >= 0 ? table.total : table.last) || area.right > table.right) return null;
  const cols = area.left === table.left && area.right === table.right ? null : [table.columns[area.left - table.left], table.columns[area.right - table.left]];
  if (cols?.some((one) => one === undefined)) return null;
  const own = tableAt(tables, at) === table, colsText = cols && (cols[0] === cols[1] ? `[${escape(cols[0])}]` : `[${escape(cols[0])}]:[${escape(cols[1])}]`);
  if (area.top === area.bottom && area.top === at.row && at.tab === tab && area.top >= table.first && area.top <= table.last) {
    if (cols && cols[0] === cols[1]) return `${own ? "" : table.name}${column(cols[0], true)}`;
    return `${own ? "" : table.name}[@${cols ? `${colsText}` : ""}]`;
  }
  const top = table.header >= 0 ? table.header : table.first, bottom = table.total >= 0 ? table.total : table.last;
  const rows = area.top === table.first && area.bottom === table.last ? null : area.top === top && area.bottom === bottom ? "#All" : area.top === table.header && area.bottom === table.header ? "#Headers"
    : area.top === table.total && area.bottom === table.total ? "#Totals" : area.top === table.header && area.bottom === table.last ? "[#Headers],[#Data]" : area.top === table.first && area.bottom === table.total ? "[#Data],[#Totals]" : undefined;
  if (rows === undefined) return null;
  if (!rows) return cols ? `${table.name}${cols[0] === cols[1] ? `[${escape(cols[0])}]` : `[${colsText}]`}` : table.name;
  const said = rows.startsWith("[") ? rows : `[${rows}]`;
  return cols ? `${table.name}[${said},${colsText}]` : `${table.name}[${rows}]`;
}
/** A formula's A1 references that are whole parts of a table, written structured (structuredFor), at its cell `at` on its tab; others kept. */
export function fromA1(text, tables, at, sheetTab) {
  let out = "", from = 0;
  for (const ref of referencesOf(text)) {
    if (ref.kind !== "a1") continue;
    const said = text.slice(ref.start, ref.end), hit = /^(?:(.+)!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i.exec(said);
    if (!hit) continue;
    const tab = hit[1] ? sheetTab(hit[1]) : at.tab, col = (letters) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const area = { top: Math.min(hit[3] - 1, (hit[5] ?? hit[3]) - 1), bottom: Math.max(hit[3] - 1, (hit[5] ?? hit[3]) - 1), left: Math.min(col(hit[2]), col(hit[4] ?? hit[2])), right: Math.max(col(hit[2]), col(hit[4] ?? hit[2])) };
    const structured = tab === undefined ? null : structuredFor(tables, at, tab, area);
    if (structured) { out += text.slice(from, ref.start) + structured; from = ref.end; }
  }
  return out + text.slice(from);
}

// Each structured reference to a table rewritten by `edit(ref, parts, table)` (its new text, or undefined to keep it).
const rewrite = (text, tables, at, edit) => {
  let out = "", from = 0;
  for (const ref of referencesOf(text)) {
    if (ref.kind !== "struct") continue;
    const parts = partsOf(text, ref), next = parts && edit(ref, parts, tableOf(tables, ref, at));
    if (next !== undefined && next !== null) { out += text.slice(from, ref.start) + next; from = ref.end; }
  }
  return out + text.slice(from);
};
/** A formula with each reference to table `from` (lowercased match) naming `to`, as Excel rewrites them on a rename. */
export function renameTable(text, from, to) {
  let out = "", at = 0;
  for (const ref of referencesOf(text)) if ((ref.kind === "struct" || ref.kind === "name") && ref.table?.toLowerCase() === from.toLowerCase()) { out += text.slice(at, ref.start) + to; at = ref.start + ref.table.length; }
  return out + text.slice(at);
}
/** A formula at `at` with each reference to column `from` of table `table` (its info) naming `to`. */
export function renameColumn(text, tables, at, table, from, to) {
  return rewrite(text, tables, at, (ref, parts, of) => {
    if (of !== table) return undefined;
    const spans = parts.columns.flatMap((one) => [one, ...one.to ? [one.to] : []]).filter((one) => one.name.toLowerCase() === from.toLowerCase());
    if (!spans.length) return undefined;
    let out = "", kept = ref.start;
    for (const one of spans) {
      // `[@Amount]` holds the name bare: a new name needing brackets takes them.
      const bare = parts.row && text[one.start - 1] === "@";
      out += text.slice(kept, one.start) + (bare && !plain(to) ? `[${escape(to)}]` : escape(to)); kept = one.end;
    }
    return out + text.slice(kept, ref.end);
  });
}
/** A formula as an .xlsx holds it: `[@Amount]` as `Table1[[#This Row],[Amount]]`, `[Amount]` as `Table1[Amount]`. */
export function toFile(text, tables, at) {
  return rewrite(text, tables, at, (ref, parts, table) => {
    if (!table) return undefined;
    const name = table.name, inner = text.slice(ref.open + 1, ref.end - 1);
    if (!parts.row) return ref.table === null ? `${name}[${inner}]` : undefined;
    const rest = parts.items.filter((item) => special(unescape(item.text)) !== "#This Row").map((item) => `${item.range ? ":" : ","}[${item.text}]`).join("").replace(/^,/, "").replace(/,:/g, ":");
    return `${name}[[#This Row]${rest ? `,${rest}` : ""}]`;
  });
}
/** A formula from an .xlsx: `Table1[[#This Row],[Amount]]` as `[@Amount]` in Table1's own cells, `Table1[@Amount]` elsewhere. */
export function fromFile(text, tables, at) {
  return rewrite(text, tables, at, (ref, parts, table) => {
    if (!table || !parts.row || parts.specials.length || text[ref.open + 1] === "@") return undefined;
    const own = tableAt(tables, at) === table ? "" : table.name, [one] = parts.columns;
    if (!one) return `${own}[@]`;
    return one.to ? `${own}[@[${escape(one.name)}]:[${escape(one.to.name)}]]` : `${own}${column(one.name, true)}`;
  });
}
