import fs from "node:fs/promises";
import path from "node:path";
import { HyperFormula } from "hyperformula";
import { CALL_LIMIT, CELLS, COLS, COL_LIMIT, CONFIG, LOOK, ROWS, SHEET_FORMAT, SHEET_LIMIT, a1, colId, colIndex, colName, createSheetModel, fromCsv, key, parseA1, parseRange, rangeA1, rowId, toCsv, valueText } from "../sheet-format.js";
import { writePrivateFile } from "../private-file.js";

/*
 * The sheet artifact kind on the hub (sheet-format.js): a .csv that holds the values, the formulas beside it in sheet.json, and the live copy in
 * a Yjs doc that pages merge with. documents.js holds the room, its comments and its hand-offs; this is what differs for a sheet.
 * `hub.fault(status, message)`; `hub.as(room, by, change)`: runs `change(sign)` with the doc writing as the agent `by`, `sign()` recording
 * who that is, called inside the change.
 */
export function sheetKind(hub) {
  const { fault } = hub, START = { rows: 20, cols: 8 };
  const blank = (rows, cols) => Array.from({ length: rows }, () => new Array(cols).fill(""));
  /** What was typed in each cell, by position. */
  const inputs = (room) => room.model.inputs();
  /** What the file holds: what was typed, and for a formula what it computes (only formulas are asked of the engine). */
  const texts = (room, grid = inputs(room)) => {
    const { engine, sheet } = room.model;
    return grid.map((row, r) => row.map((input, col) => input.startsWith("=") ? valueText(engine.getCellValue({ sheet, row: r, col })) : input));
  };
  const clip = (grid, { top, left, bottom, right }) => grid.slice(top, bottom + 1).map((row) => row.slice(left, right + 1));
  const sized = (rows, cols) => {
    if (cols > COL_LIMIT) throw fault(400, `A sheet has at most ${COL_LIMIT} columns (${colName(COL_LIMIT - 1)})`);
    if (rows * cols > SHEET_LIMIT) throw fault(400, `A sheet holds at most ${SHEET_LIMIT} cells; that would make it ${rows} rows x ${cols} columns`);
  };
  const writeCells = (room, written, by) => hub.as(room, by, (sign) => room.doc.transact(() => {
    for (const [r, c, input] of written) {
      const cell = key(room.model.rowAt(r), room.model.colAt(c));
      if (!input) room.cells.delete(cell); else if (room.cells.get(cell) !== input) room.cells.set(cell, input);
    }
    sign();
  }));
  /** A comment's range: its two corners by row and column ids, where both are still there. */
  const places = (under) => String(under?.cells ?? "").split(" ").filter(Boolean);
  const cornered = (room, under) => {
    const found = places(under).slice(0, 2).map((corner) => { const cut = corner.indexOf(":"); return { row: room.model.indexOfRow(corner.slice(0, cut)), col: room.model.indexOfCol(corner.slice(cut + 1)) }; });
    if (!found.length || found.some((one) => one.row < 0 || one.col < 0)) return null;
    const [a, b = a] = found;
    return { top: Math.min(a.row, b.row), left: Math.min(a.col, b.col), bottom: Math.max(a.row, b.row), right: Math.max(a.col, b.col) };
  };
  /** The sheet grows to hold a range past its edge. */
  const grow = (room, { bottom, right }, by) => {
    const { rows, cols } = room.model.size();
    sized(Math.max(rows, bottom + 1), Math.max(cols, right + 1));
    if (bottom >= rows) hub.as(room, by, (sign) => room.model.structure("insert-rows", rows, bottom + 1 - rows, sign));
    if (right >= cols) hub.as(room, by, (sign) => room.model.structure("insert-cols", cols, right + 1 - cols, sign));
  };
  /**
   * Each cell of the range from `values` repeated over it; a formula is moved as a spreadsheet's fill moves it (its relative references follow the cell),
   * worked out in an engine of its own holding only the values, where they stand.
   */
  const filled = (values, range) => {
    const height = values.length, width = Math.max(...values.map((row) => row.length)), at = (r, c) => values[r % height][c % width] ?? "";
    const moved = values.some((row) => row.some((value) => value.startsWith("="))) && (range.bottom - range.top + 1 > height || range.right - range.left + 1 > width)
      ? (() => {
        const engine = HyperFormula.buildEmpty(CONFIG), sheet = engine.getSheetId(engine.addSheet("Fill"));
        try {
          engine.setCellContents({ sheet, row: range.top, col: range.left }, values.map((row) => Array.from({ length: width }, (_, c) => row[c] || null)));
          return engine.getFillRangeData({ start: { sheet, row: range.top, col: range.left }, end: { sheet, row: range.top + height - 1, col: range.left + width - 1 } }, { start: { sheet, row: range.top, col: range.left }, end: { sheet, row: range.bottom, col: range.right } });
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
  const SIDE = "sheet.json";

  return {
    noun: "sheet", ext: ".csv", adopts: "asked",
    made: () => toCsv(blank(START.rows, START.cols)),
    identify: () => ({ id: null }),
    places,
    where: (under, room) => { const range = room && cornered(room, under); return range ? { cells: rangeA1(range) } : {}; },
    /** The range and `radius` cells around it as typed, each row under its number and each column under its letter, then what its formulas compute. */
    context(room, under, radius) {
      const range = cornered(room, under);
      if (!range) return undefined;
      const { rows, cols } = room.model.size(), near = { top: Math.max(0, range.top - radius), left: Math.max(0, range.left - radius), bottom: Math.min(rows - 1, range.bottom + radius), right: Math.min(cols - 1, range.right + radius) };
      const typed = clip(inputs(room), near), shown = clip(texts(room), near), columns = Array.from({ length: near.right - near.left + 1 }, (_, c) => colName(near.left + c));
      const computed = typed.flatMap((row, r) => row.flatMap((input, c) => input.startsWith("=") ? [`${a1(near.top + r, near.left + c)} = ${shown[r][c]}`] : []));
      return [{ md: `The comment is on ${rangeA1(range)}. The cells around it, as typed:\n${toCsv([["", ...columns], ...typed.map((row, r) => [String(near.top + r + 1), ...row])]).trimEnd()}${computed.length ? `\nWhat the formulas compute: ${computed.join("; ")}` : ""}` }];
    },
    live: {
      format: SHEET_FORMAT,
      open: (doc) => ({ rows: doc.getArray(ROWS), cols: doc.getArray(COLS), cells: doc.getMap(CELLS), look: doc.getMap(LOOK), model: createSheetModel(doc) }),
      empty: (room) => !room.rows.length,
      close: (room) => room.model.destroy(),
      /**
       * The file read. The first time (no live copy yet) its cells are the sheet, with the formulas sheet.json keeps where they still compute what the file
       * says. After that, cell by cell: one whose text in the file is what the hub would write keeps what was typed in it (its formula), any other is
       * the file's text; rows and columns added or taken away at the end grow or shrink the sheet.
       */
      async take(room, text, owed) {
        room.eol = text.includes("\r\n") ? "\r\n" : "\n";
        if (owed && room.rows.length) return;
        const file = fromCsv(text), height = Math.max(1, file.length), width = Math.max(1, ...file.map((row) => row.length)), at = (r, c) => file[r]?.[c] ?? "";
        if (width > COL_LIMIT || height * width > SHEET_LIMIT) throw fault(422, `${room.entry.name}.csv is too large for a sheet (${height} rows x ${width} columns; at most ${SHEET_LIMIT} cells)`);
        if (!room.rows.length) {
          const kept = await fs.readFile(path.join(room.entry.side, SIDE), "utf8").then(JSON.parse).catch(() => null), formulas = [];
          room.doc.transact(() => {
            room.rows.insert(0, Array.from({ length: height }, rowId));
            room.cols.insert(0, Array.from({ length: width }, colId));
          });
          const ids = (r, c) => key(room.model.rowAt(r), room.model.colAt(c));
          room.doc.transact(() => {
            for (let r = 0; r < height; r += 1) for (let c = 0; c < width; c += 1) if (at(r, c)) room.cells.set(ids(r, c), at(r, c));
            for (const [address, input] of Object.entries(kept?.inputs ?? {})) {
              const place = parseA1(address);
              if (place && place.row < height && place.col < width && typeof input === "string" && input.startsWith("=")) { room.cells.set(ids(place.row, place.col), input); formulas.push(place); }
            }
            for (const [name, value] of Object.entries(kept?.look ?? {})) {
              const [what, letters] = name.split(":"), col = /^[A-Z]{1,3}$/.test(letters ?? "") ? colIndex(letters) : -1;
              if (col >= 0 && col < width && (what === "width" || what === "type")) room.look.set(`${what}:${room.model.colAt(col)}`, value);
            }
          });
          const stale = formulas.filter(({ row, col }) => valueText(room.model.value(row, col)) !== at(row, col));
          if (stale.length) room.doc.transact(() => { for (const { row, col } of stale) if (at(row, col)) room.cells.set(ids(row, col), at(row, col)); else room.cells.delete(ids(row, col)); });
          return;
        }
        const before = texts(room), { rows, cols } = room.model.size();
        if (height > rows) room.model.structure("insert-rows", rows, height - rows); else if (height < rows) room.model.structure("delete-rows", height, rows - height);
        if (width > cols) room.model.structure("insert-cols", cols, width - cols); else if (width < cols) room.model.structure("delete-cols", width, cols - width);
        const changed = [];
        for (let r = 0; r < height; r += 1) for (let c = 0; c < width; c += 1) if (before[r]?.[c] !== at(r, c) && room.model.input(r, c) !== at(r, c)) changed.push([r, c, at(r, c)]);
        if (changed.length) writeCells(room, changed);
      },
      write: (room) => toCsv(texts(room), room.eol ?? "\n"),
      /** sheet.json: the formulas by address and each column's look by letter, so the file and it are the whole sheet without the live copy. */
      async saved(room) {
        const formulas = {}, look = {};
        inputs(room).forEach((row, r) => row.forEach((input, c) => { if (input.startsWith("=")) formulas[a1(r, c)] = input; }));
        for (const [name, value] of room.look.entries()) { const [what, id] = name.split(":"), col = room.model.indexOfCol(id ?? ""); if (col >= 0) look[`${what}:${colName(col)}`] = value; }
        const json = `${JSON.stringify({ format: SHEET_FORMAT, inputs: formulas, look })}\n`;
        if (json !== room.json) { await writePrivateFile(path.join(room.entry.side, SIDE), json); room.json = json; }
      },
      about: (room) => [
        `It is the CSV file ${room.entry.path} in its project's folder, a sheet: change it through the cells actions, not by writing the file (the hub holds its live copy and its formulas; the file holds what they compute).`,
        "A comment's `under.cells` names the two corners of the range it is on by row and column ids; its hand-off says that range by A1 address as it is now.",
        `If you have the tool \`conduit_artifact\`, its actions cells, set, fill, rows and cols read and change the sheet (with \`for\`: the comment's <item>/<n>), and answer replies and resolves; the CLI's \`document cells|set|fill|rows|cols\` do the same.`,
      ],
    },
    cells: {
      /**
       * The sheet as text for an agent: a line saying what it is, then the CSV of what was typed (`as` "values": of what the file holds; "cells": JSON
       * of each cell that has something, with its id-keyed rows, columns and look). `range` reads only those cells.
       */
      async read(room, as, range) {
        const { rows, cols } = room.model.size(), whole = { top: 0, left: 0, bottom: rows - 1, right: cols - 1 }, asked = range === undefined || range === "" ? whole : parseRange(range);
        if (!asked) throw fault(400, `range is an A1 range such as B2:C5, not ${range}`);
        if (asked.top >= rows || asked.left >= cols) throw fault(400, `${rangeA1(asked)} is past the sheet's edge: it is ${rows} rows x ${cols} columns (${rangeA1(whole)})`);
        const area = { ...asked, bottom: Math.min(asked.bottom, rows - 1), right: Math.min(asked.right, cols - 1) }, typed = inputs(room);
        if (as === "values") return toCsv(clip(texts(room, typed), area));
        if (as === "cells") {
          const found = [];
          for (let r = area.top; r <= area.bottom; r += 1) for (let c = area.left; c <= area.right; c += 1) if (typed[r][c]) found.push({ at: a1(r, c), input: typed[r][c], value: room.model.value(r, c) });
          return { format: "conduit-sheet", version: 1, id: room.id, rows: room.rows.toArray(), cols: room.cols.toArray(), cells: found, look: room.look.toJSON() };
        }
        if (as !== undefined && as !== "inputs") throw fault(400, "as is values, cells, or left out for what was typed");
        return `# sheet ${room.entry.name}: ${rows} rows x ${cols} columns; formulas are shown as typed; address cells as A1${area === whole || rangeA1(area) === rangeA1(whole) ? "" : `; this is ${rangeA1(area)}, its first line row ${area.top + 1} and its first field column ${colName(area.left)}`}\n${toCsv(clip(typed, area))}`;
      },
      /** One change of cells or of rows and columns (contract: POST /v0/document/:id/cells). `for` is checked, and nothing is kept of it yet. */
      async edit(room, { op, at, range, values, value, count = 1, by, for: about } = {}) {
        const name = typeof by === "string" && by ? by.slice(0, 80) : "agent";
        if (about !== undefined) {
          if (!/^[\w-]+\/\d+$/.test(String(about))) throw fault(400, `for is the comment answered, as <item>/<n>, not ${about}`);
          await room.markup.thread(String(about).split("/")[0]);
        }
        if (op === "set" || op === "fill") {
          let area = op === "set" ? parseRange(at) : parseRange(range ?? at);
          if (!area || (op === "set" && typeof at === "string" && at.includes(":"))) throw fault(400, op === "set" ? `at is one cell's A1 address, such as B4, not ${at}` : `range is an A1 range such as B2:C5, not ${range}`);
          const grid = op === "set" || values === undefined ? [[text(value)]] : Array.isArray(values) && values.length && values.every((row) => Array.isArray(row) && row.length) ? values.map((row) => row.map(text)) : (() => { throw fault(400, "values is rows of cells' text, as [[\"a\", \"=A1*2\"], [\"b\", \"3\"]], or give value for every cell"); })();
          const height = grid.length, width = Math.max(...grid.map((row) => row.length));
          // A single cell takes the values' size, as a paste does.
          if (area.top === area.bottom && area.left === area.right) area = { ...area, bottom: area.top + height - 1, right: area.left + width - 1 };
          else if (height > area.bottom - area.top + 1 || width > area.right - area.left + 1) throw fault(400, `values is ${height} rows x ${width} columns, more than ${rangeA1(area)} holds: give a range that large, or its first cell alone`);
          const many = (area.bottom - area.top + 1) * (area.right - area.left + 1);
          if (many > CALL_LIMIT) throw fault(400, `That is ${many} cells; one call writes at most ${CALL_LIMIT}: split it`);
          grow(room, area, name);
          writeCells(room, filled(grid, area), name);
          return { cells: [rangeA1(area)], ...room.model.size() };
        }
        if (!["insert-rows", "insert-cols", "delete-rows", "delete-cols"].includes(op)) throw fault(400, "op is set, fill, insert-rows, insert-cols, delete-rows or delete-cols");
        const { rows, cols } = room.model.size(), isRows = op.endsWith("rows"), size = isRows ? rows : cols, what = isRows ? "row" : "column", removing = op.startsWith("delete");
        if (!Number.isInteger(count) || count < 1 || count > CALL_LIMIT) throw fault(400, "count is how many, 1 or more");
        index(at, removing ? size - 1 : size, `${what} to ${removing ? "delete" : "insert before"} (${size} ${what}s now)`);
        if (removing && at + count > size) throw fault(400, `There are ${size - at} ${what}s from ${at}: count is at most that`);
        if (removing && count >= size) throw fault(400, `A sheet keeps at least one ${what}`);
        if (!removing) sized(isRows ? rows + count : rows, isRows ? cols : cols + count);
        return hub.as(room, name, (sign) => room.model.structure(op, at, count, sign));
      },
    },
  };
}
