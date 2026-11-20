"""Workbooks of each feature, as Excel-family tools write them (openpyxl, with cached values put in as Excel keeps them), and a reader that says
what a workbook holds of a feature as flat facts, for scripts/xlsx-roundtrip.mjs."""
USAGE = "usage: python -I xlsx-roundtrip-features.py gen <dir>            (writes NN.xlsx, prints {NN: feature})\n       python -I xlsx-roundtrip-features.py read <file.xlsx> <feature> (prints its facts as JSON)"
import datetime, io, json, re, sys, zipfile
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.formula import ArrayFormula
from openpyxl.formatting.rule import CellIsRule, ColorScaleRule, DataBarRule, FormulaRule, IconSetRule, Rule
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.chart import BarChart, LineChart, PieChart, Reference
from openpyxl.drawing.image import Image as XImage
from openpyxl.workbook.protection import WorkbookProtection

F = {}
def feature(name):
    def put(pair):
        F[name] = pair
        return pair
    return put

def numbers(ws, n=5, col=1):
    for r in range(1, n + 1): ws.cell(r, col, r * 10)

def g_values(wb):
    ws = wb.active
    rows = [12, -3.25, 1e-7, 123456789012, "plain", True, False, datetime.datetime(2026, 3, 4), datetime.time(13, 30), datetime.datetime(2026, 3, 4, 9, 15)]
    for i, v in enumerate(rows, 1): ws.cell(i, 1, v)
    ws["A11"] = "#N/A"; ws["A11"].data_type = "e"
    ws["A12"] = "x" * 5000; ws["A13"] = "00123"; ws["A14"] = "1e5"; ws["A15"] = "TRUE"; ws["A16"] = "=not a formula"; ws["A16"].data_type = "s"
    ws["A17"] = "Ünïcødé ✓ 漢字"; ws["A18"] = "line one\nline two"
def r_values(wb, raw):
    ws = wb.worksheets[0]
    return {c.coordinate: [c.data_type, str(c.value)[:60], c.number_format if c.data_type in "nd" else ""] for row in ws.iter_rows() for c in row if c.value is not None}
feature("values")((g_values, r_values))

def g_formulas(wb):
    ws = wb.active; ws.title = "Main"; other = wb.create_sheet("Other data")
    numbers(ws); numbers(other)
    ws["B1"] = "=A1*2"; ws["B2"] = "=$A$1+A2"; ws["B3"] = "='Other data'!A3+1"; ws["B4"] = "=SUM(A:A)"; ws["B5"] = '=IF(A5>20,"big","small")'
    ws["B6"] = "=_xlfn.XLOOKUP(30,A1:A5,A1:A5)"; ws["B7"] = '=TEXT(A1,"0.00")'; ws["B8"] = "=SUMPRODUCT(A1:A5,A1:A5)"
    return {"Main!B1": 20, "Main!B2": 30, "Main!B3": 31, "Main!B4": 150, "Main!B5": "small", "Main!B6": 30, "Main!B7": "10.00", "Main!B8": 5500}
def formula_facts(wb, raw):
    vals = openpyxl.load_workbook(io.BytesIO(raw), data_only=True)
    out = {}
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                v = c.value.text if isinstance(c.value, ArrayFormula) else c.value
                if isinstance(v, str) and v.startswith("="):
                    out[f"{ws.title}!{c.coordinate}"] = [v, str(vals[ws.title][c.coordinate].value), c.value.ref if isinstance(c.value, ArrayFormula) else ""]
    return out
feature("formulas")((g_formulas, formula_facts))

def g_array(wb):
    ws = wb.active; numbers(ws)
    for r in range(1, 6): ws.cell(r, 2, r)
    ws["C1"] = ArrayFormula("C1", "=SUM(A1:A5*B1:B5)")
    return {"Sheet!C1": 550}
feature("array (CSE)")((g_array, formula_facts))

def g_spill(wb):
    ws = wb.active
    for r, v in enumerate([3, 1, 2, 3, 5], 1): ws.cell(r, 1, v)
    ws["C1"] = ArrayFormula("C1:C4", "=_xlfn.UNIQUE(A1:A5)")
    for r, v in enumerate([3, 1, 2, 5], 1): ws.cell(r, 3, v) if r > 1 else None
    ws["D1"] = ArrayFormula("D1:D3", "=_xlfn.SEQUENCE(3)")
    for r in (2, 3): ws.cell(r, 4, r)
    ws["E1"] = ArrayFormula("E1:E5", "=_xlfn._xlws.SORT(A1:A5)")
    for r, v in enumerate([1, 2, 3, 3, 5], 1): ws.cell(r, 5, v) if r > 1 else None
    return {"Sheet!C1": 3, "Sheet!D1": 1, "Sheet!E1": 1}
