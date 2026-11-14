/*
 * A formula read as it is typed: references, function names and strings found by a scan of our own, cheap enough to run on every key (the engine's
 * parse is not, and it rejects what is half typed). A reference half typed (`a1:`) counts as what it is so far.
 */
import type { SheetRange } from "./host";

export type FormulaTokenKind = "ref" | "call" | "name" | "string" | "number" | "open" | "close" | "separator" | "operator" | "space" | "other";
/** `ref`: the cells a reference covers (a whole column or row runs to the sheet's end: Infinity), and `key`, the same reference however it is anchored or cased. */
export type FormulaToken = { kind: FormulaTokenKind; from: number; to: number; ref?: SheetRange; key?: string };
/** What the caret stands at. `point`: where a pointed reference goes (`from`-`to` replaced). `word`: a function's name being typed. `call`: the innermost call the caret is in, and which argument. */
export type FormulaContext = { point: { from: number; to: number } | null; word: { from: number; to: number; text: string } | null; call: { name: string; arg: number } | null };

/** The inks references are told apart by, in the order they first appear: code's syntax colours, the one place hue marks things that are not state. */
export const INKS = ["--syntax-title", "--syntax-variable", "--syntax-string", "--syntax-keyword", "--syntax-number", "--code-cyan"] as const;

