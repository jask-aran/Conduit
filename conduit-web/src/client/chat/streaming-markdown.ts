import { inlineDollarClose } from "./inline-dollar.ts";
export type StreamingPendingKind = "math-block" | "math-inline" | "fence";

export type StreamingPending = {
  kind: StreamingPendingKind;
  start: number;
  body: string;
  opening?: "$" | "$$" | "\\(" | "\\[";
  language?: string;
};

export type StreamingMarkdownSplit = {
  stable: string;
  pending: StreamingPending | null;
};

export type StreamingMarkdownOptions = {
  tableMath?: boolean;
  /** Keep an incomplete math tail visible only while the provider is streaming. */
  allowUnclosedMath?: boolean;
};

type SourceRange = { start: number; end: number };
type FenceState = {
  start: number;
  contentStart: number;
  marker: string;
  language?: string;
};

function sourceLines(source: string) {
  const lines: Array<{ start: number; end: number; text: string }> = [];
  let start = 0;
  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline < 0 ? source.length : newline + 1;
    const raw = source.slice(start, end);
    lines.push({
      start,
      end,
      text: raw.replace(/\r?\n$/, ""),
    });
    start = end;
  }
  return lines;
}

function trimOpeningLineBreak(value: string) {
  return value.replace(/^\r?\n/, "");
}

function scanFences(source: string) {
  const ranges: SourceRange[] = [];
  let open: FenceState | null = null;

  for (const line of sourceLines(source)) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (!match) continue;
    const marker = match[1]!;
    if (!open) {
      const info = match[2]!.trim().split(/\s+/, 1)[0] || undefined;
      open = {
        start: line.start,
        contentStart: line.end,
        marker,
        language: info,
      };
      continue;
    }
    // The opening pattern already consumed the whole marker run and the
    // leading indent, so a closing fence is one whose remainder is blank.
    // Building a RegExp per candidate line re-compiled it for every streamed
    // update of every fence in the message.
    const closes = marker[0] === open.marker[0]
      && marker.length >= open.marker.length
      && match[2]!.trim() === "";
    if (closes) {
      ranges.push({ start: open.start, end: line.end });
      open = null;
    }
  }

  return { ranges, open };
}