def r_spill(wb, raw):
    out = formula_facts(wb, raw)
    vals = openpyxl.load_workbook(io.BytesIO(raw), data_only=True).active
    for col in "CDE":
        for r in range(1, 6): out[f"value {col}{r}"] = str(vals[f"{col}{r}"].value)
    return out
feature("spilling formulas")((g_spill, r_spill))

def g_unknown(wb):
    ws = wb.active; numbers(ws)
    # As Excel writes them: an array formula of one cell (Excel adds the dynamic-array mark openpyxl cannot write).
    ws["B1"] = ArrayFormula("B1", "=_xlfn.LAMBDA(_xlpm.x,_xlpm.x*2)(A1)"); ws["B2"] = "=CELL(\"row\",A2)"; ws["B3"] = "=GETPIVOTDATA(\"x\",A1)"
    ws["B4"] = ArrayFormula("B4", '=_xlfn.LET(_xlpm.n,A4,_xlpm.label,"n",_xlpm.label&_xlpm.n)')
    return {"Sheet!B1": 20, "Sheet!B2": 2, "Sheet!B3": "#REF!", "Sheet!B4": "n40"}
feature("functions the engine lacks")((g_unknown, formula_facts))

def g_names(wb):
    ws = wb.active; numbers(ws)
    wb.defined_names["Rate"] = DefinedName("Rate", attr_text="Sheet!$A$2")
    wb.defined_names["Block"] = DefinedName("Block", attr_text="Sheet!$A$1:$A$5")
    ws["B1"] = "=Rate*2"; ws["B2"] = "=SUM(Block)"
    return {"Sheet!B1": 40, "Sheet!B2": 150}
def r_names(wb, raw):
    out = {f"name {n}": d.attr_text for n, d in wb.defined_names.items()}
    out.update(formula_facts(wb, raw)); return out
feature("defined names")((g_names, r_names))

FORMATS = ["0", "0.00", "#,##0", "#,##0.00", "0%", "0.00%", "0.00E+00", "mm-dd-yy", "d-mmm-yy", "h:mm AM/PM", "h:mm:ss", "m/d/yy h:mm", "@",
           '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)', "[$€-x-euro2] #,##0.00", '0.0" kg"', "[Red]-0.00;0.00", "yyyy-mm-dd", "# ?/?", "[h]:mm"]
def g_numfmt(wb):
    ws = wb.active
    for i, f in enumerate(FORMATS, 1): ws.cell(i, 1, 1234.5678).number_format = f
def r_numfmt(wb, raw):
    return {c.coordinate: c.number_format for c in wb.active["A"] if c.value is not None}
feature("number formats")((g_numfmt, r_numfmt))

def rgb(color): return (color.rgb or "")[-6:].upper() if color is not None and isinstance(color.rgb, str) else ""
def g_fonts(wb):
    ws = wb.active
    fonts = [Font(bold=True), Font(italic=True), Font(underline="single"), Font(strike=True), Font(color="FF0000"), Font(size=16), Font(name="Courier New"), Font(underline="double", bold=True)]
    for i, f in enumerate(fonts, 1): ws.cell(i, 1, f"f{i}").font = f
def r_fonts(wb, raw):
    return {c.coordinate: [bool(c.font.b), bool(c.font.i), c.font.u or "", bool(c.font.strike), rgb(c.font.color), c.font.sz or 11, c.font.name or "Calibri"] for c in wb.active["A"] if c.value}
feature("fonts")((g_fonts, r_fonts))

def g_fills(wb):
    ws = wb.active
    for i, color in enumerate(["FFFF00", "C6EFCE", "1F4E78"], 1): ws.cell(i, 1, i).fill = PatternFill("solid", fgColor=color)
    ws["A4"] = 4; ws["A4"].fill = PatternFill("darkGray", fgColor="FF0000", bgColor="FFFFFF")
def r_fills(wb, raw):
    return {c.coordinate: [c.fill.patternType or "", rgb(c.fill.fgColor)] for c in wb.active["A"] if c.value}
feature("fills")((g_fills, r_fills))

