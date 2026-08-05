const ONE_ARGUMENT_COMMANDS = new Set(["sqrt", "colorbox", "fbox", "boxed", "cancel"]);
const TWO_ARGUMENT_COMMANDS = new Set(["frac", "dfrac", "tfrac", "binom", "overset", "underset", "stackrel"]);

function isEscaped(source: string, index: number) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function balanceBraces(source: string) {
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (isEscaped(source, index)) continue;
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth = Math.max(0, depth - 1);
  }
  return `${source}${"}".repeat(depth)}`;
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
  let repaired = balanceBraces(source);
  repaired = appendMissingCommandArguments(repaired);
  if (/(^|[^\\])(?:\^|_)\s*$/.test(repaired)) repaired += "{}";
  return repaired;
}