const CELL = /\$?([A-Za-z]{1,3})\$?(\d{1,7})/y, PARTIAL = /\$?[A-Za-z]{0,3}\$?/y, WORD = /[A-Za-z_][\w.]*/y, NUMBER = /\d*\.?\d+(?:[eE][+-]?\d+)?/y;
const COLS = /\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})(?![\w.(])/y, ROWS = /\$?(\d{1,7}):\$?(\d{1,7})(?![\w.(])/y;
const OPERATORS = "+-*/^&=<>%:";
const sticky = (pattern: RegExp, text: string, at: number) => { pattern.lastIndex = at; return pattern.exec(text); };
const letters = (name: string) => { let col = 0; for (const letter of name.toUpperCase()) col = col * 26 + letter.charCodeAt(0) - 64; return col - 1; };
const span = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)] as const;
// Where a reference ends: what follows may not carry the word on.
const ends = (text: string, at: number) => !/[\w.(]/.test(text[at] ?? "");

export const isFormula = (text: string) => text.startsWith("=");

/** A formula's tokens; text that is no formula is one token of nothing. */
export function tokenize(text: string): FormulaToken[] {
  if (!isFormula(text)) return [{ kind: "other", from: 0, to: text.length }];
  const tokens: FormulaToken[] = [{ kind: "operator", from: 0, to: 1 }], push = (kind: FormulaTokenKind, from: number, to: number, ref?: SheetRange) => tokens.push(ref ? { kind, from, to, ref, key: text.slice(from, to).replace(/\$/g, "").replace(/:$/, "").toUpperCase() } : { kind, from, to });
  for (let at = 1; at < text.length;) {
    const char = text[at]!;
    if (char === '"') {
      let end = at + 1;
      for (; end < text.length; end++) if (text[end] === '"') { if (text[end + 1] === '"') end++; else { end++; break; } }
      push("string", at, Math.min(end, text.length)); at = Math.min(end, text.length); continue;
    }
    if (/\s/.test(char)) { let end = at + 1; while (end < text.length && /\s/.test(text[end]!)) end++; push("space", at, end); at = end; continue; }
    if (char === "(" || char === ")") { push(char === "(" ? "open" : "close", at, at + 1); at++; continue; }
    if (char === "," || char === ";") { push("separator", at, at + 1); at++; continue; }
    if (/[\d.]/.test(char)) {
      const rows = sticky(ROWS, text, at);
      if (rows) { const [top, bottom] = span(Number(rows[1]) - 1, Number(rows[2]) - 1); push("ref", at, at + rows[0].length, { top, bottom, left: 0, right: Infinity }); at += rows[0].length; continue; }
      const number = sticky(NUMBER, text, at);
      const end = at + (number?.[0].length || 1);
      push(number ? "number" : "other", at, end); at = end; continue;
    }
    if (char === "$" || /[A-Za-z_]/.test(char)) {
      const cols = sticky(COLS, text, at);
      if (cols) { const [left, right] = span(letters(cols[1]!), letters(cols[2]!)); push("ref", at, at + cols[0].length, { top: 0, bottom: Infinity, left, right }); at += cols[0].length; continue; }
      const word = char === "$" ? null : sticky(WORD, text, at), cell = sticky(CELL, text, at);
      let after = at + (word?.[0].length ?? 0);
      while (/\s/.test(text[after] ?? "")) after++;
      if (word && text[after] === "(") { push("call", at, at + word[0].length); at += word[0].length; continue; }
      if (cell && ends(text, at + cell[0].length) || cell && text[at + cell[0].length] === ":") {
        const row = Number(cell[2]) - 1, col = letters(cell[1]!);
        let end = at + cell[0].length, ref: SheetRange = { top: row, bottom: row, left: col, right: col };
        if (text[end] === ":") {
          const other = sticky(CELL, text, end + 1);
          if (other && ends(text, end + 1 + other[0].length)) { const [top, bottom] = span(row, Number(other[2]) - 1), [left, right] = span(col, letters(other[1]!)); ref = { top, bottom, left, right }; end += 1 + other[0].length; }
          else end += 1 + (sticky(PARTIAL, text, end + 1)?.[0].length ?? 0);
        }
        push("ref", at, end, ref); at = end; continue;
      }
      const end = at + (word?.[0].length || 1);
      push(word ? "name" : "other", at, end); at = end; continue;
    }
    push(OPERATORS.includes(char) ? "operator" : "other", at, at + 1); at++;
  }
  return tokens;
}

/** Each distinct reference's ink, by its key, in the order references first appear. */
export function inksOf(tokens: readonly FormulaToken[]) {
  const inks = new Map<string, number>();
  for (const token of tokens) if (token.key && !inks.has(token.key)) inks.set(token.key, inks.size % INKS.length);
  return inks;
}

// After these, a reference or a function can start.
const OPENS: ReadonlySet<FormulaTokenKind> = new Set(["operator", "open", "separator"]);

export function contextAt(text: string, tokens: readonly FormulaToken[], caret: number): FormulaContext {
  if (!isFormula(text) || caret < 1) return { point: null, word: null, call: null };
  // `at`: the token the caret stands in or ends (or a reference starting at it); `last`: the one before the caret's, spaces aside.
  let at: FormulaToken | undefined, last: FormulaToken | undefined, prev: FormulaToken | undefined;
  const calls: { name: string | null; arg: number }[] = [];
  for (const token of tokens) {
    if (token.from >= caret) { if (token.from === caret && token.kind === "ref") { at = token; prev = last; } break; }
    if (token.kind === "space") continue;
    if (token.kind === "open") calls.push({ name: last?.kind === "call" ? text.slice(last.from, last.to).toUpperCase() : null, arg: 0 });
    else if (token.kind === "separator" && calls.length) calls[calls.length - 1]!.arg++;
    else if (token.kind === "close") calls.pop();
    if (token.to >= caret) { at = token; prev = last; break; }
    last = token;
  }
  const opener = (token: FormulaToken | undefined) => !token || OPENS.has(token.kind);
  const point = at?.kind === "ref" ? { from: at.from, to: at.to } : (at ? at.to === caret && OPENS.has(at.kind) : opener(last)) ? { from: caret, to: caret } : null;
  const word = at && at.to === caret && (at.kind === "name" || at.kind === "ref" || at.kind === "call") && /^[A-Za-z][\w.]*$/.test(text.slice(at.from, at.to)) && opener(prev) ? { from: at.from, to: at.to, text: text.slice(at.from, at.to) } : null;
  const inner = calls.findLast((call) => call.name);
  return { point, word, call: inner?.name ? { name: inner.name, arg: inner.arg } : null };
}

// A1 → $A$1 → A$1 → $A1 → A1, every corner alike; a whole column or row has one mark to turn.
const ANCHORS = [[false, false], [true, true], [false, true], [true, false]] as const;
/** The reference's `$` anchoring turned one step on, as F4 does. */
export function cycleAnchors(reference: string) {
  const parts = reference.split(":").map((part) => /^(\$?)([A-Za-z]*)(\$?)(\d*)$/.exec(part));
  if (!parts.every(Boolean)) return reference;
  const [, first, col, second, row] = parts[0]!;
  if (!col || !row) return parts.map((part) => `${first === "$" ? "" : "$"}${part![2]}${part![4]}`).join(":");
  const [c, r] = ANCHORS[(ANCHORS.findIndex(([a, b]) => a === (first === "$") && b === (second === "$")) + 1) % ANCHORS.length]!;
  return parts.map((part) => `${c && part![2] ? "$" : ""}${part![2]}${r && part![4] ? "$" : ""}${part![4]}`).join(":");
}

/** A formula as it is written into the cell: function names and references upper-cased, open calls closed, trimmed. Other text is kept as typed. */
export function finish(text: string) {
  if (!isFormula(text)) return text;
  let out = "", depth = 0;
  for (const token of tokenize(text)) {
    const part = text.slice(token.from, token.to);
    out += token.kind === "call" || token.kind === "ref" || (token.kind === "name" && /^(true|false)$/i.test(part)) ? part.toUpperCase() : part;
    if (token.kind === "open") depth++; else if (token.kind === "close") depth = Math.max(0, depth - 1);
  }
  return (out.trim() + ")".repeat(depth)).trim();
}
