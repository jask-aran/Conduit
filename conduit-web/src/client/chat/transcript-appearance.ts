import { createSignal } from "solid-js";
import { CODE_BLOCK_COLLAPSE_DEFAULT_LINES, CODE_BLOCK_COLLAPSE_LINE_OPTIONS, type CodeBlockCollapseMode } from "./code-block";
import "./code-block.css";
import "./transcript-appearance.css";

/**
 * Reading-surface preferences: how wide the transcript column is, how far wide
 * blocks may bleed past it, and how code blocks collapse.
 *
 * All four are presets rather than free values. The shell scales its whole
 * geometry by density and by container width, so a raw pixel preference would
 * not survive either; a named preset resolves through CSS custom properties and
 * stays correct at every size.
 */

export type TranscriptWidthMode = "compact" | "default" | "wide" | "full";
export type TranscriptWideBlocksMode = "off" | "default" | "wider" | "full";
export type CodeBlockWidthMode = "column" | "wide";

export const TRANSCRIPT_WIDTH_STORAGE_KEY = "conduit:transcript-width";
export const TRANSCRIPT_WIDE_BLOCKS_STORAGE_KEY = "conduit:transcript-wide-blocks";
export const CODE_BLOCK_COLLAPSE_STORAGE_KEY = "conduit:code-block-collapse";
export const CODE_BLOCK_COLLAPSE_LINES_STORAGE_KEY = "conduit:code-block-collapse-lines";
export const CODE_BLOCK_WIDTH_STORAGE_KEY = "conduit:code-block-width";

export const TRANSCRIPT_WIDTH_OPTIONS: ReadonlyArray<{ value: TranscriptWidthMode; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "default", label: "Default" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full width" },
];

export const TRANSCRIPT_WIDE_BLOCKS_OPTIONS: ReadonlyArray<{ value: TranscriptWideBlocksMode; label: string }> = [
  { value: "off", label: "Off" },
  { value: "default", label: "Default" },
  { value: "wider", label: "Wider" },
  { value: "full", label: "Full width" },
];

export const CODE_BLOCK_COLLAPSE_OPTIONS: ReadonlyArray<{ value: CodeBlockCollapseMode; label: string }> = [
  { value: "off", label: "Never" },
  { value: "long", label: "Long blocks" },
  { value: "all", label: "Always" },
];

export const CODE_BLOCK_COLLAPSE_LINE_CHOICES = CODE_BLOCK_COLLAPSE_LINE_OPTIONS;

export const CODE_BLOCK_WIDTH_OPTIONS: ReadonlyArray<{ value: CodeBlockWidthMode; label: string }> = [
  { value: "column", label: "Reading column" },
  { value: "wide", label: "Wide" },
];

const TRANSCRIPT_WIDTHS = new Set<string>(TRANSCRIPT_WIDTH_OPTIONS.map((option) => option.value));
const CODE_BLOCK_WIDTHS = new Set<string>(CODE_BLOCK_WIDTH_OPTIONS.map((option) => option.value));
const WIDE_BLOCKS = new Set<string>(TRANSCRIPT_WIDE_BLOCKS_OPTIONS.map((option) => option.value));
const COLLAPSE_MODES = new Set<string>(CODE_BLOCK_COLLAPSE_OPTIONS.map((option) => option.value));

const publish = (key: string, value: unknown) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("conduit:ui-preference-change", { detail: { key, value } }));
};

const param = (name: string) => {
  if (typeof location === "undefined") return null;
  return new URLSearchParams(location.search).get(name);
};

export function isTranscriptWidthMode(value: unknown): value is TranscriptWidthMode {
  return typeof value === "string" && TRANSCRIPT_WIDTHS.has(value);
}

export function isTranscriptWideBlocksMode(value: unknown): value is TranscriptWideBlocksMode {
  return typeof value === "string" && WIDE_BLOCKS.has(value);
}

export function isCodeBlockCollapseMode(value: unknown): value is CodeBlockCollapseMode {
  return typeof value === "string" && COLLAPSE_MODES.has(value);
}

export function isCodeBlockWidthMode(value: unknown): value is CodeBlockWidthMode {
  return typeof value === "string" && CODE_BLOCK_WIDTHS.has(value);
}

export function selectedCodeBlockWidth(storage: Pick<Storage, "getItem"> = localStorage): CodeBlockWidthMode {
  const override = param("codeBlockWidth");
  if (isCodeBlockWidthMode(override)) return override;
  const stored = storage.getItem(CODE_BLOCK_WIDTH_STORAGE_KEY);
  // A code block left wide by default dominates the page, so the reading
  // column is the default and Wide is the opt-in.
  return isCodeBlockWidthMode(stored) ? stored : "column";
}

export function saveCodeBlockWidth(
  mode: CodeBlockWidthMode,
  storage: Pick<Storage, "setItem"> = localStorage,
): CodeBlockWidthMode {
  const selected = isCodeBlockWidthMode(mode) ? mode : "column";
  storage.setItem(CODE_BLOCK_WIDTH_STORAGE_KEY, selected);
  publish("codeBlockWidth", selected);
  return selected;
}

export function isCodeBlockCollapseLines(value: unknown): value is number {
  return typeof value === "number" && (CODE_BLOCK_COLLAPSE_LINE_OPTIONS as readonly number[]).includes(value);
}

