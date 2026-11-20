import fs from "node:fs/promises";
import path from "node:path";
import { HyperFormula } from "hyperformula";
import { isDateFormat } from "numfmt";
import { CALL_LIMIT, CELLS, COLS, COL_LIMIT, LOOK, MAIN, ROWS, SHEET_FORMAT, SHEET_LIMIT, TAB, TABS, WORKBOOK_LIMIT, a1, colId, filterHides, rangedArea, colIndex, colName, colsOf, fromCsv, key, parseA1, parseRange, parseRef, rangeA1, rowId, rowsOf, tabName, tabNameFault, tabRef, toCsv, valueText } from "../sheet-format.js";
import { CONFIG, createWorkbookModel } from "../sheet-engine.js";
import { listFormats, writeFormat } from "../sheet-formats.js";
import { listStyles, writeStyle } from "../sheet-styles.js";
import { readRules, rulesA1, rulesIds, shiftRefs } from "../sheet-rules.js";
import { CHART_LIMIT, chartFrom, chartIds, chartsA1, keptCharts, readCharts } from "../sheet-charts.js";
import { writePrivateFile } from "../private-file.js";
import { cleanOptions, readDate, restoreValidations, validationsA1, VALID, writeType } from "../sheet-types.js";

/*
 * The sheet artifact kind on the hub (sheet-format.js): a .csv that holds the values, the formulas beside it in sheet.json, and the live copy in
 * a Yjs doc that pages merge with. A workbook of several tabs is a folder, <name>.sheet/, of one <tab>.csv per tab: a .csv becomes one when it is
 * given a second tab (`hub.folder`). documents.js holds the room, its comments and its hand-offs, and reads and writes a folder as one text (a JSON
 * object of each tab file's text by its name); this is what differs for a sheet.
 * `hub.fault(status, message)`; `hub.as(room, by, change)`: runs `change(sign)` with the doc writing as the agent `by`, `sign()` recording
 * who that is, called inside the change; `hub.folder(room)`: the sheet's file moves into a workbook folder, and the room's entry with it.
 */
