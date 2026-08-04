export type StreamingPendingKind = "math-block" | "math-inline" | "fence";

export type StreamingPending = {
  kind: StreamingPendingKind;
  start: number;
  body: string;
  language?: string;
};

export type StreamingMarkdownSplit = {
  stable: string;
  pending: StreamingPending | null;
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
    const closes = marker[0] === open.marker[0]
      && marker.length >= open.marker.length
      && new RegExp(`^ {0,3}${marker[0]}{${open.marker.length},}\\s*$`).test(line.text);
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
  let open: { start: number; bodyStart: number } | null = null;

  for (const line of sourceLines(source)) {
    if (inRange(line.start, ranges)) continue;
    const delimiter = line.text.indexOf("$$");
    if (delimiter < 0 || !/^ {0,3}\$\$/.test(line.text)) continue;
    const rest = line.text.slice(delimiter + 2);
    const sameLineClose = rest.indexOf("$$");
    if (!open) {
      if (sameLineClose >= 0) continue;
      open = {
        start: line.start,
        bodyStart: line.start + delimiter + 2,
      };
      continue;
    }
    if (/^\s*$/.test(line.text.slice(delimiter + 2))) {
      open = null;
    }
  }

  return open;
}

function isEscaped(source: string, offset: number) {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function findInlineMath(source: string, ranges: SourceRange[], blockMathStart: number | null) {
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
    if (codeDelimiter || source[index] !== "$" || source[index + 1] === "$" || isEscaped(source, index)) continue;
    const next = source[index + 1];
    if (!next || /\s|\d/.test(next)) continue;

    let closeFound = false;
    for (let close = index + 1; close < source.length; close += 1) {
      if (source[close] !== "$" || source[close + 1] === "$" || isEscaped(source, close)) continue;
      if (/\s/.test(source[close - 1] || "")) continue;
      closeFound = true;
      index = close;
      break;
    }
    if (closeFound) continue;
    const body = source.slice(index + 1);
    if (!/[\r\n]/.test(body)) return { start: index, bodyStart: index + 1 };
  }
  return null;
}

export function splitStreamingMarkdown(source: string): StreamingMarkdownSplit {
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

  const blockMath = findOpenBlockMath(source, fences.ranges);
  if (blockMath) {
    candidates.push({
      kind: "math-block",
      start: blockMath.start,
      body: trimOpeningLineBreak(source.slice(blockMath.bodyStart)),
    });
  }

  const inlineMath = findInlineMath(source, fences.ranges, blockMath?.start ?? null);
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
