import fs from "node:fs/promises";
import path from "node:path";
import { HyperFormula } from "hyperformula";
import { CALL_LIMIT, CELLS, COLS, COL_LIMIT, CONFIG, LOOK, MAIN, ROWS, SHEET_FORMAT, SHEET_LIMIT, TAB, TABS, WORKBOOK_LIMIT, a1, colId, colIndex, colName, colsOf, createWorkbookModel, fromCsv, key, parseA1, parseRange, parseRef, rangeA1, rowId, rowsOf, tabName, tabNameFault, tabRef, toCsv, valueText } from "../sheet-format.js";
import { writePrivateFile } from "../private-file.js";

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
  const writeCells = (room, sheet, written, by) => hub.as(room, by, (sign) => room.doc.transact(() => {
    for (const [r, c, input] of written) {
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
   */
  const filled = (room, sheet, values, range) => {
    const height = values.length, width = Math.max(...values.map((row) => row.length)), at = (r, c) => values[r % height][c % width] ?? "";
    const moved = values.some((row) => row.some((value) => value.startsWith("="))) && (range.bottom - range.top + 1 > height || range.right - range.left + 1 > width)
      ? (() => {
        const engine = HyperFormula.buildFromSheets(Object.fromEntries(room.book.tabs().map((tab) => [room.book.tab(tab.id).engine.getSheetName(room.book.tab(tab.id).sheet), []])), CONFIG), here = engine.getSheetId(sheet.engine.getSheetName(sheet.sheet));
        try {
          engine.setCellContents({ sheet: here, row: range.top, col: range.left }, values.map((row) => Array.from({ length: width }, (_, c) => row[c] || null)));
          return engine.getFillRangeData({ start: { sheet: here, row: range.top, col: range.left }, end: { sheet: here, row: range.top + height - 1, col: range.left + width - 1 } }, { start: { sheet: here, row: range.top, col: range.left }, end: { sheet: here, row: range.bottom, col: range.right } });
        } finally { engine.destroy(); }
      })() : null;
    const out = [];
    for (let r = 0; r <= range.bottom - range.top; r += 1) for (let c = 0; c <= range.right - range.left; c += 1) {
      const typed = at(r, c);
      out.push([range.top + r, range.left + c, typed.startsWith("=") && moved ? String(moved[r][c] ?? "") : typed]);
    }
    return out;
  };
  const text = (value) => value === null || value === undefined ? "" : typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value).toUpperCase() : (() => { throw fault(400, "A cell's value is text: what is typed in it (a number, TRUE or FALSE, or a formula starting with =)"); })();
  const index = (value, most, what) => {
    if (!Number.isInteger(value) || value < 0 || value > most) throw fault(400, `at is the 0-based index of the ${what}, from 0 to ${most}`);
    return value;
  };
  /** A tab's formulas by address, and its look by column letter, cell address, or alone for the tab's own. */
  const formulasOf = (sheet) => { const out = {}; sheet.inputs().forEach((row, r) => row.forEach((input, c) => { if (input.startsWith("=")) out[a1(r, c)] = input; })); return out; };
  const lookOf = (room, sheet) => {
    const out = {};
    for (const [name, value] of room.look.entries()) {
      const [what, ...ids] = name.split(":");
      if (ids.length === 1 && ids[0] === sheet.id) out[what] = value;
      else if (ids.length === 1 && sheet.indexOfCol(ids[0]) >= 0) out[`${what}:${colName(sheet.indexOfCol(ids[0]))}`] = value;
      else if (ids.length === 2 && sheet.indexOfRow(ids[0]) >= 0 && sheet.indexOfCol(ids[1]) >= 0) out[`${what}:${a1(sheet.indexOfRow(ids[0]), sheet.indexOfCol(ids[1]))}`] = value;
    }
    return out;
  };
  const restoreLook = (room, sheet, tab, kept) => {
    for (const [name, value] of Object.entries(kept ?? {})) {
      const [what, at, more] = name.split(":"), col = /^[A-Z]{1,3}$/.test(at ?? "") ? colIndex(at) : -1, cell = at ? parseA1(at) : null, { rows, cols } = sheet.size();
      if (!what || more !== undefined) continue;
      if (at === undefined) room.look.set(`${what}:${tab}`, value);
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
      open: (doc, kind, entry) => ({ rows: doc.getArray(ROWS), cols: doc.getArray(COLS), cells: doc.getMap(CELLS), look: doc.getMap(LOOK), book: createWorkbookModel(doc, { name: entry?.name }) }),
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
        `If you have the tool \`conduit_artifact\`, its actions cells, set, fill, rows, cols and tabs read and change the sheet (with \`for\`: the comment's <item>/<n>; \`tab\` or an address such as Data!B4 names a tab), and answer replies and resolves; the CLI's \`document cells|set|fill|rows|cols|tabs\` do the same.`,
      ],
    },
    cells: {
      /**
       * The sheet as text for an agent: a line saying what it is, then the CSV of what was typed in a tab (`tab`, or the tab `range` names; the first
       * unsaid). `as` "values": of what the file holds; "cells": JSON of each cell that has something, with the tab's id-keyed rows, columns and look,
       * and the tabs; "tabs": the tabs alone, each with its size. `range` reads only those cells.
       */
      async read(room, as, range, tab) {
        if (as === "tabs") return { tabs: tabsWithSize(room) };
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
      async edit(room, { op, tab, at, range, values, value, count = 1, name: called, hidden, by, for: about } = {}) {
        const name = typeof by === "string" && by ? by.slice(0, 80) : "agent";
        if (about !== undefined) {
          if (!/^[\w-]+\/\d+$/.test(String(about))) throw fault(400, `for is the comment answered, as <item>/<n>, not ${about}`);
          await room.markup.thread(String(about).split("/")[0]);
        }
        if (Object.hasOwn(TAB_OPS, op)) {
          const tabArgs = { tab: tab === undefined ? undefined : String(tab), name: called, at, hidden: hidden !== false };
          if (op === "add-tab") {
            const fault400 = tabNameFault(called) ?? (room.book.find(called) ? `There is a tab named ${called} already` : null);
            if (fault400) throw fault(400, fault400);
            sized(room, null, START.rows, START.cols);
            // A .csv becomes a workbook folder before its second tab is written, so a failed move leaves it as it was. Its tab is named then (its file's
            // name, unless it was given one), as is the file it becomes.
            if (!isFolder(room)) {
              const first = room.doc.getMap(TAB).get(`name:${MAIN}`) ?? tabName(room.entry.name);
              await hub.folder(room, tabFile(first));
              if (!room.doc.getMap(TAB).has(`name:${MAIN}`)) hub.as(room, name, (sign) => room.book.tabOp("rename", { tab: MAIN, name: first }, sign));
            }
          }
          const done = hub.as(room, name, (sign) => room.book.tabOp(TAB_OPS[op], tabArgs, sign));
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
          grow(room, sheet, area, name);
          writeCells(room, sheet, filled(room, sheet, grid, area), name);
          return { cells: [label(room, sheet, area)], ...(many(room) ? { tab: sheet.name } : {}), ...sheet.size() };
        }
        if (!["insert-rows", "insert-cols", "delete-rows", "delete-cols"].includes(op)) throw fault(400, "op is set, fill, insert-rows, insert-cols, delete-rows, delete-cols, add-tab, rename-tab, delete-tab, move-tab or hide-tab");
        const sheet = pick(room, tab), { rows, cols } = sheet.size(), isRows = op.endsWith("rows"), size = isRows ? rows : cols, what = isRows ? "row" : "column", removing = op.startsWith("delete");
        if (!Number.isInteger(count) || count < 1 || count > CALL_LIMIT) throw fault(400, "count is how many, 1 or more");
        index(at, removing ? size - 1 : size, `${what} to ${removing ? "delete" : "insert before"} (${size} ${what}s now)`);
        if (removing && at + count > size) throw fault(400, `There are ${size - at} ${what}s from ${at}: count is at most that`);
        if (removing && count >= size) throw fault(400, `A tab keeps at least one ${what}`);
        if (!removing) sized(room, sheet, isRows ? rows + count : rows, isRows ? cols : cols + count);
        return { ...hub.as(room, name, (sign) => sheet.structure(op, at, count, sign)), ...(many(room) ? { tab: sheet.name } : {}) };
      },
    },
  };
}
