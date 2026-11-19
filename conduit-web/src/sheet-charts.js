import { a1, key, parseA1, parseRange, rangeA1 } from "./sheet-format.js";

/*
 * A tab's charts (sheet-charts.d.ts), as its look holds them (`charts:<tabId>`, a JSON list): each its kind, its source range by its corners' ids (so it
 * follows rows and columns put in, taken out or sorted, as a merge does), the cell its top-left corner stands on by ids, and its size at 100%. Drawn from
 * the live cells on the page (components/sheet/charts.tsx); made and changed by an agent through the hub (sheets.js `chart`), moved, sized and deleted
 * by the person. Shared by both.
 */
export const CHART_KINDS = ["bar", "column", "line", "area", "pie", "scatter"];
export const CHART_LIMIT = 20;
export const CHART_SIZE = { width: 480, height: 288 }, CHART_LEAST = { width: 160, height: 120 }, CHART_MOST = { width: 2000, height: 1500 };
const TITLE_CHARS = 120;
const KIND_WORDS = "bar (horizontal bars), column (vertical bars), line, area, pie or scatter";

const clamp = (n, least, most) => Math.min(most, Math.max(least, Math.round(n)));
const corner = (view, text) => { const cut = String(text ?? "").indexOf(":"); return cut < 0 ? null : { row: view.indexOfRow(text.slice(0, cut)), col: view.indexOfCol(text.slice(cut + 1)) }; };
const fits = (one) => one && typeof one.id === "string" && CHART_KINDS.includes(one.kind) && typeof one.from === "string" && typeof one.to === "string" && typeof one.at === "string";

export const readCharts = (text) => { try { const list = JSON.parse(String(text)); return Array.isArray(list) ? list.filter(fits) : []; } catch { return []; } };
// A chart's range by its corners, which a move of rows or columns (by ids) can carry past each other: the box they span, as a spreadsheet's keeps.
const spanned = (view, chart) => {
  const from = corner(view, chart.from), to = corner(view, chart.to);
  return from && to && Math.min(from.row, from.col, to.row, to.col) >= 0 ? { top: Math.min(from.row, to.row), left: Math.min(from.col, to.col), bottom: Math.max(from.row, to.row), right: Math.max(from.col, to.col) } : null;
};
/** Where a chart is now: its source range and the cell it stands on; null where either is gone. */
export const chartPlace = (view, chart) => {
  const area = spanned(view, chart), at = corner(view, chart.at);
  return area && at && at.row >= 0 && at.col >= 0 ? { area, at } : null;
};
/** A tab's charts by A1 (sheet.json, and an agent's read), those whose cells are gone left out. */
export const chartsA1 = (view, text) => readCharts(text).flatMap((chart) => {
  const place = chartPlace(view, chart);
  if (!place) return [];
  const { from, to, at, ...rest } = chart;
  return [{ ...rest, range: rangeA1(place.area), at: a1(place.at.row, place.at.col) }];
});
/** Charts by A1 back to ids, on a tab of `view`; those outside it left out. */
export const chartIds = (view, list) => {
  const { rows, cols } = view.size(), inside = (cell) => cell && cell.row < rows && cell.col < cols, ids = (cell) => key(view.rowAt(cell.row), view.colAt(cell.col));
  const out = (Array.isArray(list) ? list : []).flatMap((one) => {
    const area = parseRange(String(one?.range ?? "")), at = parseA1(String(one?.at ?? ""));
    if (!area || !inside({ row: area.bottom, col: area.right }) || !inside(at) || !CHART_KINDS.includes(one.kind)) return [];
    const { range, at: _, ...rest } = one;
    return [{ ...rest, from: ids({ row: area.top, col: area.left }), to: ids({ row: area.bottom, col: area.right }), at: ids(at) }];
  });
  return out.length ? JSON.stringify(out.slice(0, CHART_LIMIT)) : undefined;
};

/**
 * A chart made or changed from an agent's spec, on the tab `view` is: `was` the chart it changes (its fields kept where the spec leaves them out).
 * Throws with what to give instead. `range` and `at` are A1 on that tab; `labels` says whether the range's first column (`col`: each other column
 * a series) or its first row (`row`: each other row a series) holds the labels; unsaid, the longer side runs along the labels.
 */