export function selectedTranscriptWidth(storage: Pick<Storage, "getItem"> = localStorage): TranscriptWidthMode {
  const override = param("transcriptWidth");
  if (isTranscriptWidthMode(override)) return override;
  const stored = storage.getItem(TRANSCRIPT_WIDTH_STORAGE_KEY);
  return isTranscriptWidthMode(stored) ? stored : "default";
}

export function saveTranscriptWidth(
  mode: TranscriptWidthMode,
  storage: Pick<Storage, "setItem"> = localStorage,
): TranscriptWidthMode {
  const selected = isTranscriptWidthMode(mode) ? mode : "default";
  storage.setItem(TRANSCRIPT_WIDTH_STORAGE_KEY, selected);
  publish("transcriptWidth", selected);
  return selected;
}

export function selectedTranscriptWideBlocks(storage: Pick<Storage, "getItem"> = localStorage): TranscriptWideBlocksMode {
  const override = param("transcriptWideBlocks");
  if (isTranscriptWideBlocksMode(override)) return override;
  const stored = storage.getItem(TRANSCRIPT_WIDE_BLOCKS_STORAGE_KEY);
  return isTranscriptWideBlocksMode(stored) ? stored : "default";
}

export function saveTranscriptWideBlocks(
  mode: TranscriptWideBlocksMode,
  storage: Pick<Storage, "setItem"> = localStorage,
): TranscriptWideBlocksMode {
  const selected = isTranscriptWideBlocksMode(mode) ? mode : "default";
  storage.setItem(TRANSCRIPT_WIDE_BLOCKS_STORAGE_KEY, selected);
  publish("transcriptWideBlocks", selected);
  return selected;
}

export function selectedCodeBlockCollapse(storage: Pick<Storage, "getItem"> = localStorage): CodeBlockCollapseMode {
  const override = param("codeBlockCollapse");
  if (isCodeBlockCollapseMode(override)) return override;
  const stored = storage.getItem(CODE_BLOCK_COLLAPSE_STORAGE_KEY);
  return isCodeBlockCollapseMode(stored) ? stored : "long";
}

export function saveCodeBlockCollapse(
  mode: CodeBlockCollapseMode,
  storage: Pick<Storage, "setItem"> = localStorage,
): CodeBlockCollapseMode {
  const selected = isCodeBlockCollapseMode(mode) ? mode : "long";
  storage.setItem(CODE_BLOCK_COLLAPSE_STORAGE_KEY, selected);
  publish("codeBlockCollapse", selected);
  return selected;
}

export function selectedCodeBlockCollapseLines(storage: Pick<Storage, "getItem"> = localStorage): number {
  const override = Number(param("codeBlockCollapseLines"));
  if (isCodeBlockCollapseLines(override)) return override;
  const stored = Number(storage.getItem(CODE_BLOCK_COLLAPSE_LINES_STORAGE_KEY));
  return isCodeBlockCollapseLines(stored) ? stored : CODE_BLOCK_COLLAPSE_DEFAULT_LINES;
}

export function saveCodeBlockCollapseLines(
  lines: number,
  storage: Pick<Storage, "setItem"> = localStorage,
): number {
  const selected = isCodeBlockCollapseLines(lines) ? lines : CODE_BLOCK_COLLAPSE_DEFAULT_LINES;
  storage.setItem(CODE_BLOCK_COLLAPSE_LINES_STORAGE_KEY, String(selected));
  publish("codeBlockCollapseLines", selected);
  return selected;
}

/**
 * Stamp the presets onto the document root. CSS resolves everything from there,
 * so changing a preference never re-renders a message.
 */
export function applyTranscriptAppearance(options: {
  width?: TranscriptWidthMode;
  wideBlocks?: TranscriptWideBlocksMode;
  collapse?: CodeBlockCollapseMode;
  collapseLines?: number;
  codeWidth?: CodeBlockWidthMode;
}, root: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement) {
  if (!root) return;
  if (options.codeWidth) root.dataset.codeWidth = options.codeWidth;
  if (options.width) root.dataset.transcriptWidth = options.width;
  if (options.wideBlocks) root.dataset.transcriptWide = options.wideBlocks;
  if (options.collapse) root.dataset.codeCollapse = options.collapse;
  if (options.collapseLines) root.style.setProperty("--code-collapse-lines", String(options.collapseLines));
}

/**
 * Reactive view of the collapse preference for the JSX renderers.
 *
 * The signals are module-level singletons behind one listener. Code blocks
 * mount and unmount constantly while a message streams, and giving each card
 * its own window listener would churn subscriptions on the hot path for a
 * preference that changes only when someone opens Settings.
 *
 * The marked renderers emit HTML strings and cannot track this, so they read
 * the preference once at render time and rely on syncCodeBlockCollapse.
 */
const [collapseMode, setCollapseMode] = createSignal<CodeBlockCollapseMode>(selectedCodeBlockCollapse());
const [collapseThreshold, setCollapseThreshold] = createSignal(selectedCodeBlockCollapseLines());

if (typeof window !== "undefined") {
  window.addEventListener("conduit:ui-preference-change", (event) => {
    const detail = (event as CustomEvent<{ key?: string; value?: unknown }>).detail;
    if (detail?.key === "codeBlockCollapse" && isCodeBlockCollapseMode(detail.value)) setCollapseMode(detail.value);
    else if (detail?.key === "codeBlockCollapseLines" && isCodeBlockCollapseLines(detail.value)) setCollapseThreshold(detail.value);
  });
}

export function useCodeBlockCollapse() {
  return { mode: collapseMode, threshold: collapseThreshold };
}
