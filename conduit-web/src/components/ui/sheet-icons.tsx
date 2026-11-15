import { ArrowDownToLineIcon, ArrowUpToLineIcon, BaselineIcon, BoldIcon, DecimalsArrowLeftIcon, DecimalsArrowRightIcon, FoldVerticalIcon, Grid2x2Icon, HashIcon, ItalicIcon, PaintBucketIcon, StrikethroughIcon, TextAlignCenterIcon, TextAlignEndIcon, TextAlignStartIcon, UnderlineIcon, WrapTextIcon } from "lucide-solid";

/** A sheet's edit tools on its ribbon (components/sheet/tools.tsx), by tool, and by choice where a tool's choices each have a mark. */
export const sheetToolIcons = {
  bold: BoldIcon, italic: ItalicIcon, underline: UnderlineIcon, strike: StrikethroughIcon, wrap: WrapTextIcon, color: BaselineIcon, fill: PaintBucketIcon, borders: Grid2x2Icon, format: HashIcon,
  "align-left": TextAlignStartIcon, "align-center": TextAlignCenterIcon, "align-right": TextAlignEndIcon, "valign-top": ArrowUpToLineIcon, "valign-middle": FoldVerticalIcon, "valign-bottom": ArrowDownToLineIcon,
  "decimals-more": DecimalsArrowRightIcon, "decimals-fewer": DecimalsArrowLeftIcon,
};
