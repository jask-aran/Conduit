#!/usr/bin/env node
/**
 * The xlsx round-trip scorecard: workbooks of each feature people put in spreadsheets, written by an Excel-family tool (openpyxl, by
 * xlsx-roundtrip-features.py beside this script),
 * each imported and exported through the hub's document service in a temporary data root, then read back. Per feature: kept, changed (the first
 * fact that differs), dropped (none of its facts left), and whether the import report said so. Every export is held to what Excel is strict about
 * (parts, relationships, content types, element order, counts, style ids); a broken part fails the run. LibreOffice, where installed, converts
 * each export as a second opinion.
 * Run from conduit-web/: node --max-old-space-size=4096 scripts/xlsx-roundtrip.mjs [out dir] [feature filter] [--excel]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";

const args = process.argv.slice(2), flags = new Set(args.filter((arg) => arg.startsWith("--"))), [first, second] = args.filter((arg) => !arg.startsWith("--"));
if (flags.has("--help")) {
  console.log("usage: node scripts/xlsx-roundtrip.mjs [out dir] [feature filter] [--excel]   (XLSX_PYTHON: a python with openpyxl)\n       node scripts/xlsx-roundtrip.mjs --check <file.xlsx>   (only what Excel is strict about)");
  process.exit(0);
}
const python = process.env.XLSX_PYTHON ?? "/home/jask/jaskNEM/.venv/bin/python", features = new URL("./xlsx-roundtrip-features.py", import.meta.url).pathname;
const [outArg, only] = [first, second];
// ---- What Excel is strict about, part by part ----
const NS = { rel: "http://schemas.openxmlformats.org/package/2006/relationships" };
// CT_Worksheet and CT_Workbook's sequences (ECMA-376 Part 1, sml.xsd), and the stylesheet's.
const ORDER = {
  worksheet: "sheetPr dimension sheetViews sheetFormatPr cols sheetData sheetCalcPr sheetProtection protectedRanges scenarios autoFilter sortState dataConsolidate customSheetViews mergeCells phoneticPr conditionalFormatting dataValidations hyperlinks printOptions pageMargins pageSetup headerFooter rowBreaks colBreaks customProperties cellWatches ignoredErrors smartTags drawing legacyDrawing legacyDrawingHF drawingHF picture oleObjects controls webPublishItems tableParts extLst",
  workbook: "fileVersion fileSharing workbookPr workbookProtection bookViews sheets functionGroups externalReferences definedNames calcPr oleSize customWorkbookViews pivotCaches smartTagPr smartTagTypes webPublishing fileRecoveryPr webPublishObjects extLst",
  styleSheet: "numFmts fonts fills borders cellStyleXfs cellXfs cellStyles dxfs tableStyles colors extLst",
  chartSpace: "date1904 lang roundedCorners AlternateContent style clrMapOvr pivotSource protection chart spPr txPr externalData printSettings userShapes extLst",
};
const CONTENT = { worksheet: "spreadsheetml.worksheet+xml", styles: "spreadsheetml.styles+xml", sharedStrings: "spreadsheetml.sharedStrings+xml", chart: "drawingml.chart+xml", drawing: "drawing+xml", comments: "spreadsheetml.comments+xml", table: "spreadsheetml.table+xml" };
const children = (xml, root) => {
  const body = new RegExp(`<(?:\\w+:)?${root}\\b[^>]*>([\\s\\S]*)</(?:\\w+:)?${root}>`).exec(xml)?.[1] ?? "", names = [];
  let depth = 0;
  for (const [, close, name, self] of body.matchAll(/<(\/?)(?:[\w]+:)?([\w]+)\b[^>]*?(\/?)>/g)) {
    if (close) depth -= 1; else { if (depth === 0) names.push(name); if (!self) depth += 1; }
  }
  return names;
};
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/\s([\w:]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
// A relationship's target from its .rels part: relative to the folder of the part the .rels is for.
const resolve = (rels, target) => target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(path.posix.dirname(rels)), target));
function strict(bytes) {
  const zip = XLSX.CFB.read(bytes, { type: "buffer" }), parts = {};
  zip.FullPaths.forEach((full, i) => { if (zip.FileIndex[i].type === 2 && !full.includes("\x01")) parts[full.replace(/^Root Entry\//, "")] = Buffer.from(zip.FileIndex[i].content).toString(/\.(xml|rels)$/.test(full) ? "utf8" : "latin1"); });
  const faults = [], fault = (part, words) => faults.push(`${part}: ${words}`);
  const types = parts["[Content_Types].xml"] ?? "", defaults = new Set([...types.matchAll(/<Default [^>]*Extension="([^"]+)"/g)].map((m) => m[1].toLowerCase()));
  const overrides = Object.fromEntries([...types.matchAll(/<Override [^>]*>/g)].map(([tag]) => [attrs(tag).PartName.slice(1), attrs(tag).ContentType]));
  for (const part of Object.keys(parts)) {
    if (part === "[Content_Types].xml" || part.endsWith("/")) continue;
    if (!overrides[part] && !defaults.has(part.split(".").pop().toLowerCase())) fault(part, "no content type");
    if (!overrides[part] && Object.keys(CONTENT).some((kind) => new RegExp(`/${kind}\\d*\\.xml$`).test(part))) fault(part, "no content type of its own");
    if (part.endsWith(".xml") && !/^\s*(<\?xml[^>]*\?>\s*)?</.test(parts[part])) fault(part, "not XML");
  }
  for (const [part, type] of Object.entries(overrides)) {
    if (!(part in parts)) fault(part, "content type for a part that is not there");
    for (const [kind, ending] of Object.entries(CONTENT)) if (new RegExp(`/${kind}\\d*\\.xml$`).test(part) && !type.endsWith(ending)) fault(part, `content type ${type}`);
  }
  for (const [rels, xml] of Object.entries(parts)) {
    if (!rels.endsWith(".rels")) continue;
    const ids = new Set();
    for (const [tag] of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const { Id, Target, TargetMode } = attrs(tag);
      if (ids.has(Id)) fault(rels, `relationship id ${Id} twice`); ids.add(Id);
      if (TargetMode !== "External" && !(resolve(rels, Target) in parts)) fault(rels, `${Id} points at ${resolve(rels, Target)}, which is not there`);
    }
    const owner = rels.replace(/_rels\/([^/]+)\.rels$/, "$1");
    if (owner in parts) for (const [, id] of parts[owner].matchAll(/\br:(?:id|embed|link)="([^"]+)"/g)) if (!ids.has(id)) fault(owner, `r:id ${id} has no relationship`);
  }
  for (const [part, xml] of Object.entries(parts)) {
    const root = /<(?:\w+:)?(worksheet|workbook|styleSheet|chartSpace)\b/.exec(xml)?.[1];
    if (!root || !part.endsWith(".xml")) continue;
    if (!new RegExp(`^\\s*(<\\?xml[^>]*\\?>\\s*)?<(?:\\w+:)?${root}\\b`).test(xml)) fault(part, `something before <${root}>`);
    const order = ORDER[root].split(" "), seen = children(xml, root);
    let last = -1;
    for (const name of seen) { const at = order.indexOf(name); if (at < 0) fault(part, `<${name}> is not a child of <${root}>`); else if (at < last) fault(part, `<${name}> after <${order[last]}>`); else last = at; }
    if (root === "worksheet") {
      const merged = [...xml.matchAll(/<mergeCells count="(\d+)"/g)];
      for (const [, n] of merged) if (Number(n) !== (xml.match(/<mergeCell /g)?.length ?? 0)) fault(part, "mergeCells count");
      const dv = /<dataValidations count="(\d+)"/.exec(xml); if (dv && Number(dv[1]) !== (xml.match(/<dataValidation /g)?.length ?? 0)) fault(part, "dataValidations count");
      if (/<hyperlinks>\s*<\/hyperlinks>/.test(xml)) fault(part, "empty <hyperlinks>");
    }
    if (root === "styleSheet") {
      for (const list of ["numFmts", "fonts", "fills", "borders", "cellStyleXfs", "cellXfs", "cellStyles", "dxfs"]) {
        const at = new RegExp(`<${list} count="(\\d+)"[^>]*>([\\s\\S]*?)</${list}>`).exec(xml);
        if (at && Number(at[1]) !== children(`<x>${at[2]}</x>`, "x").length) fault(part, `${list} count ${at[1]}, holds ${children(`<x>${at[2]}</x>`, "x").length}`);
      }
      const size = (list) => children(`<x>${/<(\w+) count="\d+"[^>]*>([\s\S]*?)<\/\1>/.exec(xml.slice(xml.indexOf(`<${list}`)))?.[2] ?? ""}</x>`, "x").length;
      const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "", fonts = size("fonts"), fills = size("fills"), borders = size("borders");
      for (const [tag] of xfs.matchAll(/<xf\b[^>]*>/g)) { const a = attrs(tag); if (+a.fontId >= fonts || +a.fillId >= fills || +a.borderId >= borders) fault(part, `xf out of range ${tag}`); }
      const xfCount = xfs.match(/<xf\b/g)?.length ?? 0, dxfCount = size("dxfs");
      for (const [sheet, sx] of Object.entries(parts)) if (/worksheets\/sheet\d+\.xml$/.test(sheet)) {
        for (const [, s] of sx.matchAll(/<[cr]\b[^>]*\ss="(\d+)"/g)) if (+s >= xfCount) { fault(sheet, `style ${s} of ${xfCount}`); break; }
        for (const [, d] of sx.matchAll(/dxfId="(\d+)"/g)) if (+d >= dxfCount) { fault(sheet, `dxf ${d} of ${dxfCount}`); break; }
      }
    }
  }
  return faults;
}

// ---- Real Excel, through COM from powershell.exe: a scratch folder in Windows' temp, one workbook at a time, every Excel it started ended ----
const EXCEL_PS = String.raw`param([string]$Path)
$ErrorActionPreference = 'Stop'
$before = @(Get-Process EXCEL -ErrorAction SilentlyContinue | ForEach-Object Id); $out = @{ status = 'fails' }; $xl = $null
try {
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AutomationSecurity = 3
  # A normal load: a file Excel would offer to repair is refused here, never repaired silently.
  try { $wb = $xl.Workbooks.Open($Path, 0, $true) } catch { $out.status = 'needs repair'; throw }
  $sheets = 0; $charts = 0; $tables = 0; $formulas = 0; $at = 0; $notes = 0; $threads = 0; $images = 0; $hiddenCols = 0
  foreach ($ws in $wb.Worksheets) { $sheets++; $charts += $ws.ChartObjects().Count; $tables += $ws.ListObjects.Count; $notes += $ws.Comments.Count; $threads += $ws.CommentsThreaded.Count; $images += @($ws.Shapes | Where-Object { $_.Type -eq 13 }).Count; $hiddenCols += @(1..$ws.UsedRange.Columns.Count | Where-Object { $ws.Columns.Item($_).Hidden }).Count; try { $found = $ws.UsedRange.SpecialCells(-4123); $formulas += $found.Count; foreach ($cell in $found.Cells) { if ("$($cell.Formula2)" -like '*@*') { $at++ } } } catch {} }
  # A formula Excel reads as one value where the file meant it to spill shows as =@…: counted in "at".
  $out = @{ status = 'opens clean'; sheets = $sheets; charts = $charts; tables = $tables; formulas = $formulas; at = $at; notes = $notes; threads = $threads; images = $images; hiddenCols = $hiddenCols }
  $wb.Close($false)
} catch { $out.error = $_.Exception.Message }
finally {
  if ($xl) { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers(); Start-Sleep -Milliseconds 500
  Get-Process EXCEL -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | Stop-Process -Force
}
$out | ConvertTo-Json -Compress`;
const excelDir = flags.has("--excel") ? path.join(execFileSync("wslpath", [execFileSync("cmd.exe", ["/c", "echo %TEMP%"], { cwd: "/mnt/c", encoding: "utf8" }).trim()], { encoding: "utf8" }).trim(), `conduit-xlsx-${process.pid}`) : null;
if (excelDir) { await fs.mkdir(excelDir, { recursive: true }); await fs.writeFile(path.join(excelDir, "open.ps1"), EXCEL_PS); }
const win = (file) => execFileSync("wslpath", ["-w", file], { encoding: "utf8" }).trim();
/** What Excel makes of an export, held against what it holds: its tabs, charts, tables and formulas. */
const excel = async (bytes) => {
  const file = path.join(excelDir, "book.xlsx"), zip = XLSX.CFB.read(bytes, { type: "buffer" }), names = zip.FullPaths, xml = (re) => zip.FileIndex.filter((_, i) => re.test(names[i])).map((one) => Buffer.from(one.content).toString("utf8"));
  const wrote = { sheets: (xml(/xl\/workbook\.xml$/)[0].match(/<sheet\b/g) ?? []).length, charts: xml(/xl\/charts\/chart\d+\.xml$/).length, tables: xml(/xl\/tables\/table\d+\.xml$/).length, formulas: [...xml(/worksheets\/sheet\d+\.xml$/).join("").matchAll(/<c\b([^>]*)><f\b([^>]*)/g)].reduce((n, [, cell, head]) => { const ref = /ref="([^"]+)"/.exec(head)?.[1], area = ref && !/\bcm=/.test(cell) && XLSX.utils.decode_range(ref); return n + (area ? (area.e.r - area.s.r + 1) * (area.e.c - area.s.c + 1) : 1); }, 0), at: 0,
    threads: xml(/threadedComments\/threadedComment\d+\.xml$/).join("").match(/<threadedComment (?![^>]*parentId)/g)?.length ?? 0, images: xml(/xl\/drawings\/drawing\d+\.xml$/).join("").match(/<(?:xdr:)?pic>/g)?.length ?? 0 };
  // Excel counts a threaded comment's note (its projection for older versions) as the thread alone.
  // Excel takes a column written with no width as zero wide, so hidden: its hidden columns are those the file hid, and no more.
  wrote.hiddenCols = [...xml(/worksheets\/sheet\d+\.xml$/).join("").matchAll(/<col\b[^>]*>/g)].reduce((n, [tag]) => /\shidden="(?:1|true)"/.test(tag) ? n + Number(/max="(\d+)"/.exec(tag)[1]) - Number(/min="(\d+)"/.exec(tag)[1]) + 1 : n, 0);
  wrote.notes = (xml(/xl\/comments\d*\.xml$/).join("").match(/<comment /g)?.length ?? 0) - wrote.threads;
  await fs.writeFile(file, bytes);
  try {
    const said = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", win(path.join(excelDir, "open.ps1")), "-Path", win(file)], { cwd: "/mnt/c", encoding: "utf8", timeout: 120_000 }).trim());
    if (said.status !== "opens clean") return `${said.status}${said.error ? ` (${said.error})` : ""}`;
    const off = Object.keys(wrote).filter((what) => said[what] !== wrote[what]).map((what) => `${what} ${said[what]} of ${wrote[what]}`);
    return off.length ? `opens, reads ${off.join(", ")}` : "opens clean";
  } catch (error) { return `fails (${String(error.message).split("\n")[0]})`; } finally { await fs.rm(file, { force: true }); }
};