def g_borders(wb):
    ws = wb.active
    for i, style in enumerate(["thin", "medium", "thick", "dashed", "dotted", "double"], 1):
        s = Side(style=style, color="FF0000" if i % 2 else "000000"); ws.cell(i * 2, 2, i).border = Border(left=s, right=s, top=s, bottom=s)
    ws["D2"] = "diag"; ws["D2"].border = Border(bottom=Side(style="thin"), diagonal=Side(style="thin"), diagonalUp=True)
def r_borders(wb, raw):
    side = lambda s: f"{s.style}/{rgb(s.color).replace('000000', '')}" if s and s.style else ""  # black is Excel's automatic edge colour
    return {c.coordinate: [side(c.border.left), side(c.border.right), side(c.border.top), side(c.border.bottom), side(c.border.diagonal)] for row in wb.active.iter_rows() for c in row if c.value}
feature("borders")((g_borders, r_borders))

def g_align(wb):
    ws = wb.active
    al = [Alignment(horizontal="center"), Alignment(horizontal="right"), Alignment(vertical="top"), Alignment(wrap_text=True), Alignment(indent=2, horizontal="left"), Alignment(text_rotation=45), Alignment(text_rotation=90), Alignment(shrink_to_fit=True), Alignment(horizontal="centerContinuous")]
    for i, a in enumerate(al, 1): ws.cell(i, 1, f"a{i} some text").alignment = a
def r_align(wb, raw):
    return {c.coordinate: [c.alignment.horizontal or "", c.alignment.vertical or "", bool(c.alignment.wrap_text), c.alignment.indent, c.alignment.text_rotation, bool(c.alignment.shrink_to_fit)] for c in wb.active["A"] if c.value}
feature("alignment, wrap, indent, rotation")((g_align, r_align))

def g_sizes(wb):
    ws = wb.active
    for r in range(1, 9):
        for c in range(1, 6): ws.cell(r, c, r * c)
    ws.column_dimensions["B"].width = 30; ws.column_dimensions["C"].width = 4; ws.row_dimensions[2].height = 40; ws.row_dimensions[5].height = 8
    ws.column_dimensions["D"].hidden = True; ws.row_dimensions[4].hidden = True; ws.row_dimensions[7].hidden = True
    ws.freeze_panes = "B3"
def r_sizes(wb, raw):
    ws = wb.active
    out = {f"width {k}": round(d.width, 1) for k, d in ws.column_dimensions.items() if d.customWidth and k in "BC"}
    out.update({f"height {k}": d.height for k, d in ws.row_dimensions.items() if d.height and k in (2, 5)})
    out.update({f"hidden col {k}": True for k, d in ws.column_dimensions.items() if d.hidden})
    out.update({f"hidden row {k}": True for k, d in ws.row_dimensions.items() if d.hidden})
    out["freeze"] = ws.freeze_panes
    return out
feature("widths, heights, hidden, frozen")((g_sizes, r_sizes))

def g_merges(wb):
    ws = wb.active
    for r in range(1, 6): ws.cell(r, 1, r)
    ws["B1"] = "title"; ws.merge_cells("B1:D1"); ws["B3"] = "block"; ws.merge_cells("B3:C5")
def r_merges(wb, raw): return {str(m): True for m in wb.active.merged_cells.ranges}
feature("merges")((g_merges, r_merges))

def cf_book(rules):
    def gen(wb):
        ws = wb.active; numbers(ws, 10)
        for rng, rule in rules(): ws.conditional_formatting.add(rng, rule)
    return gen
def r_cf(wb, raw):
    out = {}
    for cf in wb.active.conditional_formatting:
        for i, rule in enumerate(cf.rules):
            dxf = rule.dxf
            out[f"{cf.sqref} {i}"] = [rule.type, rule.operator or "", list(rule.formula or []), rgb(dxf.fill.bgColor if dxf and dxf.fill else None).replace("000000", "") or rgb(dxf.fill.fgColor if dxf and dxf.fill else None).replace("000000", ""),
                                      dxf.numFmt.formatCode if dxf and dxf.numFmt else "", bool(dxf.font.b) if dxf and dxf.font else False, rule.rank or "", bool(rule.percent), bool(rule.stopIfTrue)]
            for part in ("colorScale", "dataBar", "iconSet"):
                got = getattr(rule, part)
                if got is not None: out[f"{cf.sqref} {i} {part}"] = [[v.type, str(v.val)] for v in got.cfvo] + ([rgb(c) for c in got.color] if part == "colorScale" else [rgb(got.color)] if part == "dataBar" else [got.iconSet])
    return out