function inRange(offset: number, ranges: SourceRange[]) {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

function findOpenBlockMath(source: string, ranges: SourceRange[]) {
  let open: { start: number; bodyStart: number; close: string } | null = null;

  for (const line of sourceLines(source)) {
    if (inRange(line.start, ranges)) continue;
    if (!open) {
      const match = /^ {0,3}(\$\$|\\\[)(.*)$/.exec(line.text);
      if (!match) continue;
      const delimiter = match[1]!;
      const delimiterOffset = match[0].indexOf(delimiter);
      const rest = match[2]!;
      const close = delimiter === "$$" ? "$$" : "\\]";
      if (findUnescapedDelimiter(rest, close, 0) >= 0) continue;
      open = {
        start: line.start + delimiterOffset,
        bodyStart: line.start + delimiterOffset + delimiter.length,
        close,
      };
      continue;
    }

    const close = findUnescapedDelimiter(line.text, open.close, 0);
    if (close >= 0 && /^\s*$/.test(line.text.slice(close + open.close.length))) open = null;
  }

  return open;
}

function isTableDelimiterLine(line: string) {
  const value = line.trim();
  if (!value.includes("|")) return false;
  const cells = value.replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length >= 2 && cells.every((cell) => /^\s*:?-{1,}:?\s*$/.test(cell));
}

function tableRowMask(source: string) {
  const lines = sourceLines(source);
  const mask = lines.map(() => false);
  for (let index = 0; index < lines.length; index += 1) {
    if (!isTableDelimiterLine(lines[index]!.text)) continue;
    let before = index - 1;
    while (before >= 0 && lines[before]!.text.trim().includes("|")) before -= 1;
    let after = index + 1;
    while (after < lines.length && lines[after]!.text.trim().includes("|")) after += 1;
    for (let cursor = before + 1; cursor < after; cursor += 1) {
      if (cursor !== index) mask[cursor] = true;
    }
  }
  return { lines, mask };
}

function findOpenTableCellMath(source: string, ranges: SourceRange[]) {
  const table = tableRowMask(source);
  for (let lineIndex = 0; lineIndex < table.lines.length; lineIndex += 1) {
    const line = table.lines[lineIndex]!;
    if (!table.mask[lineIndex] || inRange(line.start, ranges)) continue;
    let codeDelimiter = 0;
    for (let index = 0; index < line.text.length; index += 1) {
      if (line.text[index] === "`" && !isEscaped(line.text, index)) {
        let end = index;
        while (line.text[end] === "`") end += 1;
        const length = end - index;
        if (!codeDelimiter) codeDelimiter = length;
        else if (codeDelimiter === length) codeDelimiter = 0;
        index = end - 1;
        continue;
      }
      if (codeDelimiter || isEscaped(line.text, index)) continue;
      if (line.text.startsWith("$$", index)) {
        const close = findUnescapedDelimiter(line.text, "$$", index + 2);
        if (close < 0) return { start: line.start + index, bodyStart: line.start + index + 2, opening: "$$" as const, kind: "math-block" as const };
        index = close + 1;
        continue;
      }
      if (line.text.startsWith("\\[", index)) {
        const close = findUnescapedDelimiter(line.text, "\\]", index + 2);
        if (close < 0) return { start: line.start + index, bodyStart: line.start + index + 2, opening: "\\[" as const, kind: "math-block" as const };
        index = close + 1;
        continue;
      }
      if (line.text.startsWith("\\(", index)) {
        const close = findUnescapedDelimiter(line.text, "\\)", index + 2);
        if (close < 0) return { start: line.start + index, bodyStart: line.start + index + 2, opening: "\\(" as const, kind: "math-inline" as const };
        index = close + 1;
        continue;
      }
      const nextCharacter = line.text[index + 1];
      const loneCellOpening = nextCharacter === undefined && /\|\s*$/.test(line.text.slice(0, index));
      if (line.text[index] === "$" && nextCharacter !== "$" && (loneCellOpening || (nextCharacter && !/[\s\d]/.test(nextCharacter)))) {
        let close = -1;
        for (let cursor = index + 1; cursor < line.text.length; cursor += 1) {
          if (line.text[cursor] !== "$" || line.text[cursor + 1] === "$" || isEscaped(line.text, cursor)) continue;
          if (/\s/.test(line.text[cursor - 1] || "")) continue;
          close = cursor;
          break;
        }
        const remainder = line.text.slice(index + 1);
        const cellEnd = remainder.indexOf("|");
        const cellBody = cellEnd < 0 ? remainder : remainder.slice(0, cellEnd);
        const hasCellBoundary = cellEnd >= 0;
        if (close < 0 && (!hasCellBoundary || !looksLikeShellVariable(cellBody))) {
          return { start: line.start + index, bodyStart: line.start + index + 1, opening: "$" as const, kind: "math-inline" as const };
        }
        if (close >= 0) index = close;
      }
    }
  }
  return null;
}

function isEscaped(source: string, offset: number) {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function findUnescapedDelimiter(source: string, delimiter: string, start: number) {
  for (let index = start; index <= source.length - delimiter.length; index += 1) {
    if (source.startsWith(delimiter, index) && !isEscaped(source, index)) return index;
  }
  return -1;
}

function looksLikeShellVariable(body: string) {
  const bareVariable = /^([A-Za-z_][A-Za-z0-9_]*(?:[./:-][A-Za-z0-9_.-]*)*)[.,;:!?)]*$/.exec(body)?.[1];
  if (bareVariable) {
    // A single uppercase symbol is common at the start of a streamed
    // formula (for example, `$E = mc^2`), not strong shell-variable evidence.
    if (bareVariable.length === 1 && bareVariable !== "x") return false;
    return true;
  }
  return !/[=^_{}+*\\]/.test(body)
    && /\s\$[A-Za-z_][A-Za-z0-9_]*(?:[./:-][A-Za-z0-9_.-]*)?(?=\s|[.,;:!?)]|$)/.test(body);
}

// What an inline scan leaves open at its end: a code span, or a `\(` it found no close for (the scan of a longer
// source would close it further on, past this end, and skip what lies between).
type InlineCarry = { codeDelimiter: number; unclosedParen: boolean };

function findInlineMath(source: string, ranges: SourceRange[], blockMathStart: number | null, skipDoubleDollar = false, allowUnclosedMath = true, carry?: InlineCarry) {
  let codeDelimiter = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (inRange(index, ranges) || (blockMathStart != null && index >= blockMathStart)) continue;
    if (source[index] === "`" && !isEscaped(source, index)) {
      let end = index;
      while (source[end] === "`") end += 1;
      const delimiterLength = end - index;
      if (!codeDelimiter) codeDelimiter = delimiterLength;
      else if (codeDelimiter === delimiterLength) codeDelimiter = 0;
      index = end - 1;
      continue;
    }
    if (codeDelimiter || isEscaped(source, index)) continue;

    if (source.startsWith("\\(", index)) {
      const close = findUnescapedDelimiter(source, "\\)", index + 2);
      if (close >= 0) {
        index = close + 1;
        continue;
      }
      if (carry) carry.unclosedParen = true;
      const body = source.slice(index + 2);
      if (allowUnclosedMath && !/[\r\n]/.test(body)) return { start: index, bodyStart: index + 2 };
      continue;
    }

    if (source[index] !== "$" || source[index + 1] === "$") continue;
    if (skipDoubleDollar && index > 0 && source[index - 1] === "$" && !isEscaped(source, index - 1)) continue;
    // A closed formula is the parser's rule exactly (inline-dollar.ts), so
    // the two cannot pair a line's dollars differently. An open one is taken
    // only after a letter or symbol: "$72" still arriving is a price.
    const close = inlineDollarClose(source, index);
    if (close >= 0) {
      index = close;
      continue;
    }
    const next = source[index + 1];
    if (!next || /\s|\d/.test(next)) continue;
    if (source.indexOf("$", index + 1) >= 0 && !/[\r\n]/.test(source.slice(index, source.indexOf("$", index + 1)))) continue;
    const body = source.slice(index + 1);
    if (allowUnclosedMath && !/[\r\n]/.test(body) && !looksLikeShellVariable(body)) return { start: index, bodyStart: index + 1 };
  }
  if (carry) carry.codeDelimiter = codeDelimiter;
  return null;
}