if (flags.has("--check")) {
  const bytes = await fs.readFile(first), faults = strict(bytes);
  console.log(faults.join("\n") || "no faults");
  if (excelDir) { console.log(`Excel: ${await excel(bytes)}`); await fs.rm(excelDir, { recursive: true, force: true }); }
  process.exit(faults.length ? 1 : 0);
}

// ---- The round trip ----
const { createDocuments } = await import("../src/server/documents.js");
const out = path.resolve(outArg ?? await fs.mkdtemp(path.join(os.tmpdir(), "xlsx-roundtrip-")));
const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xlsx-roundtrip-data-")), work = path.join(dataRoot, "project");
await fs.mkdir(path.join(out, "in"), { recursive: true }); await fs.mkdir(path.join(out, "out"), { recursive: true }); await fs.mkdir(work, { recursive: true });
const py = (...args) => execFileSync(python, ["-I", features, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
const named = JSON.parse(py("gen", path.join(out, "in")));
const project = { id: "roundtrip", name: "roundtrip", workingRoot: work };
const documents = createDocuments({ dataRoot, projects: { get: async (id) => id === project.id ? project : null, list: async () => [project] } });

const facts = (file, feature) => { try { return JSON.parse(py("read", file, feature)); } catch (error) { return { "(unreadable)": String(error.stderr ?? error).split("\n").filter(Boolean).at(-1) }; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const soffice = ["soffice", "libreoffice"].find((tool) => { try { execFileSync("which", [tool], { stdio: "ignore" }); return true; } catch { return false; } });
const rows = [], broken = [];
for (const [nn, feature] of Object.entries(named).sort()) {
  if (only && !feature.includes(only)) continue;
  const input = path.join(out, "in", `${nn}.xlsx`), output = path.join(out, "out", `${nn}.xlsx`), before = facts(input, feature);
  let after = {}, said = "", note = "", opened = "-";
  try {
    const made = await documents.importXlsx(project.id, { bytes: await fs.readFile(input), name: `book${nn}` });
    const r = made.report, sum = Object.values(r.dropped).reduce((a, b) => a + b, 0);
    said = [Object.keys(r.kept ?? {}).length && `kept ${Object.entries(r.kept).map(([what, n]) => `${n} ${what}`).join(", ")}`, sum && `left out ${Object.entries(r.dropped).map(([what, n]) => `${n} ${what}`).join(", ")}`, r.computed.frozen && `${r.computed.frozen} frozen`].filter(Boolean).join("; ");
    const { bytes } = await documents.exportXlsx(made.id);
    await fs.writeFile(output, bytes);
    for (const one of strict(bytes)) broken.push(`${feature}: ${one}`);
    after = facts(output, feature);
    if (excelDir) opened = await excel(bytes);
    if (soffice) try { execFileSync(soffice, ["--headless", "--convert-to", "csv", "--outdir", path.join(out, "csv"), output], { stdio: "ignore", timeout: 60_000 }); } catch { broken.push(`${feature}: LibreOffice could not convert it`); }
  } catch (error) { note = `failed: ${error.message}`; }
  const keys = Object.keys(before), kept = keys.filter((k) => same(before[k], after[k])), gone = keys.filter((k) => !(k in after));
  const verdict = note ? "failed" : !keys.length ? "not generated" : kept.length === keys.length ? "kept" : gone.length === keys.length ? "dropped" : "changed";
  const first = keys.find((k) => !same(before[k], after[k]));
  if (!note && first) note = `${kept.length}/${keys.length} kept; ${first}: ${JSON.stringify(before[first])} -> ${JSON.stringify(after[first] ?? null)}`;
  rows.push({ feature, verdict, said, note, opened });
}
const cut = (text, n) => text.length > n ? `${text.slice(0, n - 1)}…` : text;
console.log(`| Feature | Result | Import report | First difference |${excelDir ? " Excel |" : ""}\n| --- | --- | --- | --- |${excelDir ? " --- |" : ""}`);
for (const row of rows) console.log(`| ${row.feature} | ${row.verdict} | ${cut(row.said, 70) || "-"} | ${cut(row.note, 140).replace(/\|/g, "\\|") || "-"} |${excelDir ? ` ${row.opened} |` : ""}`);
const count = (what) => rows.filter((row) => row.verdict === what).length;
console.log(`\n${count("kept")} kept, ${count("changed")} changed, ${count("dropped")} dropped, ${count("failed")} failed of ${rows.length}. LibreOffice: ${soffice ? "converted each" : "not installed"}. Files in ${out}`);
await documents.close?.();
await fs.rm(dataRoot, { recursive: true, force: true });
if (excelDir) await fs.rm(excelDir, { recursive: true, force: true });
if (broken.length) { console.error(`\nExcel would refuse or repair:\n${broken.join("\n")}`); process.exit(1); }
process.exit(0);