red = DifferentialStyle(fill=PatternFill(bgColor="FFC7CE", fgColor="FFC7CE"), font=Font(bold=True))
feature("conditional: cell value")((cf_book(lambda: [("A1:A10", CellIsRule(operator="greaterThan", formula=["50"], fill=PatternFill(bgColor="FFC7CE", fgColor="FFC7CE"))), ("A1:A10", CellIsRule(operator="between", formula=["20", "30"], font=Font(bold=True)))]), r_cf))
feature("conditional: colour scale")((cf_book(lambda: [("A1:A10", ColorScaleRule(start_type="min", start_color="F8696B", mid_type="percentile", mid_value=50, mid_color="FFEB84", end_type="max", end_color="63BE7B"))]), r_cf))
feature("conditional: data bar")((cf_book(lambda: [("A1:A10", DataBarRule(start_type="min", end_type="max", color="638EC6"))]), r_cf))
feature("conditional: icon set")((cf_book(lambda: [("A1:A10", IconSetRule("3TrafficLights1", "percent", [0, 33, 67]))]), r_cf))
feature("conditional: formula")((cf_book(lambda: [("A1:A10", FormulaRule(formula=["MOD(A1,20)=0"], fill=PatternFill(bgColor="C6EFCE", fgColor="C6EFCE")))]), r_cf))
def top_rule():
    r = Rule(type="top10", rank=3, dxf=red); return [("A1:A10", r)]
feature("conditional: top 10")((cf_book(top_rule), r_cf))
def fmt_rule():
    r = Rule(type="cellIs", operator="greaterThan", formula=["50"], dxf=DifferentialStyle(numFmt=openpyxl.styles.numbers.NumberFormat(numFmtId=200, formatCode='0.0" big"'))); return [("A1:A10", r)]
feature("conditional: number format")((cf_book(fmt_rule), r_cf))

def g_dv(wb):
    ws = wb.active; numbers(ws, 4)
    for sqref, dv in [("B1:B10", DataValidation(type="list", formula1='"Yes,No,Maybe"', allow_blank=True)), ("C1:C10", DataValidation(type="list", formula1="$A$1:$A$4")),
                      ("D1:D10", DataValidation(type="whole", operator="between", formula1="1", formula2="10", showErrorMessage=True, error="1 to 10")),
                      ("E1:E10", DataValidation(type="date", operator="greaterThan", formula1="46023")), ("F1:F10", DataValidation(type="custom", formula1="ISNUMBER(F1)"))]:
        dv.add(sqref); ws.add_data_validation(dv)
def r_dv(wb, raw):
    return {str(dv.sqref): [dv.type, dv.operator or "", dv.formula1, dv.formula2 or "", bool(dv.allow_blank), dv.error or ""] for dv in wb.active.data_validations.dataValidation}
feature("data validations")((g_dv, r_dv))

def g_links(wb):
    ws = wb.active
    ws["A1"] = "site"; ws["A1"].hyperlink = "https://example.com/page"; ws["A2"] = "mail"; ws["A2"].hyperlink = "mailto:someone@example.com"
    ws["A3"] = "inside"; ws["A3"].hyperlink = openpyxl.worksheet.hyperlink.Hyperlink(ref="A3", location="Sheet!B5")
    ws["A4"] = '=HYPERLINK("https://example.com","fn")'
    return {"Sheet!A4": "fn"}
def r_links(wb, raw):
    out = {c.coordinate: [c.hyperlink.target or "", c.hyperlink.location or ""] for c in wb.active["A"] if c.hyperlink}
    out.update(formula_facts(wb, raw)); return out
feature("hyperlinks")((g_links, r_links))

def g_notes(wb):
    ws = wb.active; numbers(ws, 3)
    ws["A1"].comment = Comment("Check this number", "Ann"); ws["A3"].comment = Comment("Second note\nwith two lines", "Bob")
def r_notes(wb, raw): return {c.coordinate: c.comment.text for c in wb.active["A"] if c.comment}
feature("notes")((g_notes, r_notes))

