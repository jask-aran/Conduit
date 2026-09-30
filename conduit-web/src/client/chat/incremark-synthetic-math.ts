const ONE_ARGUMENT_COMMANDS = new Set(["sqrt", "colorbox", "fbox", "boxed", "cancel"]);
const TWO_ARGUMENT_COMMANDS = new Set(["frac", "dfrac", "tfrac", "binom", "overset", "underset", "stackrel"]);

type MarkdownNode = any;
type SyntheticMathPending = {
  kind: "math-inline" | "math-block";
  body: string;
  opening?: "$" | "$$" | "\\(" | "\\[";
};

function isEscaped(source: string, index: number) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

/**
 * What a partial formula still has open, innermost last: braces,
 * `\left` delimiters and `\begin{...}` environments. Closing them in reverse
 * is what lets a half-written `aligned` block render its finished rows; closing
 * only braces left every environment invalid until its `\end` arrived, so a
 * long display block appeared all at once.
 */
function openGroups(source: string) {
  const stack: string[] = [];
  // Where a two-argument command ended: a brace opening right there is its
  // first argument, and closing it early still owes the second.
  let firstArgumentAt = -1;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      const command = /^\\([a-zA-Z]+)/.exec(source.slice(index));
      if (!command) { index += 1; continue; }
      const name = command[1]!;
      const after = index + command[0].length;
      if (name === "begin" || name === "end") {
        const environment = /^\s*\{([a-zA-Z*]+)\}/.exec(source.slice(after));
        if (environment) {
          if (name === "begin") stack.push(`env:${environment[1]}`);
          else {
            const at = stack.lastIndexOf(`env:${environment[1]}`);
            if (at >= 0) stack.length = at;
          }
          index = after + environment[0].length - 1;
          continue;
        }
      } else if (name === "left") stack.push("left");
      else if (name === "right" && stack.at(-1) === "left") stack.pop();
      else if (TWO_ARGUMENT_COMMANDS.has(name)) firstArgumentAt = after;
      index = after - 1;
      continue;
    }
    if (char === "{") stack.push(firstArgumentAt >= 0 && !source.slice(firstArgumentAt, index).trim() ? "{2" : "{");
    else if (char === "}" && stack.at(-1)?.startsWith("{")) stack.pop();
    if (!/\s/.test(char!)) firstArgumentAt = -1;
  }
  return stack;
}

function closeOpenGroups(source: string) {
  // A `\left` with no delimiter yet takes the invisible one.
  let closed = /\\left\s*$/.test(source) ? `${source}.` : source;
  for (const group of openGroups(closed).reverse()) {
    closed += group === "{" ? "}" : group === "{2" ? "}{}" : group === "left" ? "\\right." : `\\end{${group.slice(4)}}`;
  }
  return closed;
}

function consumeBracedArgument(source: string, start: number) {
  let index = start;
  while (/\s/.test(source[index] || "")) index += 1;
  if (source[index] !== "{") return null;
  let depth = 0;
  for (; index < source.length; index += 1) {
    if (isEscaped(source, index)) continue;
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return null;
}

function appendMissingCommandArguments(source: string) {
  const commandPattern = /\\([a-zA-Z]+)/g;
  let lastCommand: { name: string; start: number; end: number } | null = null;
  for (const match of source.matchAll(commandPattern)) {
    const name = match[1]!;
    if (!ONE_ARGUMENT_COMMANDS.has(name) && !TWO_ARGUMENT_COMMANDS.has(name)) continue;
    lastCommand = { name, start: match.index, end: match.index + match[0].length };
  }
  if (!lastCommand) return source;

  let cursor = lastCommand.end;
  let argumentCount = 0;
  while (true) {
    const next = consumeBracedArgument(source, cursor);
    if (next == null) break;
    argumentCount += 1;
    cursor = next;
  }
  if (source.slice(cursor).trim()) return source;
  const required = TWO_ARGUMENT_COMMANDS.has(lastCommand.name) ? 2 : 1;
  return `${source}${"{}".repeat(Math.max(0, required - argumentCount))}`;
}

/**
 * Make a display-only candidate for an incomplete TeX expression.
 * The raw stream is never changed. The candidate is strict-valid or is
 * rejected by the renderer and replaced with the last valid preview.
 */
export function repairSyntheticMathSource(source: string) {
  let repaired = appendMissingCommandArguments(source);
  if (/(^|[^\\])(?:\^|_)\s*$/.test(repaired)) repaired += "{}";
  return closeOpenGroups(repaired);
}

/**
 * A partial's tail with what cannot be finished yet taken off: a command still
 * being written (`\ome` of `\omega`, `\begin{alig`), a lone backslash starting
 * one, then a row break with nothing after it. Tried only when the repaired
 * source is rejected, because a finished formula may end in a command.
 */
export function trimUnfinishedMathTail(source: string) {
  return source
    .replace(/\\(?:begin|end)\s*\{[a-zA-Z*]*$|\\[a-zA-Z]+\s*$/, "")
    .replace(/(^|[^\\])\\$/, "$1")
    .replace(/\\\\(?:\[[^\]]*)?\s*$/, "");
}

function replacePendingInlineMath(node: MarkdownNode, opening: string, body: string): [MarkdownNode, boolean] {
  if (!node || typeof node !== "object") return [node, false];
  if (!Array.isArray(node.children)) return [node, false];
  const previewBody = body.trimEnd();
  const marker = opening === "\\(" ? "(" : opening;
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index];
    if (child?.type === "text" && typeof child.value === "string") {
      const openingIndex = child.value.lastIndexOf(marker);
      if (openingIndex >= 0) {
        let endIndex = index;
        let candidate = child.value.slice(openingIndex + marker.length);
        while (candidate.length < body.length && node.children[endIndex + 1]?.type === "text") {
          endIndex += 1;
          candidate += node.children[endIndex].value;
        }
        if (candidate.startsWith(previewBody)) {
          const replacement = [];
          const prefix = child.value.slice(0, openingIndex);
          const suffix = candidate.slice(previewBody.length);
          if (prefix) replacement.push({ type: "text", value: prefix });
          replacement.push({ type: "inlineMath", value: previewBody, __conduitMathSource: previewBody });
          if (suffix) replacement.push({ type: "text", value: suffix });
          const children = [...node.children];
          children.splice(index, endIndex - index + 1, ...replacement);
          return [{ ...node, children }, true];
        }
      }
    }
    const [next, replaced] = replacePendingInlineMath(node.children[index], opening, body);
    if (!replaced) continue;
    const children = [...node.children];
    children[index] = next;
    return [{ ...node, children }, true];
  }
  return [node, false];
}