export const chartFrom = (view, spec, was, id) => {
  const fault = (words) => { throw Object.assign(new Error(words), { status: 400 }); };
  const { rows, cols } = view.size(), edge = `the tab is ${rows} rows x ${cols} columns (${rangeA1({ top: 0, left: 0, bottom: rows - 1, right: cols - 1 })})`;
  const kind = spec.kind ?? was?.kind;
  if (!CHART_KINDS.includes(kind)) fault(`kind is ${KIND_WORDS}${spec.kind === undefined ? "" : `, not ${spec.kind}`}`);
  const now = was && chartPlace(view, was), area = spec.range !== undefined ? parseRange(String(spec.range)) : now?.area;
  if (!area) fault(spec.range === undefined ? "range is the cells to chart, an A1 range such as A1:C13 (the labels in its first column or row)" : `range is an A1 range such as A1:C13, not ${spec.range}`);
  if (area.bottom >= rows || area.right >= cols) fault(`${rangeA1(area)} runs past the tab's edge: ${edge}`);
  if (area.top === area.bottom && area.left === area.right) fault(`${rangeA1(area)} is one cell: a chart needs a range of values, such as A1:B6`);
  const labels = spec.labels ?? was?.labels ?? (area.bottom - area.top >= area.right - area.left ? "col" : "row");
  if (labels !== "col" && labels !== "row") fault(`labels is col (the first column holds the labels, each other column is a series) or row (the first row does), not ${labels}`);
  const title = spec.title === undefined ? was?.title : spec.title === null ? undefined : String(spec.title).trim().slice(0, TITLE_CHARS) || undefined;
  // Unsaid, a new chart stands two columns right of its range, else two rows under it, else on it.
  const placed = spec.at !== undefined ? parseA1(String(spec.at)) : now ? now.at : area.right + 2 < cols ? { row: area.top, col: area.right + 2 } : area.bottom + 2 < rows ? { row: area.bottom + 2, col: area.left } : { row: area.top, col: area.left };
  if (!placed) fault(`at is the cell the chart's top-left corner stands on, such as E2, not ${spec.at}`);
  if (placed.row >= rows || placed.col >= cols) fault(`${a1(placed.row, placed.col)} is past the tab's edge: ${edge}`);
  const size = (name, said) => {
    const given = spec[name];
    if (given === undefined) return was?.[name] ?? CHART_SIZE[name];
    if (typeof given !== "number" || !Number.isFinite(given) || given < CHART_LEAST[name] || given > CHART_MOST[name]) fault(`${name} is in pixels at 100%, from ${CHART_LEAST[name]} to ${CHART_MOST[name]} (${said} ${CHART_SIZE[name]}), not ${given}`);
    return Math.round(given);
  };
  const ids = (cell) => key(view.rowAt(cell.row), view.colAt(cell.col));
  return { id: was?.id ?? id, kind, from: ids({ row: area.top, col: area.left }), to: ids({ row: area.bottom, col: area.right }), labels, ...(title ? { title } : {}), at: ids(placed), width: size("width", "a new one is"), height: size("height", "a new one is") };
};

/**
 * Before rows or columns are deleted: each chart's range shrinks as a filter's does (a corner on a deleted line moves to the nearest kept one inside it),
 * and the cell it stands on moves to the line before (or after) the deleted ones; a chart with none of its range left goes. The next list, or undefined
 * where nothing changes (null: none are left).
 */
export const keptCharts = (view, text, isRows, at, count) => {
  const list = readCharts(text);
  if (!list.length) return undefined;
  const gone = (n) => n >= at && n < at + count, size = isRows ? view.size().rows : view.size().cols, id = (n) => isRows ? view.rowAt(n) : view.colAt(n);
  const lineOf = (cell) => { const [row, col] = cell.split(":"); return isRows ? view.indexOfRow(row) : view.indexOfCol(col); };
  const moved = (cell, n) => { const [row, col] = cell.split(":"); return isRows ? key(id(n), col) : key(row, id(n)); };
  const next = list.flatMap((chart) => {
    const area = spanned(view, chart);
    if (!area) return [chart];
    let [lo, hi] = isRows ? [area.top, area.bottom] : [area.left, area.right];
    while (lo <= hi && gone(lo)) lo++;
    while (hi >= lo && gone(hi)) hi--;
    if (lo > hi) return [];
    const stand = lineOf(chart.at), kept = stand < 0 || !gone(stand) ? chart.at : at > 0 ? moved(chart.at, at - 1) : at + count < size ? moved(chart.at, at + count) : chart.at;
    const from = key(view.rowAt(area.top), view.colAt(area.left)), to = key(view.rowAt(area.bottom), view.colAt(area.right));
    return [{ ...chart, from: moved(from, lo), to: moved(to, hi), at: kept }];
  });
  return JSON.stringify(next) === JSON.stringify(list) ? undefined : next.length ? JSON.stringify(next) : null;
};

/**
 * What a chart draws from its range: the labels along it and each series' values (a number, or null: drawn as a gap). `read(row, col)`: a cell's value
 * and how it is shown. Lines in `hidden` are left out, as a spreadsheet's chart leaves out hidden rows. With labels in the first column, the first
 * row names the series where it holds no number; a range one column wide is one series, numbered. A scatter's labels are its x values.
 */
export const chartData = (area, labels, read, hidden = { rows: new Set(), cols: new Set() }, most = Infinity) => {
  // Along the labels, one line in `every` is read where the range holds more than `most`: past the chart's pixels more draw nothing, and a whole column
  // read cell by cell would take frames.
  const along = labels === "col" ? area.bottom - area.top + 1 : area.right - area.left + 1, every = Math.max(1, Math.ceil(along / most));
  const shown = (from, to, skip, step) => { const out = []; for (let at = from; at <= to; at += step) { while (at <= to && skip.has(at)) at++; if (at <= to) out.push(at); } return out; };
  const rows = shown(area.top, area.bottom, hidden.rows, labels === "col" ? every : 1), cols = shown(area.left, area.right, hidden.cols, labels === "col" ? 1 : every);
  // Read as labels down the first column, the other way turned round.
  const lines = labels === "col" ? rows : cols, fields = labels === "col" ? cols : rows, cell = (line, field) => labels === "col" ? read(line, field) : read(field, line);
  const number = (one) => typeof one.value === "number" && Number.isFinite(one.value) ? one.value : null;
  const named = fields.length > 1, series = named ? fields.slice(1) : fields;
  const head = lines.length > 1 && series.every((field) => number(cell(lines[0], field)) === null) && series.some((field) => cell(lines[0], field).text !== "");
  const body = head ? lines.slice(1) : lines;
  return {
    every,
    labels: body.map((line, n) => named ? cell(line, fields[0]).text : String(n + 1)),
    x: body.map((line) => named ? number(cell(line, fields[0])) : null),
    series: series.map((field, n) => ({ name: head ? cell(lines[0], field).text : `Series ${n + 1}`, values: body.map((line) => number(cell(line, field))) })),
  };
};
export const chartSize = (chart) => ({ width: clamp(chart.width ?? CHART_SIZE.width, CHART_LEAST.width, CHART_MOST.width), height: clamp(chart.height ?? CHART_SIZE.height, CHART_LEAST.height, CHART_MOST.height) });