TC = "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"
G = lambda kind, n: "{6A9F1C2E-%s-4000-8000-00000000000%d}" % (kind, n)  # Excel reads only real GUIDs here
THREADS = [("A1", G("0001", 1), G("0002", 1), None, "Is this right?"), ("A1", G("0001", 2), G("0002", 2), G("0001", 1), "Yes, checked."), ("A2", G("0001", 3), G("0002", 2), None, "Source: @Ann")]
def g_threads(wb):
    ws = wb.active; numbers(ws, 3)
    for ref, tid, _, parent, text in THREADS:
        if not parent: ws[ref].comment = Comment(f"[Threaded comment]\n\nYour version of Excel allows you to read this threaded comment.\n\nComment:\n    {text}", f"tc={tid}")
def post_threads(parts):
    """Excel's own parts for threaded comments, which openpyxl cannot write: the threads, the people, and their links."""
    parts["xl/threadedComments/threadedComment1.xml"] = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<ThreadedComments xmlns="{TC}" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + "".join('<threadedComment ref="%s" dT="2026-03-0%dT09:15:00.00" personId="%s" id="%s"%s%s><text>%s</text></threadedComment>' % (ref, i + 4, pid, tid, ' parentId="%s"' % parent if parent else "", ' done="1"' if i == 1 else "", text) for i, (ref, tid, pid, parent, text) in enumerate(THREADS)) + "</ThreadedComments>").encode()
    parts["xl/persons/person.xml"] = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<personList xmlns="{TC}" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><person displayName="Ann Lee" id="%s" userId="ann@example.com" providerId="None"/><person displayName="Bob Ng" id="%s" userId="bob@example.com" providerId="None"/></personList>' % (G("0002", 1), G("0002", 2))).encode()
    rel = lambda part, rid, kind, target: parts.__setitem__(part, parts[part].decode().replace("</Relationships>", f'<Relationship Id="{rid}" Type="http://schemas.microsoft.com/office/2017/10/relationships/{kind}" Target="{target}"/></Relationships>').encode())
    rel("xl/worksheets/_rels/sheet1.xml.rels", "rIdTc", "threadedComment", "/xl/threadedComments/threadedComment1.xml"); rel("xl/_rels/workbook.xml.rels", "rIdPeople", "person", "persons/person.xml")
    types = parts["[Content_Types].xml"].decode().replace("</Types>", '<Override PartName="/xl/threadedComments/threadedComment1.xml" ContentType="application/vnd.ms-excel.threadedcomments+xml"/><Override PartName="/xl/persons/person.xml" ContentType="application/vnd.ms-excel.person+xml"/></Types>')
    parts["[Content_Types].xml"] = types.encode()
def r_threads(wb, raw):
    z = zipfile.ZipFile(io.BytesIO(raw)); names = z.namelist()
    people = {m.group(2): m.group(1) for n in names if n.startswith("xl/persons/") for m in re.finditer(r'<person displayName="([^"]*)" id="([^"]*)"', z.read(n).decode())}
    out = {}
    for n in sorted(n for n in names if n.startswith("xl/threadedComments/")):
        for i, m in enumerate(re.finditer(r"<threadedComment\b([^>]*)><text>([^<]*)</text>", z.read(n).decode())):
            a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
            out[f"{a.get('ref')} {i}"] = [m.group(2), a.get("dT"), people.get(a.get("personId"), "?"), "parentId" in a, a.get("done", "")]
    out.update({f"note {c.coordinate}": c.comment.author for c in wb.active["A"] if c.comment})
    return out
feature("threaded comments")((g_threads, r_threads))
POST = {"threaded comments": post_threads}

def g_table(wb):
    ws = wb.active
    ws.append(["Name", "Qty", "Price"])
    for row in [["a", 1, 2.5], ["b", 2, 3.5], ["c", 3, 4.5]]: ws.append(row)
    t = Table(displayName="Sales", ref="A1:C4"); t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium9", showRowStripes=True); ws.add_table(t)
def r_table(wb, raw): return {f"table {n}": [t.ref, t.tableStyleInfo.name if t.tableStyleInfo else ""] for n, t in ((t.displayName, t) for t in wb.active.tables.values())}
feature("tables")((g_table, r_table))

def g_filter(wb):
    ws = wb.active; ws.append(["k", "v"])
    for i in range(1, 6): ws.append([f"k{i}", i])
    ws.auto_filter.ref = "A1:B6"
def r_filter(wb, raw): return {"autofilter": wb.active.auto_filter.ref or ""}
feature("autofilter")((g_filter, r_filter))

