type MarkdownNode = any;

export type TableMathProjection = {
  source: string;
  sentinel: string | null;
  pipeRepairs: number;
};

const FIRST_SENTINEL = 0xe000;
const LAST_SENTINEL = 0xf8ff;

function isEscaped(source: string, index: number) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function splitLines(source: string) {
  const lines: Array<{ start: number; end: number; text: string }> = [];
  let start = 0;
  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline < 0 ? source.length : newline + 1;
    lines.push({ start, end, text: source.slice(start, end) });
    start = end;
  }
  if (!lines.length && source.length === 0) lines.push({ start: 0, end: 0, text: "" });
  return lines;
}

function isTableDelimiter(line: string) {
  const value = line.replace(/\r?\n$/, "").trim();
  if (!value.includes("|")) return false;
  const cells = value.replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length >= 2 && cells.every((cell) => /^\s*:?-{1,}:?\s*$/.test(cell));
}

function isPossibleTableRow(line: string) {
  return line.replace(/\r?\n$/, "").trim().includes("|");
}

function tableLineMask(lines: Array<{ text: string }>) {
  const mask = lines.map(() => false);
  for (let index = 0; index < lines.length; index += 1) {
    if (!isTableDelimiter(lines[index]!.text)) continue;
    let before = index - 1;
    while (before >= 0 && isPossibleTableRow(lines[before]!.text)) before -= 1;
    let after = index + 1;
    while (after < lines.length && isPossibleTableRow(lines[after]!.text)) after += 1;
    if (before < index - 1 || after > index + 1) {
      for (let cursor = before + 1; cursor < after; cursor += 1) {
        if (cursor !== index) mask[cursor] = true;
      }
    }
  }
  return mask;
}

function chooseSentinel(source: string): string | null {
  for (let codePoint = FIRST_SENTINEL; codePoint <= LAST_SENTINEL; codePoint += 1) {
    const candidate = String.fromCodePoint(codePoint);
    if (!source.includes(candidate)) return candidate;
  }
  return null;
}

type MathMode = "dollar-inline" | "dollar-block" | "tex-inline" | "tex-block";

function nextUnescapedPipe(source: string, start: number) {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "|" && !isEscaped(source, index)) return index;
  }
  return -1;
}

function shouldProtectUnclosedInlinePipe(line: string, pipeIndex: number, mathStart: number) {
  const body = line.slice(mathStart, pipeIndex);
  if (/\s$/.test(body) || !/[\\^_{}=]/.test(body)) return false;
  const nextPipe = nextUnescapedPipe(line, pipeIndex + 1);
  const following = line.slice(pipeIndex + 1, nextPipe < 0 ? line.length : nextPipe);
  return !/\s/.test(following);
}

function projectTableLine(line: string, sentinel: string, convertTexDisplayDelimiters: boolean) {
  let mode: MathMode | null = null;
  let mathStart = 0;
  let mathComplete = false;
  let codeLength = 0;
  let pipeRepairs = 0;
  let output = "";

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === "`" && !isEscaped(line, index)) {
      let end = index;
      while (line[end] === "`") end += 1;
      const length = end - index;
      if (!codeLength) codeLength = length;
      else if (codeLength === length) codeLength = 0;
      output += line.slice(index, end);
      index = end - 1;
      continue;
    }

    if (codeLength) {
      output += character;
      continue;
    }

    if (mode === "dollar-block" && line.startsWith("$$", index) && !isEscaped(line, index)) {
      output += "$$";
      mode = null;
      mathComplete = true;
      index += 1;
      continue;
    }
    if (mode === "tex-block" && line.startsWith("\\]", index) && !isEscaped(line, index)) {
      output += convertTexDisplayDelimiters ? "$$" : "\\]";
      mode = null;
      mathComplete = true;
      index += 1;
      continue;
    }
    if (mode === "dollar-inline" && character === "$" && !isEscaped(line, index) && !/\s/.test(line[index - 1] || "")) {
      output += character;
      mode = null;
      mathComplete = true;
      continue;
    }
    if (mode === "tex-inline" && line.startsWith("\\)", index) && !isEscaped(line, index)) {
      output += "\\)";
      mode = null;
      mathComplete = true;
      index += 1;
      continue;
    }
    if (mode) {
      const protectPipe = mathComplete
        || mode !== "dollar-inline"
        || (character === "|" && !isEscaped(line, index) && shouldProtectUnclosedInlinePipe(line, index, mathStart));
      if (character === "|" && !isEscaped(line, index) && protectPipe) {
        output += sentinel;
        pipeRepairs += 1;
      } else {
        if (character === "|" && !isEscaped(line, index)) mode = null;
        output += character;
      }
      continue;
    }

    if (line.startsWith("$$", index) && !isEscaped(line, index)) {
      const close = findUnescapedDelimiter(line, "$$", index + 2);
      output += "$$";
      mode = "dollar-block";
      mathStart = index + 2;
      mathComplete = close >= 0;
      index += 1;
      continue;
    }
    if (line.startsWith("\\[", index) && !isEscaped(line, index)) {
      const close = findUnescapedDelimiter(line, "\\]", index + 2);
      output += convertTexDisplayDelimiters ? "$$" : "\\[";
      mode = "tex-block";
      mathStart = index + 2;
      mathComplete = close >= 0;
      index += 1;
      continue;
    }
    if (line.startsWith("\\(", index) && !isEscaped(line, index)) {
      const close = findUnescapedDelimiter(line, "\\)", index + 2);
      output += "\\(";
      mode = "tex-inline";
      mathStart = index + 2;
      mathComplete = close >= 0;
      index += 1;
      continue;
    }
    if (character === "$" && !isEscaped(line, index) && line[index + 1] !== "$" && line[index + 1] && !/[\s\d]/.test(line[index + 1]!)) {
      output += character;
      const close = findInlineDollarClose(line, index + 1);
      mode = "dollar-inline";
      mathStart = index + 1;
      mathComplete = close >= 0;
      continue;
    }
    output += character;
  }

  return { source: output, pipeRepairs };
}

