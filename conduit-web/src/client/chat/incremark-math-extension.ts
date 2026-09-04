import type { IncremarkPlugin } from "@incremark/core";

/**
 * Conduit's math tokenizers for Incremark.
 *
 * Incremark's own `math` option is left off and these stand in for it, because
 * its inline rule opens on any unescaped `$` and so reads prose money --
 * "$174k because ..." closed by whatever `$` comes next -- as one formula. The
 * rest of the pipeline already refuses that shape: splitStreamingMarkdown will
 * not open a pending formula on a `$` followed by a digit or a space, and
 * projectTableMathSource applies the same test inside table cells. Only the
 * settled parse disagreed, so a paragraph could stream as prose and then
 * collapse into run-together italics once a later `$` closed it.
 *
 * The guard below is that same test and nothing more; the block rule and the
 * rest of the inline rule are Incremark's own.
 */
type MathExtensionOptions = { tex?: boolean };

function opensMath(source: string, index: number) {
  const next = source[index + 1];
  return Boolean(next) && next !== "$" && !/[\s\d]/.test(next!);
}

function inlineMathStart(source: string, tex: boolean) {
  let dollarIndex = -1;
  for (let index = source.indexOf("$"); index >= 0; index = source.indexOf("$", index + 1)) {
    if (opensMath(source, index)) {
      dollarIndex = index;
      break;
    }
  }
  const parenIndex = tex ? source.indexOf("\\(") : -1;
  if (dollarIndex >= 0 && parenIndex >= 0) return Math.min(dollarIndex, parenIndex);
  if (dollarIndex >= 0) return dollarIndex;
  if (parenIndex >= 0) return parenIndex;
  return undefined;
}

const blockMathExtension = (tex: boolean) => ({
  name: "blockMath",
  level: "block" as const,
  start(source: string) {
    const dollarMatch = source.match(/^ {0,3}\$\$/m);
    const bracketMatch = tex ? source.match(/^ {0,3}\\\[/m) : null;
    if (dollarMatch && bracketMatch) return Math.min(dollarMatch.index!, bracketMatch.index!);
    return dollarMatch?.index ?? bracketMatch?.index;
  },
  tokenizer(source: string) {
    const dollarMatch = /^ {0,3}\$\$([\s\S]*?)\$\$ *(?:\n+|$)/.exec(source);
    if (dollarMatch) return { type: "blockMath", raw: dollarMatch[0], text: dollarMatch[1]!.trim() };
    if (!tex) return undefined;
    const bracketMatch = /^ {0,3}\\\[([\s\S]*?)\\\] *(?:\n+|$)/.exec(source);
    if (bracketMatch) return { type: "blockMath", raw: bracketMatch[0], text: bracketMatch[1]!.trim() };
    return undefined;
  },
  renderer() { return ""; },
});

const inlineMathExtension = (tex: boolean) => ({
  name: "inlineMath",
  level: "inline" as const,
  start(source: string) {
    return inlineMathStart(source, tex);
  },
  tokenizer(source: string) {
    // `opensMath` is the whole difference from Incremark: "$174k" and "$ 5" are
    // currency, so they never open a formula that a later `$` can close.
    if (opensMath(source, 0)) {
      const dollarMatch = /^\$(?!\$)((?:\\.|[^\\\n$])+?)\$(?!\d)/.exec(source);
      if (dollarMatch) return { type: "inlineMath", raw: dollarMatch[0], text: dollarMatch[1]!.trim() };
    }
    if (!tex) return undefined;
    const parenMatch = /^\\\(([\s\S]*?)\\\)/.exec(source);
    if (parenMatch) return { type: "inlineMath", raw: parenMatch[0], text: parenMatch[1]!.trim() };
    return undefined;
  },
  renderer() { return ""; },
});

export function conduitMathPlugin(options: MathExtensionOptions = {}): IncremarkPlugin {
  const tex = options.tex ?? false;
  return {
    name: "conduit-math",
    type: "marked",
    // Incremark reads each entry as a flat marked tokenizer extension rather
    // than a `marked.use()` payload, so these are not wrapped in `{ extensions }`.
    marked: { extensions: [blockMathExtension(tex), inlineMathExtension(tex)] as any },
  };
}