def g_conditions(wb):
    from openpyxl.worksheet.filters import CustomFilter, CustomFilters, FilterColumn, Filters
    ws = wb.active; ws.append(["key", "n", "day", "text", "pick"])
    for i in range(1, 9): ws.append([f"k{i}", i, datetime.datetime(2026, 1, i * 3), f"x{'ab' if i % 2 else 'cd'}y", "a" if i % 3 else ""])
    for r in range(2, 10): ws.cell(r, 3).number_format = "yyyy-mm-dd"
    ws.auto_filter.ref = "A1:E9"
    custom = lambda *pairs, both=False: CustomFilters(_and=both, customFilter=[CustomFilter(operator=o, val=v) for o, v in pairs])
    for col in [FilterColumn(colId=0, filters=Filters(filter=["k1", "k3", "k5"])), FilterColumn(colId=1, customFilters=custom(("greaterThan", "2"))),
                FilterColumn(colId=2, customFilters=custom(("greaterThanOrEqual", "46027"), ("lessThanOrEqual", "46040"), both=True)),
                FilterColumn(colId=3, customFilters=custom(("equal", "*ab*"))), FilterColumn(colId=4, filters=Filters(blank=True))]: ws.auto_filter.filterColumn.append(col)
def r_conditions(wb, raw):
    out = {}
    for col in wb.active.auto_filter.filterColumn:
        f, c = col.filters, col.customFilters
        out[f"column {col.colId}"] = [sorted(f.filter) if f else [], bool(f and f.blank), [[x.operator or "equal", x.val] for x in c.customFilter] if c else [], bool(c and c._and)]
    return out
feature("filter conditions")((g_conditions, r_conditions))

def g_charts(wb):
    ws = wb.active; ws.append(["m", "a", "b"])
    for i in range(1, 7): ws.append([f"m{i}", i, i * 2])
    for i, kind in enumerate([BarChart, LineChart, PieChart]):
        ch = kind(); ch.title = f"c{i}"; data = Reference(ws, min_col=2, min_row=1, max_row=7, max_col=2 if kind is PieChart else 3)
        ch.add_data(data, titles_from_data=True); ch.set_categories(Reference(ws, min_col=1, min_row=2, max_row=7)); ws.add_chart(ch, f"E{1 + i * 16}")
def r_charts(wb, raw):
    z = zipfile.ZipFile(io.BytesIO(raw)); out = {}
    for name in sorted(n for n in z.namelist() if re.match(r"xl/charts/chart\d+\.xml$", n)):
        xml = z.read(name).decode()
        kind = re.search(r"<(?:c:)?(bar|line|pie|area|scatter)Chart>", xml); refs = re.findall(r"<(?:c:)?f>([^<]+)</(?:c:)?f>", xml)
        dir_ = re.search(r'barDir val="(\w+)"', xml)
        out[f"chart {len(out) + 1}"] = [kind.group(1) if kind else "?", dir_.group(1) if dir_ else "", sorted(set(r.replace("'", "").replace("$", "") for r in refs))]
    return out
feature("charts")((g_charts, r_charts))

def g_image(wb):
    from PIL import Image
    ws = wb.active; ws["A1"] = 1; buf = io.BytesIO(); Image.new("RGB", (20, 20), "red").save(buf, "PNG"); ws.add_image(XImage(buf), "C3")
def r_image(wb, raw):
    z = zipfile.ZipFile(io.BytesIO(raw)); out = {f"media {i}": len(z.read(n)) for i, n in enumerate(n for n in z.namelist() if n.startswith("xl/media/"))}
    for n in (n for n in z.namelist() if re.match(r"xl/drawings/drawing\d+\.xml$", n)):
        for i, m in enumerate(re.finditer(r"<(?:\w+:)?from><(?:\w+:)?col>(\d+)</(?:\w+:)?col>.*?<(?:\w+:)?row>(\d+)<.*?<(?:\w+:)?ext cx=\"(\d+)\" cy=\"(\d+)\"", z.read(n).decode())): out[f"anchor {i}"] = list(m.groups())
    return out
feature("images")((g_image, r_image))

def g_tabs(wb):
    ws = wb.active; ws.title = "Q1 2026 (draft)"; ws["A1"] = 1
    for name, color, state in [("O'Brien & Co", "FF0000", "visible"), ("Résumé", "00B050", "visible"), ("Secret", None, "hidden"), ("1234", None, "visible")]:
        s = wb.create_sheet(name); s["A1"] = name; s.sheet_state = state
        if color: s.sheet_properties.tabColor = color
    ws["B1"] = "='O''Brien & Co'!A1"
    return {"Q1 2026 (draft)!B1": "O'Brien & Co"}