function findUnescapedDelimiter(source: string, delimiter: string, start: number) {
  for (let index = start; index <= source.length - delimiter.length; index += 1) {
    if (source.startsWith(delimiter, index) && !isEscaped(source, index)) return index;
  }
  return -1;
}

function findInlineDollarClose(source: string, start: number) {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] !== "$" || source[index + 1] === "$" || isEscaped(source, index)) continue;
    if (/\s/.test(source[index - 1] || "")) continue;
    return index;
  }
  return -1;
}

export function projectTableMathSource(source: string, options: { convertTexDisplayDelimiters?: boolean; sentinel?: string } = {}): TableMathProjection {
  const sentinel = options.sentinel && !source.includes(options.sentinel) ? options.sentinel : chooseSentinel(source);
  if (!sentinel) return { source, sentinel: null, pipeRepairs: 0 };
  const lines = splitLines(source);
  const tableLines = tableLineMask(lines);
  let pipeRepairs = 0;
  const projected = lines.map((line, index) => {
    if (!tableLines[index]) return line.text;
    const next = projectTableLine(line.text, sentinel, Boolean(options.convertTexDisplayDelimiters));
    pipeRepairs += next.pipeRepairs;
    return next.source;
  }).join("");
  return { source: projected, sentinel, pipeRepairs };
}

export function restoreTableMathSentinel(value: string, sentinel: string | null) {
  return sentinel ? value.replaceAll(sentinel, "|") : value;
}

export function restoreTableMathAst(node: MarkdownNode, sentinel: string | null): MarkdownNode {
  if (!node || typeof node !== "object") return node;
  let changed = false;
  const next: MarkdownNode = { ...node };
  for (const key of ["value", "rawText", "__conduitMathSource"]) {
    if (typeof next[key] === "string") {
      const restored = restoreTableMathSentinel(next[key], sentinel);
      if (restored !== next[key]) {
        next[key] = restored;
        changed = true;
      }
    }
  }
  if (Array.isArray(node.children)) {
    const children = node.children.map((child: MarkdownNode) => {
      const restored = restoreTableMathAst(child, sentinel);
      if (restored !== child) changed = true;
      return restored;
    });
    next.children = children;
  }
  return changed ? next : node;
}

function displayMathNodesFromText(value: string): MarkdownNode[] | null {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const opening = value.indexOf("$$", cursor);
    if (opening < 0 || isEscaped(value, opening)) break;
    const closing = value.indexOf("$$", opening + 2);
    if (closing < 0 || isEscaped(value, closing)) break;
    if (opening > cursor) nodes.push({ type: "text", value: value.slice(cursor, opening) });
    const body = value.slice(opening + 2, closing);
    nodes.push({ type: "math", value: body, __conduitMathSource: body });
    cursor = closing + 2;
  }
  if (!nodes.length) return null;
  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes;
}

function normalizeTableCellChildren(children: MarkdownNode[]) {
  const next: MarkdownNode[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const following = children[index + 1];
    const ending = children[index + 2];
    if (child?.type === "text" && child.value === "$" && following?.type === "inlineMath" && ending?.type === "text" && ending.value === "$") {
      const body = String(following.value || "");
      next.push({ type: "math", value: body, __conduitMathSource: body });
      index += 2;
      continue;
    }
    if (child?.type === "text" && typeof child.value === "string") {
      const display = displayMathNodesFromText(child.value);
      if (display) {
        next.push(...display);
        continue;
      }
    }
    next.push(child);
  }
  return next;
}

export function promoteTableCellDisplayMath(node: MarkdownNode): MarkdownNode {
  if (!node || typeof node !== "object") return node;
  let changed = false;
  const next: MarkdownNode = { ...node };
  if (node.type === "tableCell" && Array.isArray(node.children)) {
    const children = normalizeTableCellChildren(node.children);
    if (children.some((child, index) => child !== node.children[index]) || children.length !== node.children.length) changed = true;
    next.children = children;
  } else if (Array.isArray(node.children)) {
    const children = node.children.map((child: MarkdownNode) => {
      const promoted = promoteTableCellDisplayMath(child);
      if (promoted !== child) changed = true;
      return promoted;
    });
    next.children = children;
  }
  return changed ? next : node;
}