export function splitStreamingMarkdown(source: string, options: StreamingMarkdownOptions = {}): StreamingMarkdownSplit {
  const allowUnclosedMath = options.allowUnclosedMath !== false;
  const fences = scanFences(source);
  const candidates: StreamingPending[] = [];
  if (fences.open) {
    candidates.push({
      kind: "fence",
      start: fences.open.start,
      body: trimOpeningLineBreak(source.slice(fences.open.contentStart)),
      language: fences.open.language,
    });
  }

  const blockMath = allowUnclosedMath ? findOpenBlockMath(source, fences.ranges) : null;
  if (blockMath) {
    candidates.push({
      kind: "math-block",
      start: blockMath.start,
      body: trimOpeningLineBreak(source.slice(blockMath.bodyStart)),
    });
  }

  const tableMath = allowUnclosedMath && options.tableMath ? findOpenTableCellMath(source, fences.ranges) : null;
  if (tableMath) {
    candidates.push({
      kind: tableMath.kind,
      start: tableMath.start,
      body: source.slice(tableMath.bodyStart),
      opening: tableMath.opening,
    });
  }

  const blockMathStart = [blockMath?.start, tableMath?.start].filter((value): value is number => value != null).sort((left, right) => left - right)[0] ?? null;
  const inlineMath = findInlineMath(source, fences.ranges, blockMathStart, Boolean(options.tableMath), allowUnclosedMath);
  if (inlineMath) {
    candidates.push({
      kind: "math-inline",
      start: inlineMath.start,
      body: source.slice(inlineMath.bodyStart),
    });
  }

  const pending = candidates.sort((left, right) => left.start - right.start)[0] || null;
  return pending ? { stable: source.slice(0, pending.start), pending } : { stable: source, pending: null };
}

/**
 * Whether nothing in `prefix` reaches past its end: no fence, `$$` block, table-cell formula or inline formula open,
 * no code span, no `\(` waiting for its close. A source that grows from such a prefix splits exactly as its remainder
 * does, its offsets moved on by the prefix's length.
 */
function closedPrefix(prefix: string) {
  const fences = scanFences(prefix);
  if (fences.open || findOpenBlockMath(prefix, fences.ranges) || findOpenTableCellMath(prefix, fences.ranges)) return false;
  const carry: InlineCarry = { codeDelimiter: 0, unclosedParen: false };
  return !findInlineMath(prefix, fences.ranges, null, true, true, carry) && !carry.codeDelimiter && !carry.unclosedParen
    && !findInlineMath(prefix, fences.ranges, null, false, true);
}

// Where the text after the last whitespace-only line starts, or -1: read back from the end, line by line.
export function lastBlankLineEnd(source: string) {
  let end = source.lastIndexOf("\n");
  while (end > 0) {
    const start = source.lastIndexOf("\n", end - 1);
    if (start < 0) return -1;
    if (/^[ \t]*$/.test(source.slice(start + 1, end))) return end + 1;
    end = start;
  }
  return -1;
}

/**
 * splitStreamingMarkdown for one message as it streams, without reading it all again for every delta: what lies
 * before the last blank line that closes everything before it (closedPrefix) is never scanned again. Each delta
 * read the whole message several times over, so a long answer's every update grew with its length (5ms a delta
 * late in an 8,000-token answer, the CPU 4x slower). A source that does not extend the last one starts again.
 */
export function createStreamingMarkdownSplitter() {
  let previous = "";
  let base = 0;
  let checked = -1;
  let key = "";
  return (source: string, options: StreamingMarkdownOptions = {}): StreamingMarkdownSplit => {
    const nextKey = `${Boolean(options.tableMath)}:${options.allowUnclosedMath !== false}`;
    if (nextKey !== key || source.length < base || source.substring(0, base) !== previous.substring(0, base)) { base = 0; checked = -1; }
    key = nextKey;
    previous = source;
    const from = base;
    const tail = from ? source.slice(from) : source;
    const split = splitStreamingMarkdown(tail, options);
    // A blank line is a candidate: a block always ends there, a code span or inline formula never crosses it.
    const blankEnd = lastBlankLineEnd(tail);
    const candidate = blankEnd < 0 ? -1 : from + blankEnd;
    if (candidate > from && candidate !== checked) {
      checked = candidate;
      if (closedPrefix(source.slice(from, candidate))) base = candidate;
    }
    if (!split.pending) return { stable: source, pending: null };
    return { stable: source.slice(0, from + split.pending.start), pending: { ...split.pending, start: from + split.pending.start } };
  };
}
