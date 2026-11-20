import { key } from "./sheet-format.js";
import { writeFormat } from "./sheet-formats.js";
import { paintStyle } from "./sheet-styles.js";
import { PLAIN, putType } from "./sheet-types.js";

/*
 * Smart chips (sheet-chips.d.ts): `chip:<rowId>:<colId>` in a sheet's look holds what a cell is shown as, by ids, so it follows its cell through sorts,
 * inserts, deletes and moves as a style does; the cell's own value stays the plain text a formula or an export reads. Written the same here and on the hub
 * (`{ op: "chip" }`), in the caller's transaction.
 */
export const CHIP = "chip:";
const KINDS = ["link", "person", "artifact", "date"], ARTIFACTS = ["paper", "sheet", "site", "markdown"];
const word = (value, most) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().replace(/^=+/, "").slice(0, most) : "";

/** A chip as kept, or null where it is none: a link (its page's `title`, `url` written as the cell's link), a person or agent (`id`, `name`, `role`), an artifact (`id`, `name`, `type`), or a date. */
export function cleanChip(chip) {
  if (!chip || typeof chip !== "object" || !KINDS.includes(chip.kind)) return null;
  if (chip.kind === "date") return { kind: "date" };
  if (chip.kind === "link") {
    const title = word(chip.title, 200), url = word(chip.url, 2000);
    return { kind: "link", ...(title ? { title } : {}), ...(url ? { url } : {}) };
  }
  const id = word(chip.id, 120), name = word(chip.name, 200);
  if (!id || !name) return null;
  if (chip.kind === "person") { const role = word(chip.role, 40); return { kind: "person", id, name, ...(role ? { role } : {}) }; }
  return { kind: "artifact", id, name, ...(ARTIFACTS.includes(chip.type) ? { type: chip.type } : {}) };
}

/** A kept chip read back (null: none). */
export function readChip(text) { try { return typeof text === "string" ? cleanChip(JSON.parse(text)) : null; } catch { return null; } }

/** A web address's host, as a link chip shows it with no title. */
export const hostOf = (url) => { try { return new URL(/^[a-z][\w+.-]*:/i.test(url) ? url : `https://${url}`).host.replace(/^www\./, ""); } catch { return url; } };

/**
 * The cell at `row`, `col` shown as `chip` (null: plain again). A person's or artifact's name is written as the cell's text; a link's `url` as its link,
 * and its title (else its host) as the text of a cell that is empty.
 */
export function writeChip(look, cells, sheet, row, col, chip) {
  const rowId = sheet.rowAt(row), colId = sheet.colAt(col);
  if (!rowId || !colId) throw Object.assign(new Error("That cell is past the tab's edge"), { status: 400 });
  const at = key(rowId, colId), clean = cleanChip(chip);
  if (!clean) return void look.delete(`${CHIP}${at}`);
  const { url, ...kept } = clean;
  if (url) look.set(`link:${at}`, url);
  look.set(`${CHIP}${at}`, JSON.stringify(kept));
  const text = "name" in kept ? kept.name : kept.kind === "link" && !cells.get(at) && (kept.title || url) ? kept.title || hostOf(url) : "";
  if (text) cells.set(at, text);
}

/**
 * Cells written lose the chips they no longer show: an emptied cell any chip, as Excel's Clear Contents takes a hyperlink's text, and a cell typed over
 * a person's or an artifact's, whose drawn name would hide what it now holds. `written`: each `[<rowId>:<colId>, input]`.
 */
export function clearChips(look, written) {
  for (const [at, input] of written) {
    const held = look.get(`${CHIP}${at}`), chip = held === undefined ? null : readChip(held);
    if (held !== undefined && (!input || (chip && "name" in chip && chip.name !== input))) look.delete(`${CHIP}${at}`);
  }
}

/** Chips copied from cells to cells, by position (`[fromRow, fromCol, toRow, toCol]`): where the source has none, the target's goes. */
export function copyChips(look, sheet, pairs) {
  for (const [fromRow, fromCol, row, col] of pairs) {
    const from = sheet.rowAt(fromRow) && sheet.colAt(fromCol) ? look.get(`${CHIP}${key(sheet.rowAt(fromRow), sheet.colAt(fromCol))}`) : undefined, rowId = sheet.rowAt(row), colId = sheet.colAt(col);
    if (!rowId || !colId) continue;
    const at = `${CHIP}${key(rowId, colId)}`;
    if (from === undefined) { if (look.has(at)) look.delete(at); } else if (look.get(at) !== from) look.set(at, from);
  }
}

/**
 * The whole look of cells copied to cells, as a fill copies it (`[fromRow, fromCol, toRow, toCol]`): style, number format, type (a validation with
 * it) and chip, each target made to wear what its source wears, whether its own or its line's.
 */
export function copyLook(look, sheet, pairs) {
  const list = [...pairs], worn = (what, row, col) => look.get(`${what}:${key(sheet.rowAt(row), sheet.colAt(col))}`) ?? look.get(`${what}:${sheet.colAt(col)}`);
  for (const [fromRow, fromCol, row, col] of list) {
    if (!sheet.rowAt(fromRow) || !sheet.colAt(fromCol) || !sheet.rowAt(row) || !sheet.colAt(col)) continue;
    const one = { top: row, bottom: row, left: col, right: col }, type = worn("type", fromRow, fromCol);
    paintStyle(look, sheet, { rows: [fromRow], cols: [fromCol] }, one);
    writeFormat(look, sheet, one, String(worn("fmt", fromRow, fromCol) ?? "General"), false);
    putType(look, sheet, one, type === undefined || type === PLAIN ? null : String(type), false);
  }
  copyChips(look, sheet, list);
}