export const FOLDER = ".sheet";
/** A tab's file in its workbook's folder: its name, with what no file name on any device can hold (and `%`, so it reads back) as %XX. */
export const tabFile = (name) => `${name.replace(/[%"<>|\x00-\x1f]|^\.|[. ]$/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)}.csv`;
export const tabOfFile = (file) => file.slice(0, -4).replace(/%([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

export function sheetKind(hub) {
  const { fault } = hub, START = { rows: 20, cols: 8 }, SIDE = "sheet.json";
  /** The tab's look that names a range by its corners' ids (`filter:<tabId>`, `table:<tabId>`, sheet-format.d.ts SheetRangedLook). */
  const RANGED = ["filter", "table"];
  const blank = (rows, cols) => Array.from({ length: rows }, () => new Array(cols).fill(""));
  const isFolder = (room) => room.entry.path.endsWith(FOLDER);
  /** Tabs are named wherever one is addressed once there are several (or the sheet is a workbook folder). */
  const many = (room) => isFolder(room) || room.book.tabs().length > 1;
  /** What the file holds: what was typed, and for a formula what it computes (only formulas are asked of the engine). */
  const texts = (sheet, grid = sheet.inputs()) => grid.map((row, r) => row.map((input, col) => input.startsWith("=") ? valueText(sheet.engine.getCellValue({ sheet: sheet.sheet, row: r, col })) : input));
  const clip = (grid, { top, left, bottom, right }) => grid.slice(top, bottom + 1).map((row) => row.slice(left, right + 1));
  const listed = (room) => room.book.tabs().map((tab) => `${tab.name} (${Object.values(room.book.tab(tab.id).size()).join("x")}${tab.hidden ? ", hidden" : ""})`).join(", ");
  /** The tab asked for (an id or a name; none: the first), by `tab` or by the tab an address names, which must be the same. */
  const pick = (room, tab, said) => {
    const want = said ?? (tab === undefined || tab === null || tab === "" ? undefined : String(tab));
    if (want === undefined) return room.book.first();
    const id = room.book.find(want) ?? (() => { throw fault(400, `No tab ${want}: the tabs are ${listed(room)}`); })();
    if (said !== undefined && tab !== undefined && tab !== null && tab !== "" && room.book.find(String(tab)) !== id) throw fault(400, `The address names the tab ${said} but tab is ${tab}: give one`);
    return room.book.tab(id);
  };
  const label = (room, sheet, range) => `${many(room) ? `${tabRef(sheet.name)}!` : ""}${rangeA1(range)}`;
  const sized = (room, sheet, rows, cols) => {
    if (cols > COL_LIMIT) throw fault(400, `A sheet has at most ${COL_LIMIT} columns (${colName(COL_LIMIT - 1)})`);
    if (rows * cols > SHEET_LIMIT) throw fault(400, `A tab holds at most ${SHEET_LIMIT} cells; that would make it ${rows} rows x ${cols} columns`);
    const now = sheet ? sheet.size() : { rows: 0, cols: 0 }, total = room.book.cellCount() - now.rows * now.cols + rows * cols;
    if (total > WORKBOOK_LIMIT) throw fault(400, `A workbook holds at most ${WORKBOOK_LIMIT} cells over its tabs; that would make it ${total}`);
  };
  /** The tab's merges where they are now. */
  const mergeAreas = (room, sheet) => { try { const list = JSON.parse(String(room.look.get(`merges:${sheet.id}`))); return Array.isArray(list) ? list.flatMap((one) => { const area = rangedArea(sheet, one); return area ? [area] : []; }) : []; } catch { return []; } };
  /** The merge a cell is hidden under (inside one, not its upper-left), if any. */
  const hiddenUnder = (areas, r, c) => areas.find((one) => r >= one.top && r <= one.bottom && c >= one.left && c <= one.right && (r !== one.top || c !== one.left));
  // A value an op writes under a merge's hidden cells would be kept unseen: it is left out (emptying one goes through). A file read again keeps all.
  const writeCells = (room, sheet, written, by, guarded = false) => hub.as(room, by, (sign) => room.doc.transact(() => {
    const areas = guarded ? mergeAreas(room, sheet) : [];
    for (const [r, c, input] of written) {
      if (input && areas.length && hiddenUnder(areas, r, c)) continue;
      const cell = key(sheet.rowAt(r), sheet.colAt(c));
      if (!input) room.cells.delete(cell); else if (room.cells.get(cell) !== input) room.cells.set(cell, input);
    }
    sign();
  }));
  /** A comment's range: its two corners by row and column ids, where both are still there, and the tab their rows are in. */
  const places = (under) => String(under?.cells ?? "").split(" ").filter(Boolean);
  const cornered = (room, under) => {
    const corners = places(under).slice(0, 2), tab = corners.length ? room.book.tabOfRow(corners[0].slice(0, corners[0].indexOf(":"))) : undefined;
    if (!tab) return null;
    const sheet = room.book.tab(tab), found = corners.map((corner) => { const cut = corner.indexOf(":"); return { row: sheet.indexOfRow(corner.slice(0, cut)), col: sheet.indexOfCol(corner.slice(cut + 1)) }; });
    if (found.some((one) => one.row < 0 || one.col < 0)) return null;
    const [a, b = a] = found;
    return { sheet, range: { top: Math.min(a.row, b.row), left: Math.min(a.col, b.col), bottom: Math.max(a.row, b.row), right: Math.max(a.col, b.col) } };
  };
  /** The tab grows to hold a range past its edge. */
  const grow = (room, sheet, { bottom, right }, by) => {
    const { rows, cols } = sheet.size();
    sized(room, sheet, Math.max(rows, bottom + 1), Math.max(cols, right + 1));
    if (bottom >= rows) hub.as(room, by, (sign) => sheet.structure("insert-rows", rows, bottom + 1 - rows, sign));
    if (right >= cols) hub.as(room, by, (sign) => sheet.structure("insert-cols", cols, right + 1 - cols, sign));
  };
  /**
   * Each cell of the range from `values` repeated over it; a formula is moved as a spreadsheet's fill moves it (its relative references follow the cell),
   * worked out in an engine of its own holding only the values, where they stand, beside empty tabs of the workbook's names (so `Data!A1` moves too).
   * `from`, the fill handle's source on the tab: `values` cover the range (its series worked out on the page), and each formula among them is the
   * source's own, moved from it, so a fill upward or leftward moves them as one downward does.
   */
  const scratch = (room, sheet) => {
    const engine = HyperFormula.buildFromSheets(Object.fromEntries(room.book.tabs().map((tab) => [room.book.tab(tab.id).engine.getSheetName(room.book.tab(tab.id).sheet), []])), CONFIG);
    return { engine, here: engine.getSheetId(sheet.engine.getSheetName(sheet.sheet)) };
  };
  const filled = (room, sheet, values, range, from) => {
    const height = values.length, width = Math.max(...values.map((row) => row.length)), at = (r, c) => values[r % height][c % width] ?? "";
    const moved = values.some((row) => row.some((value) => value.startsWith("="))) && (from || range.bottom - range.top + 1 > height || range.right - range.left + 1 > width)
      ? (() => {
        const { engine, here } = scratch(room, sheet), block = from ?? { top: range.top, left: range.left, bottom: range.top + height - 1, right: range.left + width - 1 };
        try {
          engine.setCellContents({ sheet: here, row: block.top, col: block.left }, from
            ? Array.from({ length: from.bottom - from.top + 1 }, (_, r) => Array.from({ length: from.right - from.left + 1 }, (_, c) => sheet.input(from.top + r, from.left + c) || null))
            : values.map((row) => Array.from({ length: width }, (_, c) => row[c] || null)));
          return engine.getFillRangeData({ start: { sheet: here, row: block.top, col: block.left }, end: { sheet: here, row: block.bottom, col: block.right } }, { start: { sheet: here, row: range.top, col: range.left }, end: { sheet: here, row: range.bottom, col: range.right } });
        } finally { engine.destroy(); }
      })() : null;
    const out = [];
    for (let r = 0; r <= range.bottom - range.top; r += 1) for (let c = 0; c <= range.right - range.left; c += 1) {
      const typed = at(r, c);
      out.push([range.top + r, range.left + c, typed.startsWith("=") && moved ? String(moved[r][c] ?? "") : typed]);
    }
    return out;
  };
  // As a spreadsheet sorts: numbers, then text (case aside), then TRUE and FALSE, then errors, each the other way round descending; blanks last either way.
  const rankOf = (sheet, row, col) => { const value = sheet.value(row, col); return value === null || value === "" ? [4, 0] : sheet.error(row, col) !== null ? [3, 0] : [typeof value === "number" ? 0 : typeof value === "string" ? 1 : 2, value]; };
  const sortedRows = (sheet, top, bottom, col, descending) => {
    const rows = Array.from({ length: bottom - top + 1 }, (_, n) => ({ row: top + n, rank: rankOf(sheet, top + n, col) })), sign = descending ? -1 : 1;
    return rows.sort(({ rank: [a, x] }, { rank: [b, y] }) => a === 4 || b === 4 ? a - b : sign * (a - b || (a === 1 ? String(x).localeCompare(String(y), undefined, { sensitivity: "base" }) : a === 0 || a === 2 ? Number(x) - Number(y) : 0))).map(({ row }) => row);
  };
  /**
   * Columns `left`..`right` of the rows from `top` in the order given (old positions), as a spreadsheet sorts: only those cells move, each with its
   * own look (`<what>:<rowId>:<colId>`: a style, a number format) and a formula moved as a fill moves it. Rows and their look stay. Only what changes
   * is written, so an edit elsewhere in the rows meanwhile is kept.
   */
  const reorder = (room, sheet, top, order, left, right) => {
    const typed = sheet.inputs(), cols = Array.from({ length: right - left + 1 }, (_, c) => left + c), rowOf = new Map(order.map((_, n) => [sheet.rowAt(top + n), top + n])), colOf = new Map(cols.map((c) => [sheet.colAt(c), c]));
    const worn = new Map(), cell = (row, col) => key(sheet.rowAt(row), sheet.colAt(col)), one = (row, col, here) => ({ start: { sheet: here, row, col }, end: { sheet: here, row, col } });
    for (const [name, value] of room.look.entries()) {
      const [what, row, col, more] = name.split(":"), at = `${rowOf.get(row)}:${colOf.get(col)}`;
      if (more === undefined && rowOf.has(row) && colOf.has(col)) (worn.get(at) ?? worn.set(at, new Map()).get(at)).set(what, value);
    }
    const { engine, here } = scratch(room, sheet);
    try {
      order.forEach((was, n) => {
        const to = top + n;
        if (was !== to) for (const c of cols) {
          const input = typed[was][c] ?? "", place = cell(to, c);
          if (input.startsWith("=")) engine.setCellContents({ sheet: here, row: was, col: c }, input);
          const moved = input.startsWith("=") ? String(engine.getFillRangeData(one(was, c, here), one(to, c, here))[0]?.[0] ?? input) : input;
          if (moved !== (typed[to][c] ?? "")) { if (moved) room.cells.set(place, moved); else room.cells.delete(place); }
          const want = worn.get(`${was}:${c}`) ?? new Map(), had = worn.get(`${to}:${c}`) ?? new Map();
          for (const [what, value] of want) if (had.get(what) !== value) room.look.set(`${what}:${place}`, value);
          for (const what of had.keys()) if (!want.has(what)) room.look.delete(`${what}:${place}`);
        }
      });
    } finally { engine.destroy(); }
  };
  /**
   * Before rows or columns move: each filter's, table's, conditional format's and chart's corners stay where they are, on the cells moved into them, as
   * they would come apart if they went with their lines (keepCorners is the delete's).
   */
  const keepPlaces = (room, sheet) => {
    const stay = (corner) => { const [row, col] = String(corner).split(":"), r = sheet.indexOfRow(row), c = sheet.indexOfCol(col); return () => r < 0 || c < 0 ? corner : key(sheet.rowAt(r), sheet.colAt(c)); };
    const after = [];
    for (const what of RANGED) {
      const name = `${what}:${sheet.id}`;
      let ranged;
      try { ranged = JSON.parse(String(room.look.get(name))); } catch { continue; }
      if (!ranged?.from || !ranged.to) continue;
      const from = stay(ranged.from), to = stay(ranged.to);
      after.push(() => { const next = { ...ranged, from: from(), to: to() }; if (next.from !== ranged.from || next.to !== ranged.to) room.look.set(name, JSON.stringify(next)); });
    }
    const rules = readRules(room.look.get(`rules:${sheet.id}`));
    if (rules.length) {
      const held = rules.map((rule) => ({ rule, ranges: rule.ranges.map(([from, to]) => [stay(from), stay(to)]) }));
      after.push(() => { const next = JSON.stringify(held.map(({ rule, ranges }) => ({ ...rule, ranges: ranges.map(([from, to]) => [from(), to()]) }))); if (next !== JSON.stringify(rules)) room.look.set(`rules:${sheet.id}`, next); });
    }
    // A chart too, its range and the cell it stands on: it draws the same cells' places and stands where it stood.
    const charts = readCharts(room.look.get(`charts:${sheet.id}`));
    if (charts.length) {
      const held = charts.map((chart) => ({ chart, from: stay(chart.from), to: stay(chart.to), at: stay(chart.at) }));
      after.push(() => { const next = JSON.stringify(held.map(({ chart, from, to, at }) => ({ ...chart, from: from(), to: to(), at: at() }))); if (next !== JSON.stringify(charts)) room.look.set(`charts:${sheet.id}`, next); });
    }
    return () => { for (const one of after) one(); };
  };
  /** The tab's filter applied again (its `hide`), written only where that changes. */
  const refilter = (room, sheet, by) => {
    const name = `filter:${sheet.id}`, text = room.look.get(name);
    let filter;
    try { filter = JSON.parse(String(text)); } catch { return; }
    const hide = filterHides(sheet, filter), next = JSON.stringify({ ...filter, hide: hide.length ? hide : undefined });
    if (next !== text) hub.as(room, by, (sign) => room.doc.transact(() => { room.look.set(name, next); sign(); }));
  };
  /**
   * Before rows or columns are deleted: each filter's and table's corner on one of them moves to the nearest one left inside its range, and one with
   * none left is taken off, so deleting its header or last row keeps it.
   */
  /**
   * Once lines are inserted: each cell between two of the same type (a dropdown, date or checkbox, or plain under a typed column) takes it, a date its
   * number format too, as Excel extends a validation over a line put inside it; at its edge it does not.
   */
  const extendTypes = (room, sheet, isRows, at, count) => () => {
    const { rows, cols } = sheet.size();
    if (at < 1 || at + count >= (isRows ? rows : cols)) return;
    const line = (n) => isRows ? sheet.rowAt(n) : sheet.colAt(n), cross = (m) => isRows ? sheet.colAt(m) : sheet.rowAt(m);
    const copy = (name) => {
      const kept = room.look.get(name(at - 1));
      if (kept === undefined || kept !== room.look.get(name(at + count))) return undefined;
      for (let n = at; n < at + count; n++) room.look.set(name(n), kept);
      return kept;
    };
    const extend = (name) => { if (copy((n) => `type:${name(n)}`) === "date") copy((n) => `fmt:${name(n)}`); };
    if (!isRows) extend(line);
    for (let m = 0, across = isRows ? cols : rows; m < across; m++) extend((n) => isRows ? key(line(n), cross(m)) : key(cross(m), line(n)));
  };
  const keepCorners = (room, sheet, isRows, at, count) => {
    const out = [], gone = (n) => n >= at && n < at + count;
    const id = (n) => isRows ? sheet.rowAt(n) : sheet.colAt(n), corner = (text, n) => { const [row, col] = String(text).split(":"); return isRows ? key(id(n), col) : key(row, id(n)); };
    const moved = (ranged) => {
      const area = rangedArea(sheet, ranged);
      if (!area) return null;
      let [lo, hi] = isRows ? [area.top, area.bottom] : [area.left, area.right];
      while (lo <= hi && gone(lo)) lo++;
      while (hi >= lo && gone(hi)) hi--;
      return lo > hi ? null : { ...ranged, from: corner(ranged.from, lo), to: corner(ranged.to, hi) };
    };
    for (const what of RANGED) {
      const name = `${what}:${sheet.id}`;
      let ranged;
      try { ranged = JSON.parse(String(room.look.get(name))); } catch { continue; }
      const next = moved(ranged);
      if (!next) out.push([name, null]); else if (next.from !== ranged.from || next.to !== ranged.to) out.push([name, JSON.stringify(next)]);
    }
    // A merge shrinks as a filter does; one left a single cell goes.
    let merges;
    try { merges = JSON.parse(String(room.look.get(`merges:${sheet.id}`))); } catch { merges = null; }
    if (Array.isArray(merges)) {
      const left = (area) => { const [lo, hi] = isRows ? [area.top, area.bottom] : [area.left, area.right]; let n = 0; for (let at = lo; at <= hi; at++) if (!gone(at)) n++; return n; };
      const next = merges.flatMap((one) => { const kept = moved(one), area = kept && rangedArea(sheet, kept); return area && (left(area) > 1 || (isRows ? area.right > area.left : area.bottom > area.top)) ? [kept] : []; });
      if (JSON.stringify(next) !== JSON.stringify(merges)) out.push([`merges:${sheet.id}`, next.length ? JSON.stringify(next) : null]);
    }
    // A conditional format's ranges each as a filter's; one left with none goes.
    const rules = readRules(room.look.get(`rules:${sheet.id}`));
    if (rules.length) {
      const next = rules.map((rule) => ({ ...rule, ranges: rule.ranges.flatMap(([from, to]) => { const one = moved({ from, to }); return one ? [[one.from, one.to]] : []; }) })).filter((rule) => rule.ranges.length);
      if (JSON.stringify(next) !== JSON.stringify(rules)) out.push([`rules:${sheet.id}`, next.length ? JSON.stringify(next) : null]);
    }
    const charts = keptCharts(sheet, room.look.get(`charts:${sheet.id}`), isRows, at, count);
    if (charts !== undefined) out.push([`charts:${sheet.id}`, charts]);
    return () => { for (const [name, value] of out) if (value === null) room.look.delete(name); else room.look.set(name, value); };
  };
  /**
   * The formulas an import froze (`excel:<rowId>:<colId>`, sheet-xlsx.js) that are on the tab or name it, rewritten by a change to the tab as the
   * engine rewrites a formula, in an engine of its own: OFFSET goes in under a name the engine does not know, so it parses. One that still does not
   * parse loses its formula, so an export writes its value alone. `op`: a row or column op (a move to `into`), or `rename` (to `at`).
   * Applied after the change, as `keepCorners`'s.
   */
  const keepFrozen = (room, sheet, op, at, count, into = at) => {
    const named = sheet.engine.getSheetName(sheet.sheet).toLowerCase(), quoted = named.replace(/'/g, "''"), held = [], { engine, here } = scratch(room, sheet), isRows = op.endsWith("rows"), removing = op.startsWith("delete"), moving = op.startsWith("move");
    try {
      for (const [name, value] of room.look.entries()) {
        const [what, row, col] = name.split(":"), tab = what === "excel" && typeof value?.formula === "string" ? room.book.tabOfRow(row) : undefined, on = tab && room.book.tab(tab);
        if (!on || on.indexOfCol(col) < 0 || (on.id !== sheet.id && ![named, quoted].some((name) => value.formula.toLowerCase().includes(name)))) continue;
        // Written for its `anchor`, where a sort may have left it: as it reads where it is now.
        const place = { sheet: engine.getSheetId(on.engine.getSheetName(on.sheet)), row: on.indexOfRow(row), col: on.indexOfCol(col) }, from = parseA1(String(value.anchor ?? "")) ?? place;
        engine.setCellContents(place, shiftRefs(value.formula, place.row - from.row, place.col - from.col).replace(/\bOFFSET\(/gi, "MOVEDREF("));
        const unread = engine.getCellValue(place)?.message?.startsWith("Parsing");
        held.push({ name, value, row, col, on, place: unread ? null : place });
      }
      if (!held.length) return () => {};
      // A name the tab cannot take is the tab op's to refuse.
      if (op === "rename") { try { engine.renameSheet(here, at); } catch { return () => {}; } }
      else if (moving) (isRows ? engine.moveRows : engine.moveColumns).call(engine, here, at, count, into < at ? into : into + count);
      else (isRows ? removing ? engine.removeRows : engine.addRows : removing ? engine.removeColumns : engine.addColumns).call(engine, here, [at, count]);
      const moved = (n) => moving ? (n >= at && n < at + count ? n - at + into : into > at && n >= at + count && n < into + count ? n - count : into < at && n >= into && n < at ? n + count : n)
        : removing ? (n >= at + count ? n - count : n >= at ? -1 : n) : n >= at ? n + count : n;
      const after = held.map(({ place, ...one }) => {
        const to = place && (place.sheet !== here || op === "rename" ? place : isRows ? { ...place, row: moved(place.row) } : { ...place, col: moved(place.col) });
        return { ...one, formula: to && to.row >= 0 && to.col >= 0 ? engine.getCellFormula(to)?.replace(/\bMOVEDREF\(/g, "OFFSET(") : undefined };
      });
      return () => { for (const { name, value, row, col, on, formula } of after) if (!formula || on.indexOfRow(row) < 0 || on.indexOfCol(col) < 0) room.look.delete(name); else room.look.set(name, { ...value, formula, anchor: a1(on.indexOfRow(row), on.indexOfCol(col)) }); };
    } finally { engine.destroy(); }
  };
  const text = (value) => value === null || value === undefined ? "" : typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value).toUpperCase() : (() => { throw fault(400, "A cell's value is text: what is typed in it (a number, TRUE or FALSE, or a formula starting with =)"); })();
  const index = (value, most, what) => {
    if (!Number.isInteger(value) || value < 0 || value > most) throw fault(400, `at is the 0-based index of the ${what}, from 0 to ${most}`);
    return value;
  };
  /** A tab's formulas by address, and its look by row number (a height), column letter, cell address, or alone for the tab's own. */
  const formulasOf = (sheet) => { const out = {}; sheet.inputs().forEach((row, r) => row.forEach((input, c) => { if (input.startsWith("=")) out[a1(r, c)] = input; })); return out; };
  /** A filter's or table's look by A1 (`{ range: "A1:D20", keep: { B: [...] } }`), from its JSON by ids (`from`/`to` corners, `keep` by column id); undefined where a corner is gone. */
  const rangedA1 = (sheet, text) => {
    try {
      const ranged = JSON.parse(String(text)), { keep, when, hide } = ranged, rest = Object.fromEntries(Object.entries(ranged).filter(([name]) => !["from", "to", "keep", "when", "hide"].includes(name))), area = rangedArea(sheet, ranged);
      if (!area) return undefined;
      const lettered = (by) => by && Object.fromEntries(Object.entries(by).flatMap(([col, values]) => sheet.indexOfCol(col) >= 0 ? [[colName(sheet.indexOfCol(col)), values]] : []));
      const kept = lettered(keep), whens = lettered(when);
      const hidden = Array.isArray(hide) ? hide.map((id) => sheet.indexOfRow(id) + 1).filter(Boolean) : [];
      return { ...rest, range: rangeA1(area), ...(kept ? { keep: kept } : {}), ...(whens ? { when: whens } : {}), ...(hidden.length ? { hide: hidden } : {}) };
    } catch { return undefined; }
  };
  /** A tab's merged ranges (`merges:<tabId>`, a list of corners by ids) by A1, those whose corners are gone left out. */
  const mergesA1 = (sheet, text) => { try { const list = JSON.parse(String(text)); return Array.isArray(list) ? list.flatMap((one) => { const area = rangedArea(sheet, one); return area ? [rangeA1(area)] : []; }) : []; } catch { return []; } };
  const rangedIds = (sheet, value) => {
    const area = parseRange(String(value?.range ?? "")), { rows, cols } = sheet.size();
    if (!area || area.bottom >= rows || area.right >= cols) return undefined;
    const { keep, when, hide } = value, rest = Object.fromEntries(Object.entries(value).filter(([name]) => !["range", "keep", "when", "hide"].includes(name))), colOf = (letter) => /^[A-Z]{1,3}$/.test(letter) && colIndex(letter) < cols ? sheet.colAt(colIndex(letter)) : undefined;
    const kept = keep && typeof keep === "object" ? Object.fromEntries(Object.entries(keep).flatMap(([letter, values]) => colOf(letter) && Array.isArray(values) ? [[colOf(letter), values.map(String)]] : [])) : undefined;
    const whens = when && typeof when === "object" ? Object.fromEntries(Object.entries(when).flatMap(([letter, test]) => colOf(letter) && typeof test?.is === "string" ? [[colOf(letter), test]] : [])) : undefined;
    return JSON.stringify({ ...rest, from: key(sheet.rowAt(area.top), sheet.colAt(area.left)), to: key(sheet.rowAt(area.bottom), sheet.colAt(area.right)), ...(kept ? { keep: kept } : {}), ...(whens ? { when: whens } : {}),
      ...(Array.isArray(hide) ? { hide: hide.flatMap((row) => Number.isInteger(row) && row >= 1 && row <= rows ? [sheet.rowAt(row - 1)] : []) } : {}) });
  };
  const lookOf = (room, sheet) => {
    const out = {};
    for (const [name, value] of room.look.entries()) {
      const [what, ...ids] = name.split(":");
      // Validations are written by A1 below, from the cells that hold them.
      if (what === "validations" || (what === "type" && String(value).startsWith(VALID))) continue;
      if (ids.length === 1 && ids[0] === sheet.id && what === "merges") { const said = mergesA1(sheet, value); if (said.length) out.merges = said; }
      else if (ids.length === 1 && ids[0] === sheet.id && what === "rules") { const said = rulesA1(sheet, value); if (said.length) out.rules = said; else if (Array.isArray(value)) out.rules = value; }
      else if (ids.length === 1 && ids[0] === sheet.id && what === "charts") { const said = chartsA1(sheet, value); if (said.length) out.charts = said; }
      else if (ids.length === 1 && ids[0] === sheet.id && RANGED.includes(what)) { const said = rangedA1(sheet, value); if (said) out[what] = said; }
      else if (ids.length === 1 && ids[0] === sheet.id) out[what] = value;
      else if (ids.length === 1 && sheet.indexOfRow(ids[0]) >= 0) out[`${what}:${sheet.indexOfRow(ids[0]) + 1}`] = value;
      else if (ids.length === 1 && sheet.indexOfCol(ids[0]) >= 0) out[`${what}:${colName(sheet.indexOfCol(ids[0]))}`] = value;
      else if (ids.length === 2 && sheet.indexOfRow(ids[0]) >= 0 && sheet.indexOfCol(ids[1]) >= 0) out[`${what}:${a1(sheet.indexOfRow(ids[0]), sheet.indexOfCol(ids[1]))}`] = value;
    }
    const validations = validationsA1(room.look, sheet);
    if (validations.length) out.validations = validations;
    return out;
  };
  const restoreLook = (room, sheet, tab, kept) => {
    for (const [name, value] of Object.entries(kept ?? {})) {
      const [what, at, more] = name.split(":"), col = /^[A-Z]{1,3}$/.test(at ?? "") ? colIndex(at) : -1, row = /^\d+$/.test(at ?? "") ? Number(at) - 1 : -1, cell = at ? parseA1(at) : null, { rows, cols } = sheet.size();
      if (!what || more !== undefined) continue;
      // A merge overlapping one before it is left out: a workbook holding both is one a spreadsheet repairs.
      if (at === undefined && what === "merges") {
        const areas = [], ids = Array.isArray(value) ? value.flatMap((range) => {
          const one = rangedIds(sheet, { range }), area = one && parseRange(String(range));
          if (!area || areas.some((was) => was.top <= area.bottom && area.top <= was.bottom && was.left <= area.right && area.left <= was.right)) return [];
          areas.push(area); return [JSON.parse(one)];
        }) : [];
        if (ids.length) room.look.set(`merges:${tab}`, JSON.stringify(ids));
      }
      else if (at === undefined && what === "validations") restoreValidations(room.look, sheet, value);
      else if (at === undefined && what === "rules") { const ids = rulesIds(sheet, value); if (ids) room.look.set(`rules:${tab}`, ids); }
      else if (at === undefined && what === "charts") { const ids = chartIds(sheet, value); if (ids) room.look.set(`charts:${tab}`, ids); }
      else if (at === undefined && RANGED.includes(what)) { const ids = rangedIds(sheet, value); if (ids) room.look.set(`${what}:${tab}`, ids); }
      else if (at === undefined) room.look.set(`${what}:${tab}`, value);
      else if (row >= 0 && row < rows) room.look.set(`${what}:${sheet.rowAt(row)}`, value);
      else if (col >= 0 && col < cols) room.look.set(`${what}:${sheet.colAt(col)}`, value);
      else if (cell && cell.row < rows && cell.col < cols) room.look.set(`${what}:${key(sheet.rowAt(cell.row), sheet.colAt(cell.col))}`, value);
    }
  };
  const grid = (text) => { const file = fromCsv(text); return { file, height: Math.max(1, file.length), width: Math.max(1, ...file.map((row) => row.length)), at: (r, c) => file[r]?.[c] ?? "" }; };
  /**
   * The live copy made from the files, the first time (no live copy yet): each tab's cells are its file's, with the formulas sheet.json keeps where they
   * still compute what the file says. A folder's tabs are sheet.json's in its order, then each other tab file, last.
   */
  const start = async (room, files, folder) => {
    const kept = await fs.readFile(path.join(room.entry.side, SIDE), "utf8").then(JSON.parse).catch(() => null);
    const keptTabs = kept?.format === 2 && Array.isArray(kept.tabs) ? kept.tabs : [{ id: MAIN, inputs: kept?.inputs, look: kept?.look }];
    let plan;
    if (!folder) plan = [{ ...keptTabs[0], id: MAIN, text: files[""] }];
    else {
      const seen = new Set(), ids = new Set();
      plan = keptTabs.flatMap((tab) => { const file = typeof tab.name === "string" ? tabFile(tab.name) : null; if (!file || !(file in files) || seen.has(file) || typeof tab.id !== "string" || ids.has(tab.id)) return []; seen.add(file); ids.add(tab.id); return [{ ...tab, text: files[file] }]; });
      for (const file of Object.keys(files).filter((file) => !seen.has(file)).sort()) {
        let name = tabName(tabOfFile(file)), n = 2;
        while (plan.some((tab) => tab.name.toLowerCase() === name.toLowerCase())) name = `${tabName(tabOfFile(file)).slice(0, 27)} ${n++}`;
        plan.push({ id: plan.length || ids.has(MAIN) ? rowId() : MAIN, name, text: files[file] });
      }
      if (!plan.length) plan = [{ id: MAIN, name: tabName(room.entry.name), text: "" }];
    }
    const read = plan.map((tab) => ({ ...tab, ...grid(tab.text) }));
    for (const tab of read) if (tab.width > COL_LIMIT || tab.height * tab.width > SHEET_LIMIT) throw fault(422, `${room.entry.name}${folder ? `'s tab ${tab.name}` : ".csv"} is too large for a sheet (${tab.height} rows x ${tab.width} columns; at most ${SHEET_LIMIT} cells a tab)`);
    const total = read.reduce((sum, tab) => sum + tab.height * tab.width, 0);
    if (total > WORKBOOK_LIMIT) throw fault(422, `${room.entry.name} is too large for a sheet (${total} cells over its tabs; at most ${WORKBOOK_LIMIT})`);
    room.doc.transact(() => {
      if (folder) {
        room.doc.getArray(TABS).insert(0, read.map((tab) => tab.id));
        for (const tab of read) { room.doc.getMap(TAB).set(`name:${tab.id}`, tab.name); if (tab.hidden === true) room.doc.getMap(TAB).set(`hidden:${tab.id}`, true); }
      }
      for (const tab of read) {
        room.doc.getArray(rowsOf(tab.id)).insert(0, Array.from({ length: tab.height }, rowId));
        room.doc.getArray(colsOf(tab.id)).insert(0, Array.from({ length: tab.width }, colId));
      }
    });
    for (const tab of read) {
      const sheet = room.book.tab(tab.id), ids = (r, c) => key(sheet.rowAt(r), sheet.colAt(c)), formulas = [];
      room.doc.transact(() => {
        for (let r = 0; r < tab.height; r += 1) for (let c = 0; c < tab.width; c += 1) if (tab.at(r, c)) room.cells.set(ids(r, c), tab.at(r, c));
        for (const [address, input] of Object.entries(tab.inputs ?? {})) {
          const place = parseA1(address);
          if (place && place.row < tab.height && place.col < tab.width && typeof input === "string" && input.startsWith("=")) { room.cells.set(ids(place.row, place.col), input); formulas.push(place); }
        }
        restoreLook(room, sheet, tab.id, tab.look);
      });
      tab.check = () => formulas.filter(({ row, col }) => valueText(sheet.value(row, col)) !== tab.at(row, col));
      tab.sheet = sheet;
    }
    // Checked once every tab is in: a formula may read another tab.
    for (const tab of read) {
      const stale = tab.check(), ids = (r, c) => key(tab.sheet.rowAt(r), tab.sheet.colAt(c));
      if (stale.length) room.doc.transact(() => { for (const { row, col } of stale) if (tab.at(row, col)) room.cells.set(ids(row, col), tab.at(row, col)); else room.cells.delete(ids(row, col)); });
    }
  };
  /**
   * A tab's file read again, cell by cell: one whose text in the file is what the hub would write keeps what was typed in it (its formula), any other
   * is the file's text; rows and columns added or taken away at the end grow or shrink the tab.
   */
  const retake = (room, sheet, text) => {
    const { height, width, at } = grid(text);
    if (width > COL_LIMIT || height * width > SHEET_LIMIT) throw fault(422, `${room.entry.name}${isFolder(room) ? `'s tab ${sheet.name}` : ".csv"} is too large for a sheet (${height} rows x ${width} columns; at most ${SHEET_LIMIT} cells a tab)`);
    const before = texts(sheet), { rows, cols } = sheet.size();
    if (room.book.cellCount() - rows * cols + height * width > WORKBOOK_LIMIT) throw fault(422, `${room.entry.name} would be too large for a sheet (at most ${WORKBOOK_LIMIT} cells over its tabs)`);
    if (height > rows) sheet.structure("insert-rows", rows, height - rows); else if (height < rows) sheet.structure("delete-rows", height, rows - height);
    if (width > cols) sheet.structure("insert-cols", cols, width - cols); else if (width < cols) sheet.structure("delete-cols", width, cols - width);
    const changed = [];
    for (let r = 0; r < height; r += 1) for (let c = 0; c < width; c += 1) if (before[r]?.[c] !== at(r, c) && sheet.input(r, c) !== at(r, c)) changed.push([r, c, at(r, c)]);
    if (changed.length) writeCells(room, sheet, changed);
  };
  /**
   * A workbook folder read again: each tab's file as `retake` reads it. A file no tab has is a tab renamed outside where a tab's file has gone and this
   * one holds what it held, else a new last tab; a tab whose file has gone alone is written back.
   */
  const retakeAll = (room, files) => {
    const { book } = room, before = (() => { try { return JSON.parse(room.text ?? "{}"); } catch { return {}; } })();
    const byFile = new Map(book.tabs().map((tab) => [tabFile(tab.name), tab])), missing = book.tabs().filter((tab) => !(tabFile(tab.name) in files));
    for (const [file, csv] of Object.entries(files)) {
      const tab = byFile.get(file);
      if (tab) { retake(room, book.tab(tab.id), csv); continue; }
      const moved = missing.find((one) => before[tabFile(one.name)] === csv);
      let name = tabName(tabOfFile(file)), n = 2;
      while (book.find(name) && book.find(name) !== moved?.id) name = `${tabName(tabOfFile(file)).slice(0, 27)} ${n++}`;
      if (moved) { missing.splice(missing.indexOf(moved), 1); book.tabOp("rename", { tab: moved.id, name }); continue; }
      sized(room, null, 1, 1);
      retake(room, book.tab(book.tabOp("add", { name, rows: 1, cols: 1 }).tab), csv);
    }
  };
  // Data tools: shifting cells (Excel's Delete and Insert of a block).
  /**
   * A block's cells deleted with those below (`up`) or right of it (`left`) moving into their place, or room made for it by moving its cells and those
   * below (`down`) or right (`right`) away, as a spreadsheet's Delete and Insert of cells: only the lines the block spans move, each cell with its own
   * look, and each formula reading a moved cell, on any tab, follows it; one reading a deleted cell reads #REF!. Worked out in an engine of its own
   * holding the workbook's formulas: a deleted block is first moved past the tab's edge and its lines removed there, so what read it is #REF!. A
   * range only partly moved is left as it was (Excel's grows or shrinks).
   */
  const shiftCells = (room, sheet, area, way, by) => {
    const across = way === "left" || way === "right", removing = way === "up" || way === "left", { rows, cols } = sheet.size();
    const depth = across ? area.right - area.left + 1 : area.bottom - area.top + 1, lo = across ? area.left : area.top, typed = sheet.inputs();
    const merged = mergeAreas(room, sheet).find((one) => across ? one.bottom >= area.top && one.top <= area.bottom && one.right >= area.left : one.right >= area.left && one.left <= area.right && one.bottom >= area.top);
    if (merged) throw fault(400, `${rangeA1(merged)} is merged: unmerge it to shift these cells`);
    // Room made: the tab grows by the block's depth where its last lines hold anything the shift would push past them.
    let size = across ? cols : rows;
    const filledAt = (n) => { for (let m = across ? area.top : area.left; m <= (across ? area.bottom : area.right); m += 1) if (across ? typed[m]?.[n] : typed[n]?.[m]) return true; return false; };
    if (!removing && Array.from({ length: depth }, (_, n) => size - 1 - n).some((n) => n >= lo && filledAt(n))) {
      grow(room, sheet, across ? { bottom: rows - 1, right: cols - 1 + depth } : { bottom: rows - 1 + depth, right: cols - 1 }, by);
      size += depth;
    }
    const shift = removing ? -depth : depth, place = (line, other) => across ? { row: other, col: line } : { row: line, col: other };
    const others = Array.from({ length: (across ? area.bottom - area.top : area.right - area.left) + 1 }, (_, n) => (across ? area.top : area.left) + n);
    // Every line from the block's first to the tab's last, along the lines it spans: each takes what stood `shift` before it, else nothing.
    const from = (line) => { const was = line - shift; return was >= (removing ? lo + depth : lo) && was < size && (removing || was < size - depth) ? was : -1; };
    const { engine, here } = scratch(room, sheet), now = sheet.inputs();
    const formulas = [];
    for (const tab of room.book.tabs()) {
      const one = room.book.tab(tab.id), id = engine.getSheetId(one.engine.getSheetName(one.sheet));
      one.inputs().forEach((line, r) => line.forEach((input, c) => { if (input.startsWith("=")) { engine.setCellContents({ sheet: id, row: r, col: c }, input); formulas.push({ one, id, r, c, input, read: engine.getCellFormula({ sheet: id, row: r, col: c }) }); } }));
    }
    const out = [];
    try {
      const box = (a, b, c, d) => across ? { start: { sheet: here, row: c, col: a }, end: { sheet: here, row: d, col: b } } : { start: { sheet: here, row: a, col: c }, end: { sheet: here, row: b, col: d } };
      const [first, last] = [others[0], others.at(-1)];
      if (removing) {
        // Lines added where the block is parked first, so removing them leaves every range running past the tab's edge as it was.
        (across ? engine.addColumns : engine.addRows).call(engine, here, [size, depth]);
        engine.moveCells(box(lo, lo + depth - 1, first, last), across ? { sheet: here, row: first, col: size } : { sheet: here, row: size, col: first });
        (across ? engine.removeColumns : engine.removeRows).call(engine, here, [size, depth]);
        if (lo + depth < size) engine.moveCells(box(lo + depth, size - 1, first, last), across ? { sheet: here, row: first, col: lo } : { sheet: here, row: lo, col: first });
      } else if (lo < size - depth) engine.moveCells(box(lo, size - depth - 1, first, last), across ? { sheet: here, row: first, col: lo + depth } : { sheet: here, row: lo + depth, col: first });
      const zone = new Set();
      for (let line = lo; line < size; line += 1) for (const other of others) {
        const at = place(line, other), was = from(line), old = was < 0 ? "" : (across ? now[other]?.[was] : now[was]?.[other]) ?? "";
        zone.add(`${at.row}:${at.col}`);
        const next = old.startsWith("=") ? String(engine.getCellFormula({ sheet: here, ...at }) ?? old) : old;
        if (next !== (now[at.row]?.[at.col] ?? "")) out.push([sheet, at.row, at.col, next]);
      }
      // Compared with the engine's own reading before the shift, not with the text typed: the engine writes `=sum(a1)` as `=SUM(A1)`, and a formula
      // the shift did not move is left as it was typed.
      for (const { one, id, r, c, read } of formulas) {
        if (one.id === sheet.id && zone.has(`${r}:${c}`)) continue;
        const next = engine.getCellFormula({ sheet: id, row: r, col: c });
        if (next && next !== read) out.push([one, r, c, next]);
      }
    } finally { engine.destroy(); }
    // Each cell's look (`<what>:<rowId>:<colId>`: a style, a number format, a frozen formula) moves with it.
    const ids = (line, other) => { const at = place(line, other); return key(sheet.rowAt(at.row), sheet.colAt(at.col)); };
    const looks = new Map();
    for (const [name, value] of room.look.entries()) { const [what, row, col, more] = name.split(":"); if (more === undefined && col !== undefined) (looks.get(`${row}:${col}`) ?? looks.set(`${row}:${col}`, new Map()).get(`${row}:${col}`)).set(what, value); }
    hub.as(room, by, (sign) => room.doc.transact(() => {
      for (const [one, r, c, input] of out) { const cell = key(one.rowAt(r), one.colAt(c)); if (input) room.cells.set(cell, input); else room.cells.delete(cell); }
      for (let line = lo; line < size; line += 1) for (const other of others) {
        const was = from(line), want = was < 0 ? new Map() : looks.get(ids(was, other)) ?? new Map(), cell = ids(line, other), had = looks.get(cell) ?? new Map();
        for (const [what, value] of want) if (had.get(what) !== value) room.look.set(`${what}:${cell}`, value);
        for (const what of had.keys()) if (!want.has(what)) room.look.delete(`${what}:${cell}`);
      }
      sign();
    }));
    refilter(room, sheet, by);
  };
  /**
   * The rows of a range (under its header) that say again, case aside, what a row above them says in its columns, taken out: the range's cells below
   * move up into their place, each with its look, as the rows a sort moves (`reorder`), and its last rows are emptied.
   */
  const dedupe = (room, sheet, area, header, by) => {
    // Whole columns reach the tab's last row: the empty rows under the data are not repeats of each other.
    let bottom = area.bottom;
    while (bottom > area.top && Array.from({ length: area.right - area.left + 1 }, (_, c) => sheet.input(bottom, area.left + c)).every((input) => !input)) bottom -= 1;
    area = { ...area, bottom };
    const top = area.top + (header ? 1 : 0), seen = new Set(), kept = [], gone = [];
    for (let r = top; r <= area.bottom; r += 1) {
      const said = Array.from({ length: area.right - area.left + 1 }, (_, c) => valueText(sheet.value(r, area.left + c)).toLowerCase()).join("\u0000");
      if (seen.has(said)) gone.push(r); else { seen.add(said); kept.push(r); }
    }
    if (gone.length) hub.as(room, by, (sign) => room.doc.transact(() => {
      reorder(room, sheet, top, [...kept, ...gone], area.left, area.right);
      const tail = new Set(gone.map((_, n) => sheet.rowAt(top + kept.length + n))), cols = new Set(Array.from({ length: area.right - area.left + 1 }, (_, c) => sheet.colAt(area.left + c)));
      for (const row of tail) for (const col of cols) room.cells.delete(key(row, col));
      for (const name of [...room.look.keys()]) { const [, row, col, more] = name.split(":"); if (more === undefined && tail.has(row) && cols.has(col)) room.look.delete(name); }
      sign();
    }));
    refilter(room, sheet, by);
    return { removed: gone.length, left: kept.length };
  };
  /** A .csv becomes a workbook folder before its second tab is written, so a failed move leaves it as it was; its tab is named then, as is its file. */
  const intoFolder = async (room, by) => {
    if (isFolder(room)) return;
    const first = room.doc.getMap(TAB).get(`name:${MAIN}`) ?? tabName(room.entry.name);
    await hub.folder(room, tabFile(first));
    if (!room.doc.getMap(TAB).has(`name:${MAIN}`)) hub.as(room, by, (sign) => room.book.tabOp("rename", { tab: MAIN, name: first }, sign));
  };
  /** A copy of a tab next after it, named as Excel names one (`Data (2)`): its cells as typed (a formula reading its own tab reads the copy), and its look. */
  const duplicateTab = async (room, source, by) => {
    const base = source.name.replace(/ \(\d+\)$/, "").slice(0, 25), { rows, cols } = source.size();
    let n = 2, called = `${base} (${n})`;
    while (room.book.find(called)) called = `${base} (${++n})`;
    sized(room, null, rows, cols);
    await intoFolder(room, by);
    const at = room.book.tabs().findIndex((one) => one.id === source.id) + 1, kept = lookOf(room, source), typed = source.inputs();
    // A chart is found by its id on whichever tab holds it: the copy's charts are charts of their own.
    if (Array.isArray(kept.charts)) kept.charts = kept.charts.map((chart) => ({ ...chart, id: rowId() }));
    const done = hub.as(room, by, (sign) => room.book.tabOp("add", { name: called, at, rows, cols }, sign)), copy = room.book.tab(done.tab);
    hub.as(room, by, (sign) => room.doc.transact(() => {
      typed.forEach((line, r) => line.forEach((input, c) => { if (input) room.cells.set(key(copy.rowAt(r), copy.colAt(c)), input); }));
      restoreLook(room, copy, done.tab, kept);
      sign();
    }));
    return { tab: done.tab, tabs: tabsWithSize(room) };
  };
  const tabsWithSize = (room) => room.book.tabs().map((tab) => ({ ...tab, ...room.book.tab(tab.id).size() }));
  const TAB_OPS = { "add-tab": "add", "rename-tab": "rename", "delete-tab": "delete", "move-tab": "move", "hide-tab": "hide" };

  return {
    noun: "sheet", ext: ".csv", folder: FOLDER, adopts: "asked",
    made: () => toCsv(blank(START.rows, START.cols)),
    identify: () => ({ id: null }),
    places,
    where: (under, room) => { const found = room && cornered(room, under); return found ? { cells: label(room, found.sheet, found.range), ...(many(room) ? { tab: found.sheet.name } : {}) } : {}; },
    /** The range and `radius` cells around it as typed, each row under its number and each column under its letter, then what its formulas compute. */
    context(room, under, radius) {
      const found = cornered(room, under);
      if (!found) return undefined;
      const { sheet, range } = found, { rows, cols } = sheet.size(), near = { top: Math.max(0, range.top - radius), left: Math.max(0, range.left - radius), bottom: Math.min(rows - 1, range.bottom + radius), right: Math.min(cols - 1, range.right + radius) };
      const typed = clip(sheet.inputs(), near), shown = clip(texts(sheet), near), columns = Array.from({ length: near.right - near.left + 1 }, (_, c) => colName(near.left + c));
      const computed = typed.flatMap((row, r) => row.flatMap((input, c) => input.startsWith("=") ? [`${a1(near.top + r, near.left + c)} = ${shown[r][c]}`] : []));
      return [{ md: `The comment is on ${label(room, sheet, range)}${many(room) ? ` (the tab ${sheet.name})` : ""}. The cells around it, as typed:\n${toCsv([["", ...columns], ...typed.map((row, r) => [String(near.top + r + 1), ...row])]).trimEnd()}${computed.length ? `\nWhat the formulas compute: ${computed.join("; ")}` : ""}` }];
    },
    live: {
      format: SHEET_FORMAT,
      open: (doc, kind, entry) => ({ rows: doc.getArray(ROWS), cols: doc.getArray(COLS), cells: doc.getMap(CELLS), look: doc.getMap(LOOK), book: createWorkbookModel(doc, { name: entry?.name, owner: true }) }),
      empty: (room) => !room.book.cellCount(),
      close: (room) => room.book.destroy(),
      /** The file read (a folder's: its tab files, by name): the first time (no live copy yet) by `start`, after that by `retake`. */
      async take(room, text, owed) {
        const folder = isFolder(room), files = folder ? JSON.parse(text) : { "": text }, first = Object.values(files)[0] ?? "";
        room.eol = first.includes("\r\n") ? "\r\n" : "\n";
        const started = room.book.cellCount() > 0;
        if (owed && started) return;
        if (!started) return start(room, files, folder);
        if (folder) retakeAll(room, files); else retake(room, room.book.first(), text);
      },
      /** A folder's: its tab files' texts by name, sorted, as documents.js reads the folder. */
      write: (room) => isFolder(room)
        ? JSON.stringify(Object.fromEntries(room.book.tabs().map((tab) => [tabFile(tab.name), toCsv(texts(room.book.tab(tab.id)), room.eol ?? "\n")]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))
        : toCsv(texts(room.book.first()), room.eol ?? "\n"),
      /** sheet.json: the formulas by address and the look, so the files and it are the whole sheet without the live copy (format 2 for a workbook folder: each tab's, in order). */
      async saved(room) {
        const tabs = room.book.tabs().map((tab) => { const sheet = room.book.tab(tab.id); return { id: tab.id, name: tab.name, file: tabFile(tab.name), hidden: tab.hidden, inputs: formulasOf(sheet), look: lookOf(room, sheet) }; });
        const json = `${JSON.stringify(isFolder(room) ? { format: SHEET_FORMAT, tabs } : { format: 1, inputs: tabs[0].inputs, look: tabs[0].look })}\n`;
        if (json !== room.json) { await writePrivateFile(path.join(room.entry.side, SIDE), json); room.json = json; }
      },
      about: (room) => [
        isFolder(room) ? `It is the workbook folder ${room.entry.path} in its project's folder, a sheet with tabs (${listed(room)}), one CSV file each: change it through the cells actions, not by writing the files (the hub holds its live copy and its formulas; the files hold what they compute).`
          : `It is the CSV file ${room.entry.path} in its project's folder, a sheet: change it through the cells actions, not by writing the file (the hub holds its live copy and its formulas; the file holds what they compute).`,
        "A comment's `under.cells` names the two corners of the range it is on by row and column ids; its hand-off says that range by A1 address as it is now (with its tab where the sheet has several).",
        `If you have the tool \`conduit_artifact\`, its actions cells, set, fill, format, style, chart, rows, cols and tabs read and change the sheet (with \`for\`: the comment's <item>/<n>; \`tab\` or an address such as Data!B4 names a tab; format and style list or set a range's number formats and its bold, colours, fill, borders and alignment, which cells leaves out; chart lists, makes, changes or deletes a tab's charts, drawn from a range's cells), and answer replies and resolves; the CLI's \`document cells|set|fill|format|style|chart|rows|cols|tabs\` do the same.`,
      ],
    },
    cells: {
      /**
       * The sheet as text for an agent: a line saying what it is, then the CSV of what was typed in a tab (`tab`, or the tab `range` names; the first
       * unsaid). `as` "values": of what the file holds; "book": every tab for an export; "cells": JSON of each cell that has something, with the tab's id-keyed rows, columns and look,
       * and the tabs; "tabs": the tabs alone, each with its size. `range` reads only those cells.
       */
      async read(room, as, range, tab) {
        if (as === "tabs") return { tabs: tabsWithSize(room) };
        // For an export: every tab, what is typed in it, what that computes, and its look by letter and address.
        if (as === "book") return { tabs: room.book.tabs().map((tab) => { const sheet = room.book.tab(tab.id), typed = sheet.inputs(); return { name: tab.name, hidden: tab.hidden, typed, values: typed.map((row, r) => row.map((input, col) => sheet.engine.getCellValue({ sheet: sheet.sheet, row: r, col }))), look: lookOf(room, sheet) }; }) };
        const ref = parseRef(range ?? ""), sheet = pick(room, tab, ref.tab ?? undefined), { rows, cols } = sheet.size(), whole = { top: 0, left: 0, bottom: rows - 1, right: cols - 1 };
        const asked = ref.range === "" ? whole : parseRange(ref.range);
        if (!asked) throw fault(400, `range is an A1 range such as B2:C5 (or Data!B2:C5), not ${range}`);
        if (asked.top >= rows || asked.left >= cols) throw fault(400, `${rangeA1(asked)} is past the tab's edge: it is ${rows} rows x ${cols} columns (${rangeA1(whole)})`);
        const area = { ...asked, bottom: Math.min(asked.bottom, rows - 1), right: Math.min(asked.right, cols - 1) }, typed = sheet.inputs();
        if (as === "values") return toCsv(clip(texts(sheet, typed), area));
        if (as === "cells") {
          const found = [];
          for (let r = area.top; r <= area.bottom; r += 1) for (let c = area.left; c <= area.right; c += 1) if (typed[r][c]) found.push({ at: a1(r, c), input: typed[r][c], value: sheet.value(r, c) });
          const mine = new Set([...Array.from({ length: rows }, (_, r) => sheet.rowAt(r)), ...Array.from({ length: cols }, (_, c) => sheet.colAt(c)), sheet.id]);
          const look = Object.fromEntries([...room.look.entries()].filter(([name]) => name.split(":").slice(1).every((id) => mine.has(id))));
          return { format: "conduit-sheet", version: SHEET_FORMAT, id: room.id, tab: { id: sheet.id, name: sheet.name }, tabs: tabsWithSize(room), rows: Array.from({ length: rows }, (_, r) => sheet.rowAt(r)), cols: Array.from({ length: cols }, (_, c) => sheet.colAt(c)), cells: found, look };
        }
        if (as !== undefined && as !== "inputs") throw fault(400, "as is values, cells, tabs, or left out for what was typed");
        const part = area === whole || rangeA1(area) === rangeA1(whole) ? "" : `; this is ${rangeA1(area)}, its first line row ${area.top + 1} and its first field column ${colName(area.left)}`;
        const head = many(room) ? `# workbook ${room.entry.name}: tabs ${listed(room)}; this is ${sheet.name}, ${rows} rows x ${cols} columns; formulas are shown as typed; address cells as A1, another tab's as Data!A1 or 'My tab'!A1`
          : `# sheet ${room.entry.name}: ${rows} rows x ${cols} columns; formulas are shown as typed; address cells as A1`;
        return `${head}${part}\n${toCsv(clip(typed, area))}`;
      },
      /** One change of cells, of rows and columns, or of tabs (contract: POST /v0/document/:id/cells). `for` is checked, and nothing is kept of it yet. */
      async edit(room, { op, tab, at, range, from, values, value, format, style, borders, column, header, descending, count = 1, to, name: called, hidden, chart, way, by, for: about, type: cellType, options } = {}) {
        const name = typeof by === "string" && by ? by.slice(0, 80) : "agent";
        if (about !== undefined) {
          if (!/^[\w-]+\/\d+$/.test(String(about))) throw fault(400, `for is the comment answered, as <item>/<n>, not ${about}`);
          await room.markup.thread(String(about).split("/")[0]);
        }
        if (op === "duplicate-tab") return duplicateTab(room, pick(room, tab), name);
        if (Object.hasOwn(TAB_OPS, op)) {
          const tabArgs = { tab: tab === undefined ? undefined : String(tab), name: called, at, hidden: hidden !== false };
          if (op === "add-tab") {
            const fault400 = tabNameFault(called) ?? (room.book.find(called) ? `There is a tab named ${called} already` : null);
            if (fault400) throw fault(400, fault400);
            sized(room, null, START.rows, START.cols);
            // A .csv becomes a workbook folder before its second tab is written, so a failed move leaves it as it was. Its tab is named then (its file's
            // name, unless it was given one), as is the file it becomes.
            await intoFolder(room, name);
          }
          const changed = op === "rename-tab" && typeof called === "string" ? room.book.find(tabArgs.tab) : null;
          const frozen = changed ? keepFrozen(room, room.book.tab(changed), TAB_OPS[op], called?.trim()) : () => {};
          const done = hub.as(room, name, (sign) => room.book.tabOp(TAB_OPS[op], tabArgs, () => { frozen(); sign(); }));
          return { tab: done.tab, tabs: tabsWithSize(room) };
        }
        if (op === "set" || op === "fill") {
          const ref = parseRef(op === "set" ? at : range ?? at), sheet = pick(room, tab, ref.tab ?? undefined);
          let area = parseRange(ref.range);
          if (!area || (op === "set" && ref.range.includes(":"))) throw fault(400, op === "set" ? `at is one cell's A1 address, such as B4 (or Data!B4), not ${at}` : `range is an A1 range such as B2:C5 (or Data!B2:C5), not ${range}`);
          const grid = op === "set" || values === undefined ? [[text(value)]] : Array.isArray(values) && values.length && values.every((row) => Array.isArray(row) && row.length) ? values.map((row) => row.map(text)) : (() => { throw fault(400, "values is rows of cells' text, as [[\"a\", \"=A1*2\"], [\"b\", \"3\"]], or give value for every cell"); })();
          const height = grid.length, width = Math.max(...grid.map((row) => row.length));
          // A single cell takes the values' size, as a paste does.
          if (area.top === area.bottom && area.left === area.right) area = { ...area, bottom: area.top + height - 1, right: area.left + width - 1 };
          else if (height > area.bottom - area.top + 1 || width > area.right - area.left + 1) throw fault(400, `values is ${height} rows x ${width} columns, more than ${rangeA1(area)} holds: give a range that large, or its first cell alone`);
          const count = (area.bottom - area.top + 1) * (area.right - area.left + 1);
          if (count > CALL_LIMIT) throw fault(400, `That is ${count} cells; one call writes at most ${CALL_LIMIT}: split it`);
          const source = op === "fill" && from !== undefined ? parseRange(from) : undefined;
          if (source === null) throw fault(400, `from is the fill's source on its tab, an A1 range such as B2:C3, not ${from}`);
          const under = op === "set" && text(value) !== "" && hiddenUnder(mergeAreas(room, sheet), area.top, area.left);
          if (under) throw fault(400, `${a1(area.top, area.left)} is inside the merged ${rangeA1(under)}: its value is ${a1(under.top, under.left)}'s`);
          grow(room, sheet, area, name);
          // A date written into a date cell is its serial number, as the page writes one typed (types.ts `typed`).
          const dated = filled(room, sheet, grid, area, source).map(([r, c, input]) => {
            const type = room.look.get(`type:${key(sheet.rowAt(r), sheet.colAt(c))}`) ?? room.look.get(`type:${sheet.colAt(c)}`), day = type === "date" && input && !input.startsWith("=") ? readDate(input) : null;
            return day === null ? [r, c, input] : [r, c, String(day)];
          });
          writeCells(room, sheet, dated, name, true);
          return { cells: [label(room, sheet, area)], ...(many(room) ? { tab: sheet.name } : {}), ...sheet.size() };
        }
        // A range's number formats (sheet-formats.js) or styles (sheet-styles.js), set first when given; whole columns (B:D), or for styles rows (3:5), set theirs.
        if (op === "format" || op === "style") {
          const ref = parseRef(range ?? at), sheet = pick(room, tab, ref.tab ?? undefined), { rows, cols } = sheet.size();
          const columns = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(ref.range), lines = op === "style" ? /^\$?(\d+):\$?(\d+)$/.exec(ref.range) : null;
          const area = columns ? { top: 0, bottom: rows - 1, left: Math.min(colIndex(columns[1]), colIndex(columns[2])), right: Math.max(colIndex(columns[1]), colIndex(columns[2])) }
            : lines ? { top: Math.min(lines[1], lines[2]) - 1, bottom: Math.max(lines[1], lines[2]) - 1, left: 0, right: cols - 1 } : parseRange(ref.range);
          if (!area || area.top < 0) throw fault(400, `range is an A1 range such as B2:C5, or whole columns such as B:D${op === "style" ? " or rows such as 3:5" : ""} (Data!B:D for a tab), not ${range ?? at}`);
          if (area.top >= rows || area.left >= cols) throw fault(400, `${rangeA1(area)} is past the tab's edge: it is ${rows} rows x ${cols} columns`);
          const whole = columns ? "cols" : lines ? "rows" : null, set = op === "format" ? format !== undefined : style !== undefined || borders !== undefined;
          if (set) hub.as(room, name, (sign) => room.doc.transact(() => {
            try { if (op === "format") writeFormat(room.look, sheet, area, format, Boolean(whole)); else writeStyle(room.look, sheet, area, { style, borders }, whole); } catch (error) { throw fault(400, error.message); }
            sign();
          }));
          return { cells: [label(room, sheet, area)], ...(op === "format" ? { formats: listFormats(room.look, sheet, area) } : { styles: listStyles(room.look, sheet, area) }), ...(many(room) ? { tab: sheet.name } : {}) };
        }
        // A range's cell type (sheet-types.js): a checkbox, a date, a dropdown of `options` (a list validation) or plain; whole columns (B:D) take theirs.
        if (op === "type") {
          const ref = parseRef(range ?? at), sheet = pick(room, tab, ref.tab ?? undefined), { rows, cols } = sheet.size(), columns = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(ref.range);
          const area = columns ? { top: 0, bottom: rows - 1, left: Math.min(colIndex(columns[1]), colIndex(columns[2])), right: Math.max(colIndex(columns[1]), colIndex(columns[2])) } : parseRange(ref.range);
          if (!area) throw fault(400, `range is an A1 range such as B2:C5, or whole columns such as B:D (Data!B:D for a tab), not ${range ?? at}`);
          if (area.top >= rows || area.left >= cols) throw fault(400, `${rangeA1(area)} is past the tab's edge: it is ${rows} rows x ${cols} columns`);
          const kinds = { checkbox: "boolean", date: "date", dropdown: "list", plain: null };
          if (!Object.hasOwn(kinds, cellType)) throw fault(400, "type is checkbox, date, dropdown or plain");
          if (cellType === "dropdown" && !cleanOptions(options).length) throw fault(400, "options is a dropdown's values, as [\"Done\", { \"value\": \"Late\", \"ink\": \"red\" }] (inks: red, amber, green, blue)");
          hub.as(room, name, (sign) => room.doc.transact(() => {
            try { writeType(room.look, sheet, area, kinds[cellType], Boolean(columns), options); } catch (error) { throw fault(400, error.message); }
            // A date is a serial number in a date format: dates the cells hold as text are read into serials, and one without a date format takes d/m/yyyy.
            if (cellType === "date") {
              const format = room.look.get(`fmt:${key(sheet.rowAt(area.top), sheet.colAt(area.left))}`) ?? room.look.get(`fmt:${sheet.colAt(area.left)}`);
              if (typeof format !== "string" || !isDateFormat(format)) writeFormat(room.look, sheet, area, "d/m/yyyy", Boolean(columns));
              for (let r = area.top; r <= Math.min(area.bottom, rows - 1); r++) for (let c = area.left; c <= Math.min(area.right, cols - 1); c++) { const at = key(sheet.rowAt(r), sheet.colAt(c)), input = room.cells.get(at), day = input && !input.startsWith("=") ? readDate(input) : null; if (day !== null) room.cells.set(at, String(day)); }
            }
            sign();
          }));
          return { cells: [label(room, sheet, area)], ...(many(room) ? { tab: sheet.name } : {}) };
        }
        if (op === "sort") {
          const ref = parseRef(range ?? at), sheet = pick(room, tab, ref.tab ?? undefined), area = parseRange(ref.range), { rows, cols } = sheet.size();
          if (!area) throw fault(400, `range is an A1 range such as A1:D20 (or Data!A1:D20), not ${range ?? at}`);
          const col = typeof column === "string" && /^[A-Za-z]{1,3}$/.test(column) ? colIndex(column) : -1, top = area.top + (header === true ? 1 : 0), bottom = Math.min(area.bottom, rows - 1);
          if (col < area.left || col > area.right) throw fault(400, `column is the letter of a column of ${rangeA1(area)} to sort by, not ${column}`);
          // As a spreadsheet's: a sort would pull a merge's rows apart, so one in the way stops it.
          let merged = [];
          try { merged = JSON.parse(String(room.look.get(`merges:${sheet.id}`))); } catch {}
          const across = Array.isArray(merged) ? merged.map((one) => rangedArea(sheet, one)).find((one) => one && one.bottom >= top && one.top <= bottom && one.right >= area.left && one.left <= area.right) : undefined;
          if (across) throw fault(400, `${rangeA1(across)} is merged: unmerge it to sort ${rangeA1(area)}`);
          if (top < bottom) hub.as(room, name, (sign) => room.doc.transact(() => { reorder(room, sheet, top, sortedRows(sheet, top, bottom, col, descending === true), area.left, Math.min(area.right, cols - 1)); sign(); }));
          refilter(room, sheet, name);
          return { cells: [label(room, sheet, area)], ...(many(room) ? { tab: sheet.name } : {}) };
        }
        // A tab's charts (sheet-charts.js): `chart` makes one, changes one (its `id`, the rest as it was where left out) or takes it off (`delete`); the
        // tab's charts by A1 are the answer, so with no chart they are listed. A chart named by id is found on whichever tab holds it.
        if (op === "chart") {
          const spec = chart ?? {};
          if (typeof spec !== "object" || Array.isArray(spec)) throw fault(400, "chart is { kind, range, title, labels, at, width, height }, with id to change one or delete: true to take it off");
          const ref = parseRef(String(spec.range ?? "")), holding = spec.id !== undefined && (tab === undefined || tab === "") && !ref.tab ? room.book.tabs().find((one) => readCharts(room.look.get(`charts:${one.id}`)).some((made) => made.id === String(spec.id))) : undefined;
          const sheet = holding ? room.book.tab(holding.id) : pick(room, tab, ref.tab ?? undefined), held = `charts:${sheet.id}`, all = readCharts(room.look.get(held));
          const was = spec.id === undefined ? undefined : all.find((one) => one.id === String(spec.id));
          if (spec.id !== undefined && !was) throw fault(400, `No chart ${spec.id}${many(room) ? ` on ${sheet.name}` : ""}: ${all.length ? `its charts are ${all.map((one) => one.id).join(", ")}` : "it has none"}`);
          const { id: _, delete: drop, ...asked } = spec, change = Object.keys(asked).length > 0;
          if (drop === true && !was) throw fault(400, "delete takes the id of the chart to take off");
          if (!was && change && all.length >= CHART_LIMIT) throw fault(400, `A tab holds at most ${CHART_LIMIT} charts: change one (its id) or delete one`);
          let made;
          if (drop !== true && change) {
            // A chart stands on a cell the tab has: the tab grows to hold where it is asked to stand, unsaid two columns right of its range, once the rest is checked.
            const given = { ...asked, ...(spec.range === undefined ? {} : { range: ref.range }) }, area = parseRange(ref.range), spot = spec.at !== undefined ? parseA1(String(spec.at)) : !was && area ? { row: area.top, col: area.right + 2 } : null;
            const check = (one, id) => { try { return chartFrom(sheet, one, was, id); } catch (error) { throw fault(400, error.message); } };
            if (spot) { check({ ...given, at: "A1" }, ""); grow(room, sheet, { bottom: spot.row, right: spot.col }, name); }
            made = check(spot ? { ...given, at: a1(spot.row, spot.col) } : given, rowId());
          }
          const next = drop === true ? all.filter((one) => one !== was) : made ? (was ? all.map((one) => one === was ? made : one) : [...all, made]) : all;
          if (next !== all) hub.as(room, name, (sign) => room.doc.transact(() => { if (next.length) room.look.set(held, JSON.stringify(next)); else room.look.delete(held); sign(); }));
          return { charts: chartsA1(sheet, room.look.get(held)), ...(made ? { chart: made.id } : {}), ...(many(room) ? { tab: sheet.name } : {}) };
        }
        // Whole rows or columns moved to start at `to`, their ids with them, so all held by ids (cells, their look, comments) goes with them and each
        // formula reading them, on any tab, follows them.
        if (op === "move-rows" || op === "move-cols") {
          const sheet = pick(room, tab), isRows = op === "move-rows", { rows, cols } = sheet.size(), size = isRows ? rows : cols, what = isRows ? "row" : "column";
          index(at, size - 1, `first ${what} to move (${size} ${what}s now)`);
          if (!Number.isInteger(count) || count < 1 || at + count > size) throw fault(400, `count is how many ${what}s to move, at most ${size - at} from ${at}`);
          if (!Number.isInteger(to) || to < 0 || to > size - count) throw fault(400, `to is where the first moved ${what} lands, from 0 to ${size - count}`);
          const lo = Math.min(at, to), hi = Math.max(at, to) + count - 1;
          const across = mergeAreas(room, sheet).find((one) => (isRows ? one.bottom >= lo && one.top <= hi : one.right >= lo && one.left <= hi));
          if (across) throw fault(400, `${rangeA1(across)} is merged: unmerge it to move these ${what}s`);
          if (to !== at) { const places = keepPlaces(room, sheet), frozen = keepFrozen(room, sheet, op, at, count, to); hub.as(room, name, (sign) => sheet.structure(op, at, count, () => { places(); frozen(); sign(); }, to)); }
          refilter(room, sheet, name);
          return { ...sheet.size(), ...(many(room) ? { tab: sheet.name } : {}) };
        }
        if (op === "shift-cells") {
          const ref = parseRef(range ?? at), sheet = pick(room, tab, ref.tab ?? undefined), area = parseRange(ref.range), { rows, cols } = sheet.size();
          if (!area) throw fault(400, `range is an A1 range such as B2:C5 (or Data!B2:C5), not ${range ?? at}`);
          if (!["up", "left", "down", "right"].includes(way)) throw fault(400, "way is up or left (the cells deleted) or down or right (cells inserted)");
          if (area.top >= rows || area.left >= cols) throw fault(400, `${rangeA1(area)} is past the tab's edge: it is ${rows} rows x ${cols} columns`);
          shiftCells(room, sheet, { ...area, bottom: Math.min(area.bottom, rows - 1), right: Math.min(area.right, cols - 1) }, way, name);
          return { cells: [label(room, sheet, area)], ...sheet.size(), ...(many(room) ? { tab: sheet.name } : {}) };
        }
        if (op === "dedupe") {
          const ref = parseRef(range ?? at), sheet = pick(room, tab, ref.tab ?? undefined), area = parseRange(ref.range), { rows, cols } = sheet.size();
          if (!area) throw fault(400, `range is an A1 range such as A1:D20 (or Data!A1:D20), not ${range ?? at}`);
          if (area.top >= rows || area.left >= cols) throw fault(400, `${rangeA1(area)} is past the tab's edge: it is ${rows} rows x ${cols} columns`);
          const across = mergeAreas(room, sheet).find((one) => one.bottom >= area.top && one.top <= area.bottom && one.right >= area.left && one.left <= area.right);
          if (across) throw fault(400, `${rangeA1(across)} is merged: unmerge it to remove duplicates from ${rangeA1(area)}`);
          return { ...dedupe(room, sheet, { ...area, bottom: Math.min(area.bottom, rows - 1), right: Math.min(area.right, cols - 1) }, header === true, name), ...(many(room) ? { tab: sheet.name } : {}) };
        }
        if (!["insert-rows", "insert-cols", "delete-rows", "delete-cols"].includes(op)) throw fault(400, "op is set, fill, format, style, type, sort, chart, insert-rows, insert-cols, delete-rows, delete-cols, move-rows, move-cols, shift-cells, dedupe, add-tab, duplicate-tab, rename-tab, delete-tab, move-tab or hide-tab");
        const sheet = pick(room, tab), { rows, cols } = sheet.size(), isRows = op.endsWith("rows"), size = isRows ? rows : cols, what = isRows ? "row" : "column", removing = op.startsWith("delete");
        if (!Number.isInteger(count) || count < 1 || count > CALL_LIMIT) throw fault(400, "count is how many, 1 or more");
        index(at, removing ? size - 1 : size, `${what} to ${removing ? "delete" : "insert before"} (${size} ${what}s now)`);
        if (removing && at + count > size) throw fault(400, `There are ${size - at} ${what}s from ${at}: count is at most that`);
        if (removing && count >= size) throw fault(400, `A tab keeps at least one ${what}`);
        if (!removing) sized(room, sheet, isRows ? rows + count : rows, isRows ? cols : cols + count);
        const corners = removing ? keepCorners(room, sheet, isRows, at, count) : extendTypes(room, sheet, isRows, at, count), frozen = keepFrozen(room, sheet, op, at, count);
        return { ...hub.as(room, name, (sign) => sheet.structure(op, at, count, () => { corners(); frozen(); sign(); })), ...(many(room) ? { tab: sheet.name } : {}) };
      },
    },
  };
}