def r_tabs(wb, raw):
    out = {f"tab {i}": [s.title, s.sheet_state, rgb(s.sheet_properties.tabColor)] for i, s in enumerate(wb.worksheets)}
    out.update(formula_facts(wb, raw)); return out
feature("tabs: names, colours, hidden")((g_tabs, r_tabs))

def g_print(wb):
    ws = wb.active; numbers(ws, 30)
    ws.page_setup.orientation = "landscape"; ws.page_setup.paperSize = ws.PAPERSIZE_A4; ws.page_setup.fitToWidth = 1; ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_area = "A1:A30"; ws.print_title_rows = "1:1"; ws.oddHeader.center.text = "Report"; ws.page_margins.left = 0.3
def r_print(wb, raw):
    ws = wb.active
    return {"orientation": ws.page_setup.orientation, "paper": ws.page_setup.paperSize, "fit": bool(ws.sheet_properties.pageSetUpPr and ws.sheet_properties.pageSetUpPr.fitToPage),
            "area": str(ws.print_area), "titles": str(ws.print_title_rows), "header": ws.oddHeader.center.text, "margin": ws.page_margins.left}
feature("print settings")((g_print, r_print))

def g_protect(wb):
    ws = wb.active; ws["A1"] = 1; wb.security = WorkbookProtection(lockStructure=True); ws.protection.sheet = True
def r_protect(wb, raw): return {"workbook structure": bool(wb.security and wb.security.lockStructure), "sheet": bool(wb.active.protection.sheet)}
feature("protection")((g_protect, r_protect))

NOT_T = re.compile(r' t="\w+"')
def cached(path, cache, post=None):
    """Each formula's value as Excel keeps it beside the formula (openpyxl writes none), and parts openpyxl cannot write (`post`)."""
    z = zipfile.ZipFile(path); parts = {n: z.read(n) for n in z.namelist()}; z.close()
    if post: post(parts)
    book = parts["xl/workbook.xml"].decode(); rels = parts["xl/_rels/workbook.xml.rels"].decode()
    for key, value in cache.items():
        tab, at = key.rsplit("!", 1)
        rid = re.search(r'<sheet [^>]*name="%s"[^>]*r:id="(\w+)"' % re.escape(tab.replace("&", "&amp;").replace("'", "&apos;")), book) or re.search(r'<sheet [^>]*name="%s"[^>]*r:id="(\w+)"' % re.escape(tab.replace("&", "&amp;")), book)
        tag = next(t for t in re.findall(r"<Relationship [^>]*>", rels) if 'Id="%s"' % rid.group(1) in t)
        target = "xl/" + re.search(r'Target="/?(?:xl/)?([^"]+)"', tag).group(1)
        t = "b" if isinstance(value, bool) else "n" if isinstance(value, (int, float)) else "e" if str(value).startswith("#") else "str"
        v = ("1" if value else "0") if t == "b" else str(value).replace("&", "&amp;").replace("<", "&lt;")
        xml = parts[target].decode()
        xml, n = re.subn(r'<c r="%s"([^>]*)>(<f[^>]*>.*?</f>|<f[^>]*/>)<v\s*/>' % at, lambda m: '<c r="%s"%s t="%s">%s<v>%s</v>' % (at, NOT_T.sub("", m.group(1)), t, m.group(2), v), xml)
        assert n == 1, key
        parts[target] = xml.encode()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for n, b in parts.items(): z.writestr(n, b)

if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] not in ("gen", "read") or (sys.argv[1] == "read" and len(sys.argv) < 4):
        print(USAGE); sys.exit(2)
    if sys.argv[1] == "gen":
        names = {}
        for i, (name, (gen, _)) in enumerate(F.items()):
            wb = openpyxl.Workbook(); cache = gen(wb) or {}; path = f"{sys.argv[2]}/{i:02d}.xlsx"; wb.save(path); cached(path, cache, POST.get(name)); names[f"{i:02d}"] = name
        print(json.dumps(names))
    else:
        raw = open(sys.argv[2], "rb").read(); wb = openpyxl.load_workbook(io.BytesIO(raw))
        print(json.dumps(F[sys.argv[3]][1](wb, raw), default=str))
