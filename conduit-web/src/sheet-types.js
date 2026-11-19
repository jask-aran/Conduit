import { key, parseRange, rangeA1 } from "./sheet-format.js";
import { SHEET_INKS } from "./sheet-styles.js";

/*
 * Cell types in a sheet's look (sheet-types.d.ts). A checkbox or a date is `type:<colId>` for a whole column, `type:<rowId>:<colId>` for a cell (a cell's
 * own over its column's, PLAIN where a cell under a typed column is plain). A dropdown is one of the tab's `validations:<tabId>`, Excel's data validations
 * as an xlsx import keeps them (server/sheet-xlsx.js): `{ range: "B2:B9 D4", type: "list", formula1: "\"Done,Late\"", inks: { Done: "green" } }`, `inks`
 * being ours alone. A type set on a range takes it out of every validation there. Shared by the page (components/sheet/types.ts) and the hub's `type` op.
 */
export const TYPE_CELL_LIMIT = 10_000;
export const PLAIN = "plain";

const span = (sheet, area) => { const { rows, cols } = sheet.size(); return { ...area, bottom: Math.min(area.bottom, rows - 1), right: Math.min(area.right, cols - 1) }; };

/** A tab's data validations, as kept. */
export function readValidations(look, tab) {
  const kept = look.get(`validations:${tab}`);
  if (Array.isArray(kept)) return kept;
  try { const list = JSON.parse(String(kept ?? "[]")); return Array.isArray(list) ? list : []; } catch { return []; }
}
/** A validation's ranges, each a box. */
export const areasOf = (validation) => String(validation?.range ?? "").split(/\s+/).flatMap((one) => { const area = parseRange(one.replace(/\$/g, "")); return area ? [area] : []; });
/** A list validation's options, as its formula lists them (`"a,b"`); null where it is no list, or its list is a range of cells. */
export function optionsOf(validation) {
  const listed = validation?.type === "list" && /^"(.*)"$/s.exec(String(validation.formula1 ?? "").trim());
  if (!listed) return null;
  const inks = validation.inks && typeof validation.inks === "object" ? validation.inks : {};
  return listed[1].replace(/""/g, '"').split(",").flatMap((value) => value ? [SHEET_INKS.includes(inks[value]) ? { value, ink: inks[value] } : { value }] : []);
}

/** Options as kept: each a value of its own, once (no commas, which Excel's list parts by), with an ink of the sheet's or none. */
export const cleanOptions = (options) => {
  const seen = new Set();
  return (Array.isArray(options) ? options : []).flatMap((one) => {
    const value = String(typeof one === "object" && one ? one.value ?? "" : one ?? "").replace(/,/g, " ").trim();
    if (!value || seen.has(value)) return [];
    seen.add(value);
    return [SHEET_INKS.includes(one?.ink) ? { value, ink: one.ink } : { value }];
  });
};
/** A list validation's own fields for `options`, as Excel writes a dropdown. */
export const listFields = (options) => {
  const clean = cleanOptions(options), inks = Object.fromEntries(clean.flatMap((one) => one.ink ? [[one.value, one.ink]] : []));
  return { type: "list", allowBlank: "1", showErrorMessage: "1", formula1: `"${clean.map((one) => one.value.replace(/"/g, '""')).join(",")}"`, ...(Object.keys(inks).length ? { inks } : {}) };
};

const cut = (area, away) => {
  if (away.top > area.bottom || away.bottom < area.top || away.left > area.right || away.right < area.left) return [area];
  const middle = { top: Math.max(area.top, away.top), bottom: Math.min(area.bottom, away.bottom) };
  return [
    area.top < away.top && { ...area, bottom: away.top - 1 }, area.bottom > away.bottom && { ...area, top: away.bottom + 1 },
    area.left < away.left && { ...middle, left: area.left, right: away.left - 1 }, area.right > away.right && { ...middle, left: away.right + 1, right: area.right },
  ].filter(Boolean);
};
/** The tab's validations set: `edit` takes the list and gives the next (in the caller's transaction). */
export function editValidations(look, tab, edit) {
  const next = edit(readValidations(look, tab)).filter((one) => String(one.range ?? "").trim());
  if (next.length) look.set(`validations:${tab}`, next); else look.delete(`validations:${tab}`);
}

/**
 * Sets `type` on `area`, clipped to the tab's own cells, in the caller's transaction: "boolean", "date", "list" (a dropdown of `options`) or null for
 * plain. `columns`: the area's whole columns take a checkbox or date, their cells' own types going; else each cell, kept only where it differs from its
 * column's. A fault is an Error with status 400.
 */
export function writeType(look, sheet, area, type, columns, options) {
  const at = span(sheet, area), cols = [];
  editValidations(look, sheet.id, (list) => [...list.map((one) => ({ ...one, range: areasOf(one).flatMap((part) => cut(part, at)).map(rangeA1).join(" ") })),
    ...type === "list" ? [{ range: rangeA1(at), ...listFields(options) }] : []]);
  const kept = type === "list" ? null : type;
  for (let c = at.left; c <= at.right; c++) cols.push(sheet.colAt(c));
  if (columns) {
    const ids = new Set(cols);
    for (const col of cols) if (kept) look.set(`type:${col}`, kept); else look.delete(`type:${col}`);
    for (const name of [...look.keys()]) { const parts = name.split(":"); if (parts.length === 3 && parts[0] === "type" && ids.has(parts[2])) look.delete(name); }
    return;
  }
  const count = (at.bottom - at.top + 1) * cols.length;
  if (count > TYPE_CELL_LIMIT) throw Object.assign(new Error(`That is ${count} cells; at most ${TYPE_CELL_LIMIT} take a type of their own at once: type whole columns instead`), { status: 400 });
  for (let r = at.top; r <= at.bottom; r++) {
    const row = sheet.rowAt(r);
    for (const col of cols) {
      const name = `type:${key(row, col)}`, column = look.get(`type:${col}`);
      if ((kept ?? undefined) === column) look.delete(name); else look.set(name, kept ?? PLAIN);
    }
  }
}
