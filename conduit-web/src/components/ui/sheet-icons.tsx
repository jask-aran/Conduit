import { ChartAreaIcon, ChartBarIcon, ChartColumnIcon, ChartLineIcon, ChartPieIcon, ChartScatterIcon } from "lucide-solid";
import { ArrowRightToLineIcon, PaintbrushIcon, ArrowDownAZIcon, ArrowDownZAIcon, FunnelIcon, Table2Icon, TableCellsMergeIcon, TableCellsSplitIcon,ArrowDownFromLineIcon, ArrowDownToLineIcon, ArrowRightFromLineIcon, ArrowUpToLineIcon, BaselineIcon, BoldIcon, DecimalsArrowLeftIcon, DecimalsArrowRightIcon, FoldVerticalIcon, Grid2x2Icon, HashIcon, ItalicIcon, PaintBucketIcon, RemoveFormattingIcon, StrikethroughIcon, TextAlignCenterIcon, TextAlignEndIcon, TextAlignStartIcon, TypeIcon, UnderlineIcon, WrapTextIcon } from "lucide-solid";
import { MoveRightIcon } from "lucide-solid";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, CalendarIcon, ChevronDownCircleIcon, ListIcon, SquareCheckIcon } from "lucide-solid";

/** A sheet's edit tools on its ribbon (components/sheet/tools.tsx), by tool, and by choice where a tool's choices each have a mark. */
export const sheetToolIcons = {
  bold: BoldIcon, italic: ItalicIcon, underline: UnderlineIcon, strike: StrikethroughIcon, wrap: WrapTextIcon, clip: ArrowRightToLineIcon, overflow: MoveRightIcon, paint: PaintbrushIcon, "text-style": TypeIcon, clear: RemoveFormattingIcon, "spread-down": ArrowDownFromLineIcon, "spread-right": ArrowRightFromLineIcon, color: BaselineIcon, fill: PaintBucketIcon, borders: Grid2x2Icon, format: HashIcon,
  "align-left": TextAlignStartIcon, "align-center": TextAlignCenterIcon, "align-right": TextAlignEndIcon, "valign-top": ArrowUpToLineIcon, "valign-middle": FoldVerticalIcon, "valign-bottom": ArrowDownToLineIcon,
  "decimals-more": DecimalsArrowRightIcon, "decimals-fewer": DecimalsArrowLeftIcon,
};

/** The sheet's sort, filter and table rows (context menu, filter popover). */
export const sheetSortIcons = { ascending: ArrowDownAZIcon, descending: ArrowDownZAIcon, filter: FunnelIcon, table: Table2Icon };
/** The sheet's chart kinds (the ribbon's Chart menu, the context menu's Make chart). */
export const sheetChartIcons = { bar: ChartBarIcon, column: ChartColumnIcon, line: ChartLineIcon, area: ChartAreaIcon, pie: ChartPieIcon, scatter: ChartScatterIcon };
/** The sheet's merge rows (context menu). */
export const sheetMergeIcons = { merge: TableCellsMergeIcon, unmerge: TableCellsSplitIcon };
/** The cell menu's moves of rows and columns, and its cell types (components/sheet/sheet.tsx). */
export const sheetLineIcons = { up: ArrowUpIcon, down: ArrowDownIcon, left: ArrowLeftIcon, right: ArrowRightIcon, type: ListIcon, dropdown: ChevronDownCircleIcon, checkbox: SquareCheckIcon, date: CalendarIcon };