function replacePendingDisplayMath(node: MarkdownNode, body: string): [MarkdownNode, boolean] {
  if (!node || typeof node !== "object") return [node, false];
  if (!Array.isArray(node.children)) return [node, false];
  // Incremark can tokenize an incomplete `$$...` cell as a literal `$` plus
  // an inlineMath node after the first closing dollar arrives. Treat that
  // shape as the same pending display expression instead of exposing its raw
  // delimiters.
  const previewBody = (body.endsWith("$") ? body.slice(0, -1) : body).trimEnd();
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index];
    const following = node.children[index + 1];
    if (child?.type === "text" && child.value === "$" && following?.type === "inlineMath") {
      const candidate = String(following.value || "");
      if (candidate === previewBody || candidate.startsWith(previewBody) || previewBody.startsWith(candidate)) {
        const children = [...node.children];
        children.splice(index, 2, { type: "math", value: previewBody, __conduitMathSource: previewBody });
        return [{ ...node, children }, true];
      }
    }
    if (child?.type === "text" && typeof child.value === "string") {
      const openingIndex = child.value.lastIndexOf("$$");
      if (openingIndex >= 0) {
        const prefix = child.value.slice(0, openingIndex);
        let endIndex = index;
        let candidate = child.value.slice(openingIndex + 2);
        while (endIndex + 1 < node.children.length && node.children[endIndex + 1]?.type === "text") {
          endIndex += 1;
          candidate += String(node.children[endIndex].value || "");
        }
        // The core parser may split TeX spacing commands and punctuation into
        // separate text nodes, so the AST text is not always byte-equal to the
        // source body. The pending split has already identified the active
        // delimiter. Replace the rest of that local text run atomically.
        if (candidate.startsWith(previewBody) || node.type === "tableCell" || node.type === "tableRow" || node.type === "table") {
          const replacement = [];
          if (prefix) replacement.push({ type: "text", value: prefix });
          replacement.push({ type: "math", value: previewBody, __conduitMathSource: previewBody });
          const children = [...node.children];
          children.splice(index, endIndex - index + 1, ...replacement);
          return [{ ...node, children }, true];
        }
      }
    }
    const [next, replaced] = replacePendingDisplayMath(node.children[index], body);
    if (!replaced) continue;
    const children = [...node.children];
    children[index] = next;
    return [{ ...node, children }, true];
  }
  return [node, false];
}

/**
 * Add a display-only math node to the parser's existing pending AST.
 * This keeps the surrounding paragraph or table structure from being
 * reparsed for every preview character.
 */
export function createSyntheticMathPreviewNode(node: MarkdownNode, pending: SyntheticMathPending): MarkdownNode | null {
  if (!node || typeof node !== "object") return null;
  if (pending.kind === "math-block") {
    const [preview, replaced] = replacePendingDisplayMath(node, pending.body);
    if (replaced) return preview;
    if (node.type === "table" || node.type === "tableRow" || node.type === "tableCell") return null;
    return {
      type: "math",
      value: pending.body,
      __conduitMathSource: pending.body,
      position: node.position,
    };
  }
  const opening = pending.opening || "$";
  const [preview, replaced] = replacePendingInlineMath(node, opening, pending.body);
  return replaced ? preview : null;
}

