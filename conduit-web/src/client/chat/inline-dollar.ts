/**
 * Where a single-`$` formula opened at `open` closes, or -1 if that `$` does
 * not open one. The settled parser, the streaming split and table cells all
 * ask this, so a span is maths in all three or in none: when they disagreed,
 * one refused `$` shifted every pairing after it and the rest of the line
 * rendered as raw TeX.
 *
 * Prose money is the reason for the rules. `$174k`, `$72.90 / $14.44`,
 * `$38–$71` and `$0.015/vCPU·h, $0.008/GiB` must stay text, while models also
 * write `$0$`, `$2^{10} = 1024$` and `$ \infty $`:
 *
 * - After a letter or symbol, the formula runs to the next `$` on the line
 *   that no digit follows.
 * - After a digit, the closing `$` also may not follow a space, as a price
 *   range's second `$` does ("$14 / $151"), nor precede a digit ("$38–$71"),
 *   and the body may not hold two words in a row: prose between two prices
 *   ("$174k because EA+QT10 … the **$**") is not a formula.
 * - After a space, the body must hold TeX -- a command, a script or a brace --
 *   which a spaced-out price does not.
 */
function isEscaped(source: string, index: number) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

export function inlineDollarClose(source: string, open: number): number {
  if (source[open] !== "$" || isEscaped(source, open)) return -1;
  const next = source[open + 1];
  if (!next || next === "$" || next === "\n") return -1;
  const digit = /\d/.test(next);
  const space = /\s/.test(next);
  for (let close = open + 1; close < source.length; close += 1) {
    const character = source[close];
    if (character === "\n") return -1;
    if (character === "\\") { close += 1; continue; }
    if (character !== "$") continue;
    if (source[close + 1] === "$") return -1;
    if (/\d/.test(source[close + 1] || "")) {
      if (digit) return -1;
      continue;
    }
    const body = source.slice(open + 1, close);
    if (!body.trim()) return -1;
    if (digit && (/\s/.test(source[close - 1]!) || /(?:^|[^\\a-zA-Z])[a-zA-Z]{2,}\s+[a-zA-Z]{2,}/.test(body))) return -1;
    if (space && !/\\[a-zA-Z]|[\^_{}]/.test(body)) return -1;
    return close;
  }
  return -1;
}
