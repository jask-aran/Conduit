import path from "node:path";
import * as XLSX from "xlsx";
import { a1, colIndex, parseRange, rangeA1, rowId, tabRef } from "../sheet-format.js";
import { CHART_KINDS, chartSize } from "../sheet-charts.js";

/*
 * The parts of an .xlsx SheetJS neither reads nor writes, beside a sheet: its table (xl/tables) and its charts (a drawing of DrawingML charts,
 * xl/drawings and xl/charts), each linked from the sheet by a relationship and named in [Content_Types].xml.
 */
const unescaped = (text) => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const escaped = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = (tag, name) => { const found = new RegExp(`\\s${name}="([^"]*)"`).exec(tag ?? ""); return found ? unescaped(found[1]) : undefined; };
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", TYPE = "application/vnd.openxmlformats-officedocument.";
const EMU_PER_PX = 9525;

/** A tab's table as its own part, its columns named by its header row's text; none where a header is empty or repeated, as Excel would repair it. */
export function tablePart(table, values, id, taken) {
  const area = parseRange(String(table?.range ?? ""));
  if (!area || area.bottom <= area.top) return null;
  const names = Array.from({ length: area.right - area.left + 1 }, (_, c) => { const value = values[area.top]?.[area.left + c]; return typeof value === "string" || Number.isInteger(value) ? String(value) : ""; });
  if (names.some((name) => !name) || new Set(names.map((name) => name.toLowerCase())).size < names.length) return null;
  // A table's name is the workbook's: one another tab's table has, or one Excel would not take, is numbered instead.
  const said = String(table.name ?? ""), called = /^[A-Za-z_\\][\w.]*$/.test(said) && !/^[A-Z]{1,3}\d+$/i.test(said) && !taken.has(said.toLowerCase()) ? said : `Table${id}`, ref = rangeA1(area);
  taken.add(called.toLowerCase());
  return { name: `xl/tables/table${id}.xml`, type: `${TYPE}spreadsheetml.table+xml`, rel: `${REL}/table`, element: "tableParts", block: (rid) => `<tableParts count="1"><tablePart r:id="${rid}"/></tableParts>`,
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${id}" name="${escaped(called)}" displayName="${escaped(called)}" ref="${ref}"><autoFilter ref="${ref}"/><tableColumns count="${names.length}">${names.map((name, n) => `<tableColumn id="${n + 1}" name="${escaped(name)}"/>`).join("")}</tableColumns><tableStyleInfo name="${escaped(table.style ?? "TableStyleMedium2")}" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>` };
}

const PLOT = { column: "barChart", bar: "barChart", line: "lineChart", area: "areaChart", pie: "pieChart", scatter: "scatterChart" };
const axes = (scatter) => `<c:axId val="1"/><c:axId val="2"/></c:${scatter}>${scatter === "scatterChart" ? '<c:valAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:valAx>' : '<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>'}<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>`;
/** A chart (by A1, sheet-charts.d.ts SheetChartA1) as a DrawingML chart part: its first column (or row) the labels, each other one a series named by its first cell. */
export function chartXml(chart, tab) {
  const area = parseRange(chart.range), byCol = chart.labels !== "row", ref = (top, left, bottom, right) => `${tabRef(tab)}!${rangeA1({ top, left, bottom, right }).replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")}`;
  const lines = byCol ? area.right - area.left : area.bottom - area.top, plot = PLOT[chart.kind];
  const labels = byCol ? ref(area.top + 1, area.left, area.bottom, area.left) : ref(area.top, area.left + 1, area.top, area.right);
  const series = Array.from({ length: lines }, (_, n) => {
    const name = byCol ? ref(area.top, area.left + 1 + n, area.top, area.left + 1 + n) : ref(area.top + 1 + n, area.left, area.top + 1 + n, area.left);
    const values = byCol ? ref(area.top + 1, area.left + 1 + n, area.bottom, area.left + 1 + n) : ref(area.top + 1 + n, area.left + 1, area.top + 1 + n, area.right);
    const data = plot === "scatterChart" ? `<c:xVal><c:numRef><c:f>${escaped(labels)}</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>${escaped(values)}</c:f></c:numRef></c:yVal><c:smooth val="0"/>` : `<c:cat><c:strRef><c:f>${escaped(labels)}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${escaped(values)}</c:f></c:numRef></c:val>`;
    return `<c:ser><c:idx val="${n}"/><c:order val="${n}"/><c:tx><c:strRef><c:f>${escaped(name)}</c:f></c:strRef></c:tx>${plot === "scatterChart" ? '<c:marker><c:symbol val="circle"/></c:marker>' : ""}${data}</c:ser>`;
  }).join("");
  const head = { barChart: `<c:barDir val="${chart.kind === "bar" ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>`, lineChart: '<c:grouping val="standard"/><c:varyColors val="0"/>', areaChart: '<c:grouping val="standard"/><c:varyColors val="0"/>', pieChart: '<c:varyColors val="1"/>', scatterChart: '<c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>' }[plot];
  const tail = plot === "pieChart" ? `<c:firstSliceAng val="0"/></c:pieChart>` : `${plot === "barChart" ? '<c:gapWidth val="150"/>' : plot === "lineChart" ? '<c:marker val="1"/>' : ""}${axes(plot)}`;
  const title = chart.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${escaped(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}"><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/><c:${plot}>${head}${series}${tail}</c:plotArea><c:legend><c:legendPos val="${plot === "pieChart" ? "r" : "b"}"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}
/** A tab's charts as a drawing part (each chart at its cell, its size kept: a one-cell anchor) and its chart parts, numbered from `first`. */
export function drawingPart(charts, tab, id, first) {
  const fit = charts.filter((chart) => CHART_KINDS.includes(chart.kind) && parseRange(String(chart.range ?? "")) && /^[A-Z]{1,3}\d+$/.test(String(chart.at ?? "")));
  if (!fit.length) return null;
  const anchors = fit.map((chart, n) => {
    const [, letters, digits] = /^([A-Z]+)(\d+)$/.exec(chart.at), { width, height } = chartSize(chart);
    return `<xdr:oneCellAnchor><xdr:from><xdr:col>${colIndex(letters)}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${Number(digits) - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${width * EMU_PER_PX}" cy="${height * EMU_PER_PX}"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${n + 2}" name="Chart ${n + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${n + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>`;
  }).join("");
  return { name: `xl/drawings/drawing${id}.xml`, type: `${TYPE}drawing+xml`, rel: `${REL}/drawing`, element: "drawing", block: (rid) => `<drawing r:id="${rid}"/>`,
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}">${anchors}</xdr:wsDr>`,
    more: [[`xl/drawings/_rels/drawing${id}.xml.rels`, rels(fit.map((_, n) => [`rId${n + 1}`, `${REL}/chart`, `../charts/chart${first + n}.xml`]))], ...fit.map((chart, n) => [`xl/charts/chart${first + n}.xml`, chartXml(chart, tab), `${TYPE}drawingml.chart+xml`])],
    count: fit.length };
}
const rels = (list) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("")}</Relationships>`;

/** A written workbook given each sheet's parts (`sheets[n]`: those of xl/worksheets/sheet<n+1>.xml), each linked from its sheet, put in its place there (`placed`), and typed. */
export function withParts(bytes, sheets, placed) {
  if (!sheets.some((parts) => parts.length)) return bytes;
  const zip = XLSX.CFB.read(bytes, { type: "buffer" }), get = (name) => { const file = XLSX.CFB.find(zip, `/${name}`); return file ? Buffer.from(file.content).toString("utf8") : null; };
  const put = (name, text) => { const file = XLSX.CFB.find(zip, `/${name}`), content = Buffer.from(text, "utf8"); if (file) { file.content = content; file.size = content.length; } else XLSX.CFB.utils.cfb_add(zip, `/${name}`, content); };
  let types = get("[Content_Types].xml") ?? "";
  const typed = (name, type) => { types = types.replace(new RegExp(`<Override PartName="/${name.replace(/[.]/g, "\\.")}"[^>]*/>`), "").replace("</Types>", `<Override PartName="/${name}" ContentType="${type}"/></Types>`); };
  sheets.forEach((parts, n) => {
    if (!parts.length) return;
    const sheetName = `xl/worksheets/sheet${n + 1}.xml`, relsName = `xl/worksheets/_rels/sheet${n + 1}.xml.rels`;
    let sheet = get(sheetName), had = get(relsName) ?? rels([]);
    parts.forEach((part, k) => {
      const rid = `rIdPart${k + 1}`;
      had = had.replace("</Relationships>", `<Relationship Id="${rid}" Type="${part.rel}" Target="${path.posix.relative("xl/worksheets", part.name)}"/></Relationships>`);
      put(part.name, part.xml); typed(part.name, part.type);
      for (const [name, xml, type] of part.more ?? []) { put(name, xml); if (type) typed(name, type); }
      sheet = placed(sheet, part.element, part.block(rid));
    });
    put(relsName, had); put(sheetName, sheet);
  });
  if (!/Extension="rels"/.test(types)) types = types.replace("</Types>", `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`);
  put("[Content_Types].xml", types);
  return XLSX.CFB.write(zip, { fileType: "zip", type: "buffer", compression: true });
}

const KIND_OF = { barChart: (xml) => /<(?:\w+:)?barDir val="bar"/.test(xml) ? "bar" : "column", bar3DChart: (xml) => /<(?:\w+:)?barDir val="bar"/.test(xml) ? "bar" : "column", lineChart: () => "line", line3DChart: () => "line", areaChart: () => "area", area3DChart: () => "area", pieChart: () => "pie", pie3DChart: () => "pie", doughnutChart: () => "pie", scatterChart: () => "scatter" };
/**
 * A sheet's charts read from its drawing, as the look holds them by A1 (SheetChartA1): each its plot's kind, the range its series' references span
 * on this tab, whether they run down columns, its title, cell and size. `text(name)`: a part's XML; `linked(from, type)`: the parts a part links to.
 * What cannot be read so is counted in `drop`.
 */
export function readCharts(sheetName, tabName, text, linked, drop) {
  const found = [];
  for (const drawing of linked(sheetName, "drawing")) {
    const xml = text(drawing), targets = Object.fromEntries((text(drawing.replace(/([^/]+)$/, "_rels/$1.rels")).match(/<Relationship\b[^>]*>/g) ?? []).map((tag) => { const target = attr(tag, "Target") ?? ""; return [attr(tag, "Id"), target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(drawing), target))]; }));
    drop("images", (xml.match(/<(?:xdr:)?pic>/g) ?? []).length);
    for (const [anchor] of xml.matchAll(/<(?:xdr:)?(?:oneCellAnchor|twoCellAnchor|absoluteAnchor)\b[\s\S]*?<\/(?:xdr:)?(?:oneCellAnchor|twoCellAnchor|absoluteAnchor)>/g)) {
      const rid = /<(?:\w+:)?chart\b[^>]*r:id="([^"]+)"/.exec(anchor)?.[1];
      if (!rid) continue;
      const chart = text(targets[rid] ?? ""), plot = Object.keys(KIND_OF).find((name) => new RegExp(`<(?:\\w+:)?${name}>`).test(chart)), at = (side, what) => Number(new RegExp(`<(?:xdr:)?${side}>[\\s\\S]*?<(?:xdr:)?${what}>(\\d+)<`).exec(anchor)?.[1] ?? NaN);
      const refs = [...chart.matchAll(/<(?:\w+:)?f>([^<]*)<\/(?:\w+:)?f>/g)].map(([, f]) => unescaped(f)), areas = refs.map((f) => { const cut = f.lastIndexOf("!"), tab = f.slice(0, cut).replace(/^'|'$/g, "").replace(/''/g, "'"); return tab === tabName ? parseRange(f.slice(cut + 1).replace(/\$/g, "")) : null; });
      if (!plot || !areas.length || areas.some((area) => !area) || Number.isNaN(at("from", "col"))) { drop(plot && areas.length ? "charts reading another tab" : "charts of a kind the sheet does not draw"); continue; }
      const span = areas.reduce((all, one) => ({ top: Math.min(all.top, one.top), left: Math.min(all.left, one.left), bottom: Math.max(all.bottom, one.bottom), right: Math.max(all.right, one.right) }));
      const values = [...chart.matchAll(/<(?:\w+:)?(?:val|yVal)>[\s\S]*?<(?:\w+:)?f>([^<]*)<\/(?:\w+:)?f>/g)].map(([, f]) => parseRange(unescaped(f).slice(unescaped(f).lastIndexOf("!") + 1).replace(/\$/g, "")));
      const ext = /<(?:xdr:)?ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(anchor), to = [at("to", "col"), at("to", "row")];
      const title = [...(/<(?:\w+:)?title>[\s\S]*?<\/(?:\w+:)?title>/.exec(chart)?.[0] ?? "").matchAll(/<(?:\w+:)?t>([^<]*)<\/(?:\w+:)?t>/g)].map(([, t]) => unescaped(t)).join("");
      const size = ext ? { width: Number(ext[1]) / EMU_PER_PX, height: Number(ext[2]) / EMU_PER_PX } : { width: (to[0] - at("from", "col")) * 64, height: (to[1] - at("from", "row")) * 20 };
      const one = { id: rowId(), kind: KIND_OF[plot](chart), range: rangeA1(span), labels: values[0] && values[0].left === values[0].right && values[0].top !== values[0].bottom ? "col" : "row", ...(title ? { title } : {}), at: a1(at("from", "row"), at("from", "col")), ...chartSize(size) };
      // A chart the sheet draws otherwise (series left out of the block, stacked, two plots in one) is kept as the sheet would draw its block, and said so.
      const refsOf = (xml) => [...new Set([...xml.matchAll(/<(?:\w+:)?f>([^<]*)<\/(?:\w+:)?f>/g)].map(([, f]) => unescaped(f).replace(/[$']/g, "")))].sort().join(" ");
      const plots = Object.keys(KIND_OF).filter((name) => new RegExp(`<(?:\\w+:)?${name}>`).test(chart)).length;
      if (refsOf(chart) !== refsOf(chartXml(one, tabName)) || plots > 1 || /<(?:\w+:)?grouping val="(?:stacked|percentStacked)"/.test(chart)) drop("charts drawn from the block of cells their series read, not as the file drew them");
      found.push(one);
    }
  }
  return found;
}
