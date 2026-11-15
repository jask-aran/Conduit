// The sheet's formula engine, off the page's thread: the page's createSheetView (sheet-format.js) posts it the doc and draws what it computes.
import { serveSheetModel } from "@/sheet-engine.js";
import type { SheetPort } from "@/sheet-format.js";

// A worker's global scope, which the project's types (the page's) know as a window.
serveSheetModel(self as unknown as SheetPort);
