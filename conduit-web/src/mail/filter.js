/*
 * The mail filter language: the text a split or a label rule is written in (mail.d.ts MailFilter). Its engine is a port of
 * the Jask Query Language (~/jaskmoney src/domain/filter*.ts): the same grammar, forgiving reads and canonical form. Its
 * words are Gmail's search operators wherever Gmail has one, plus Conduit's own where Gmail has none.
 */

const MULTI = ["from", "to", "cc", "subject", "text", "label", "ask"];
const DATE = /^(\d{4})[-/](\d{2})[-/](\d{2})$/;
const SPAN = /^(\d+)([dmy])$/;
const SINGLE = {
  category: ["primary", "promotions", "social", "updates", "forums"],
  is: ["unread", "read", "starred", "important", "known", "mailing", "robot", "mine", "direct"],
  has: ["attachment"],
  kind: ["receipt", "delivery", "security", "action"],
  older_than: SPAN, newer_than: SPAN, after: DATE, before: DATE,
};
/** Every field the language reads; any other word before a `:` is text. */
export const FIELDS = [...MULTI, ...Object.keys(SINGLE)];
// Gmail operators people and agents will reach for that a message here cannot answer: saving names them instead of searching them as text.
const GMAIL_ONLY = ["in", "bcc", "list", "filename", "larger", "smaller", "size", "deliveredto", "rfc822msgid", "around"];
const NOT_FIELDS = ["http", "https", "mailto"];

class FilterError extends Error { constructor(message, at) { super(message); this.at = at; } }

/** Reads a filter, forgiving as someone types. "" is no filter (node null), which every message passes. `error.at` is the character where reading stopped; `hints` say how loose input was read. */
export const parseFilter = (text) => read(text, false);
/** As parseFilter, but refuses what saving should not keep: a mistyped field (`subjct:x`) or a Gmail operator Conduit has not got (`in:inbox`). */
export const parseFilterForSaving = (text) => read(text, true);

function read(text, saving) {
  const input = String(text ?? ""), hints = [], doubts = [];
  if (!input.trim()) return { node: null, error: null, hints };
  try {
    const p = new Parser(lex(input), input, hints, doubts);
    p.ignoreTrailingOperators();
    if (p.peek().kind === "eof") return { node: null, error: null, hints };
    const node = p.parseExpr();
    if (p.peek().kind !== "eof") throw new FilterError(`unexpected ${JSON.stringify(p.peek().text)}`, p.peek().pos);
    if (saving && doubts.length) throw new FilterError(doubts[0].message, doubts[0].at);
    return { node: tidy(node), error: null, hints };
  } catch (e) {
    if (!(e instanceof FilterError)) throw e;
    return { node: null, error: { message: e.message, at: e.at }, hints };
  }
}

// Brackets only steer reading: a stored node has none, and runs of one kind are one node, so writing it out and reading it back gives the same node.
function tidy(node) {
  if (!node.children) { const { grouped, ...rest } = node; return rest; }
  const children = node.children.map(tidy);
  return { kind: node.kind, children: node.kind === "not" ? children : children.flatMap((c) => c.kind === node.kind ? c.children : [c]) };
}

const BREAK = new Set([" ", "\t", "\n", "\r", "(", ")", "{", "}", ":", '"']);
const PUNCT = { "(": "lparen", ")": "rparen", "{": "lbrace", "}": "rbrace", ":": "colon" };

function lex(input) {
  const out = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (PUNCT[ch]) { out.push({ kind: PUNCT[ch], text: ch, pos: i++ }); continue; }
    if (ch === '"') {
      const start = i++;
      let s = "", closed = false;
      while (i < input.length) {
        if (input[i] === '"') { i++; closed = true; break; }
        if (input[i] === "\\") {
          const next = input[i + 1];
          if (next !== '"' && next !== "\\") throw new FilterError(next === undefined ? "unterminated escape" : `unsupported escape \\${next}`, i);
          s += next; i += 2; continue;
        }
        s += input[i++];
      }
      if (!closed) throw new FilterError("unterminated quoted text", start);
      out.push({ kind: "quoted", text: s, pos: start });
      continue;
    }
    const start = i;
    while (i < input.length && !BREAK.has(input[i])) i++;
    const word = input.slice(start, i);
    out.push({ kind: word === "AND" ? "and" : word === "OR" ? "or" : word === "NOT" ? "not" : "word", text: word, pos: start });
  }
  out.push({ kind: "eof", text: "", pos: input.length });
  return out;
}

const canStartTerm = (k) => k === "lparen" || k === "lbrace" || k === "word" || k === "quoted" || k === "not";
const isField = (word) => FIELDS.includes(word.toLowerCase());

class Parser {
  idx = 0;
  constructor(tokens, input, hints, doubts) { Object.assign(this, { tokens, input, hints, doubts }); }
  peek() { return this.tokens[this.idx] ?? this.tokens.at(-1); }
  consume() { const t = this.peek(); if (this.idx < this.tokens.length) this.idx++; return t; }

  ignoreTrailingOperators() {
    while (this.tokens.length > 1) {
      const tok = this.tokens.at(-2);
      if (tok.kind !== "and" && tok.kind !== "or" && tok.kind !== "not") break;
      const before = this.tokens.at(-3);
      if (before?.kind === "colon" && before.pos + 1 === tok.pos) break;
      this.tokens.splice(this.tokens.length - 2, 1);
      this.hints.unshift(`ignoring the ${tok.text} at the end`);
    }
  }
  isLooseOrAt(i) {
    const [before, tok, after] = [this.tokens[i - 1], this.tokens[i], this.tokens[i + 1]];
    return tok?.kind === "word" && tok.text.toLowerCase() === "or"
      && !!before && ["word", "quoted", "rparen", "rbrace"].includes(before.kind) && !!after && canStartTerm(after.kind);
  }
  isDashAt(i) {
    const [tok, next] = [this.tokens[i], this.tokens[i + 1]];
    return tok?.kind === "word" && (/^-\p{L}/u.test(tok.text)
      || (tok.text === "-" && next?.pos === tok.pos + 1 && ["quoted", "lparen", "lbrace"].includes(next.kind)));
  }
  isFieldAt(i) { return this.tokens[i]?.kind === "word" && this.tokens[i + 1]?.kind === "colon" && isField(this.tokens[i].text); }

  // A word before a `:` that is not a field is text, with all that is glued to it (12:30, re:hello).
  collectTextWord() {
    const tok = this.consume();
    if (this.peek().kind !== "colon") return tok.text;
    const word = tok.text.toLowerCase(), suggestion = GMAIL_ONLY.includes(word) ? null : suggestField(word);
    const doubt = GMAIL_ONLY.includes(word) ? `${word}: is a Gmail search operator Conduit's filters don't have`
      : suggestion ? `${tok.text}: isn't a field: did you mean ${suggestion}:?` : null;
    if (doubt) { this.hints.push(doubt); this.doubts.push({ message: doubt, at: tok.pos }); }
    const glued = this.input.slice(this.peek().pos).match(/^(?:[^\s(){}"]|"(?:\\.|[^"\\])*")*/)[0];
    const end = this.peek().pos + glued.length;
    while (this.peek().kind !== "eof" && this.peek().pos < end) this.consume();
    return this.input.slice(tok.pos, end);
  }

  parseExpr() {
    const children = [this.parseAndExpr()];
    while (this.peek().kind === "or" || this.isLooseOrAt(this.idx)) {
      if (this.peek().kind !== "or") this.hints.push(`reading ${this.peek().text} as OR`);
      this.consume();
      children.push(this.parseAndExpr());
    }
    return children.length === 1 ? children[0] : { kind: "or", children: flatten(children, "or") };
  }
  parseAndExpr() {
    const children = [this.parseUnary()];
    while (!this.isLooseOrAt(this.idx)) {
      if (this.peek().kind === "and") this.consume();
      else if (!canStartTerm(this.peek().kind)) break;
      children.push(this.parseUnary());
    }
    return children.length === 1 ? children[0] : { kind: "and", children: flatten(children, "and") };
  }
  parseUnary() {
    const tok = this.peek();
    if (this.isDashAt(this.idx)) {
      this.hints.push(`reading - at ${tok.pos + 1} as NOT`);
      if (tok.text === "-") this.consume();
      else this.tokens[this.idx] = { ...tok, text: tok.text.slice(1), pos: tok.pos + 1 };
      return { kind: "not", children: [this.parseUnary()] };
    }
    if (tok.kind === "not") { this.consume(); return { kind: "not", children: [this.parseUnary()] }; }
    return this.parseTerm();
  }
  parseTerm() {
    const tok = this.peek();
    if (tok.kind === "lparen") {
      this.consume();
      const n = this.parseExpr();
      this.close("rparen", tok);
      return { ...n, grouped: true };
    }
    // Gmail's {a b}: any of the terms.
    if (tok.kind === "lbrace") {
      this.consume();
      const children = [];
      while (!["rbrace", "eof"].includes(this.peek().kind)) {
        if (this.peek().kind === "or" || this.peek().kind === "and") { this.consume(); continue; }
        children.push(this.parseUnary());
      }
      if (!children.length) throw new FilterError("{ } holds no terms", tok.pos);
      this.close("rbrace", tok);
      return children.length === 1 ? children[0] : { kind: "or", grouped: true, children: flatten(children, "or") };
    }
    if (tok.kind === "quoted") return { kind: "text", value: this.consume().text };
    if (tok.kind === "word") return this.isFieldAt(this.idx) ? this.parseField() : { kind: "text", value: this.collectTextWord() };
    if (tok.kind === "eof") throw new FilterError("unexpected end of filter", tok.pos);
    throw new FilterError(`unexpected ${JSON.stringify(tok.text)}`, tok.pos);
  }
  close(kind, open) {
    if (this.peek().kind === "eof") this.hints.push(`closing the ${open.text} at ${open.pos + 1}`);
    else if (this.peek().kind !== kind) throw new FilterError(`missing '${kind === "rparen" ? ")" : "}"}'`, this.peek().pos);
    else this.consume();
  }

  parseField() {
    const fieldTok = this.consume(), field = fieldTok.text.toLowerCase();
    this.consume();
    const next = this.peek();
    if (MULTI.includes(field)) {
      // Gmail's subject:(a b) and from:{a b}: the field holds for each bare term inside.
      if (next.kind === "lparen" || next.kind === "lbrace") return scope(this.parseTerm(), field);
      return { kind: "field", field, value: this.collectValue(field).trim() };
    }
    if (next.kind !== "word" && next.kind !== "quoted") throw this.missing(field);
    let value = this.consume().text.trim().toLowerCase();
    const allowed = SINGLE[field];
    if (allowed === SPAN && /^\d+$/.test(value) && /^[dmy]$/i.test(this.peek().kind === "word" ? this.peek().text : "")) {
      value += this.consume().text.toLowerCase();
      this.hints.push(`joining spaces in ${field}:${value}`);
    }
    if (Array.isArray(allowed)) {
      const list = allowed.length > 1 ? `${allowed.slice(0, -1).join(", ")} or ${allowed.at(-1)}` : allowed[0];
      if (!allowed.includes(value)) throw new FilterError(`${field}: expects ${list}`, next.pos);
      return { kind: "field", field, value };
    }
    if (allowed === SPAN) {
      if (!SPAN.test(value)) throw new FilterError(`${field}: expects a number and d, m or y, such as ${field}:7d`, next.pos);
      return { kind: "field", field, value: value.replace(/^0+(?=\d)/, "") };
    }
    if (!dayStart(value)) throw new FilterError(`${field}: expects a date, such as ${field}:2026/10/01`, next.pos);
    return { kind: "field", field, value: value.replace(/-/g, "/") };
  }
  // A value runs on, word by word, until the next field, operator, -term, bracket or quoted text.
  collectValue(field) {
    if (this.peek().kind === "quoted") return this.consume().text;
    const words = [];
    while (this.peek().kind === "word") {
      if (words.length && (this.isFieldAt(this.idx) || this.tokens[this.idx + 1]?.kind === "colon")) break;
      if (this.isDashAt(this.idx) || this.isLooseOrAt(this.idx)) break;
      words.push(this.collectTextWord());
    }
    if (!words.length) throw this.missing(field);
    return words.join(" ");
  }
  missing(field) {
    const tok = this.peek();
    return new FilterError(tok.kind === "eof" || tok.kind === "rparen" ? `${field}: missing value` : `${field}: invalid value near ${JSON.stringify(tok.text)}`, tok.pos);
  }
}

const scope = (node, field) => node.kind === "text" ? { kind: "field", field, value: node.value }
  : node.children ? { ...node, children: node.children.map((c) => scope(c, field)) } : node;
const flatten = (children, kind) => children.flatMap((c) => c.kind === kind && !c.grouped ? c.children : [c]);

function suggestField(value) {
  if (NOT_FIELDS.includes(value)) return undefined;
  const prefixes = FIELDS.filter((field) => value.length >= 2 && field.startsWith(value));
  if (prefixes.length === 1) return prefixes[0];
  const distance = (field) => {
    let row = Array.from({ length: field.length + 1 }, (_, i) => i);
    for (let i = 0; i < value.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < field.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (value[i] === field[j] ? 0 : 1)));
      row = next;
    }
    return row[field.length];
  };
  const best = FIELDS.map((field) => ({ field, d: distance(field) })).sort((a, b) => a.d - b.d)[0];
  return best.d <= (value.length >= 4 ? 2 : 1) ? best.field : undefined;
}

/** A filter written in full, as it is stored: brackets around AND inside OR (and OR inside AND), operators in capitals, dates as YYYY/MM/DD. Reading it gives the same node. */
export function canonicalFilter(node) {
  if (!node) return "";
  if (node.kind === "text") return quote(node.value);
  if (node.kind === "field") return `${node.field}:${quote(node.value)}`;
  const inner = (c) => (c.kind === "and" || c.kind === "or") && c.kind !== node.kind ? `(${canonicalFilter(c)})` : canonicalFilter(c);
  if (node.kind === "not") return `NOT ${inner(node.children[0])}`;
  return node.children.map(inner).join(node.kind === "and" ? " AND " : " OR ");
}
const quote = (v) => !v ? '""'
  : /[\s(){}:"\\]/.test(v) || /^-\p{L}/u.test(v) || /^(and|or|not)$/i.test(v) ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : v;

const squash = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const eqFold = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
// Labels compare as Gmail writes them in a search: a hyphen stands for a space.
const labelFold = (s) => s.trim().toLowerCase().replace(/[\s-]+/g, " ");
function dayStart(value) {
  const m = DATE.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])], day = new Date(y, mo - 1, d);
  return day.getFullYear() === y && day.getMonth() === mo - 1 && day.getDate() === d ? day.getTime() : null;
}
function spanStart(value, now) {
  const [, n, unit] = SPAN.exec(value), at = new Date(now);
  if (unit === "d") at.setDate(at.getDate() - Number(n));
  else if (unit === "m") at.setMonth(at.getMonth() - Number(n));
  else at.setFullYear(at.getFullYear() - Number(n));
  return at.getTime();
}

/**
 * Whether a message passes a filter. `message`: { from: {name, address}, to: MailParty[], cc: MailParty[], subject, text,
 * date (ms), labels: string[] (label ids), labelNames: string[], category: the source's category or null, attachments, unread, starred };
 * `facts`: sorting.js factsOf(message); `answers`: a model's chance (0..1) for each `ask:` term, by the term's words — one not given
 * does not pass, nor does NOT of it; `now` (ms) is what older_than: and newer_than: count back from.
 */
export function matches(node, message, facts, answers = {}, now = Date.now()) {
  if (!node) return true;
  const squashed = new Map();
  const contains = (text, needle) => {
    const n = squash(needle);
    if (!n) return text.toLowerCase().includes(needle.trim().toLowerCase());
    if (!squashed.has(text)) squashed.set(text, squash(text));
    return squashed.get(text).includes(n);
  };
  const party = (p, v) => !v.includes("@") ? contains(p.name ?? "", v) || contains(p.address, v)
    : v.startsWith("@") ? p.address.toLowerCase().endsWith(v.toLowerCase()) : eqFold(p.address, v);
  const flags = { unread: message.unread, read: !message.unread, starred: message.starred, important: facts.important,
    known: facts.known, mailing: facts.bulk, robot: facts.robot, mine: facts.mine, direct: facts.direct };
  const kinds = { receipt: facts.receipt, delivery: facts.logistics, security: facts.security, action: facts.action };
  const field = ({ field, value }) => {
    switch (field) {
      case "from": return value.toLowerCase() === "me" ? facts.mine : party(message.from, value);
      case "to": return value.toLowerCase() === "me" ? !facts.listed : [...message.to, ...message.cc].some((p) => party(p, value));
      case "cc": return message.cc.some((p) => party(p, value));
      case "subject": return contains(message.subject, value);
      case "text": return contains(message.text, value);
      case "label": return (message.labelNames ?? []).some((name) => labelFold(name) === labelFold(value));
      case "category": return (message.category ?? "primary") === value;
      case "is": return !!flags[value];
      case "has": return !!message.attachments;
      case "kind": return !!kinds[value];
      case "older_than": return message.date < spanStart(value, now);
      case "newer_than": return message.date >= spanStart(value, now);
      case "after": return message.date >= dayStart(value);
      case "before": return message.date < dayStart(value);
    }
    return false;
  };
  // true, false, or undefined while an ask: it depends on has no answer.
  const verdict = (n) => {
    if (n.kind === "text") return !n.value.trim() || [message.subject, message.text, message.from.name ?? "", message.from.address].some((t) => contains(t, n.value));
    if (n.kind === "field") return n.field !== "ask" ? field(n) : Object.hasOwn(answers, n.value) ? answers[n.value] >= 0.7 : undefined;
    if (n.kind === "not") { const v = verdict(n.children[0]); return v === undefined ? undefined : !v; }
    let unknown = false;
    for (const c of n.children) {
      const v = verdict(c);
      if (v === (n.kind === "or")) return v;
      if (v === undefined) unknown = true;
    }
    return unknown ? undefined : n.kind === "and";
  };
  return verdict(node) === true;
}

/** The words of every `ask:` term in a filter: what a model must be asked before the filter can be decided. */
export const askTerms = (node) => !node ? [] : node.kind === "field" ? (node.field === "ask" && node.value ? [node.value] : [])
  : [...new Set((node.children ?? []).flatMap(askTerms))];

/** The language described for a person or an agent writing a filter. */
export const filterGuide = () => `A filter is a list of terms, written as in Gmail's search. A space between terms means AND, OR means either, NOT or a joined - leaves out, and brackets group.
Example: from:@github.com -is:read (subject:review OR kind:action)  (unread GitHub mail that asks for a review or an action)

TERMS (* marks Conduit's own, which Gmail's search lacks)
  invoice              subject, text or sender contains it; ignores case, spaces and punctuation
  "pull request"       this phrase, words together and in order
  {a b}                any of the terms: (a OR b)
  from:amazon          sender's name or address contains it; from:@amazon.com the domain, from:a@b.com exactly; from:me yours
  to:jo                a To or Cc recipient (name or address); to:me sent to you
  cc:jo                a Cc recipient
  subject:weekly plan  subject contains the phrase (a value runs on; subject:(a b) is each word in the subject)
  label:receipts       has this label, its whole name ignoring case; a hyphen stands for a space
  category:promotions  the source's tab: primary, promotions, social, updates or forums
  is:unread            unread, read, starred, important
  * is:known           known (you have written to the sender), mailing (a mailing list or newsletter), robot (an automated
                       sender), mine (you sent it), direct (sent to you alone)
  has:attachment       has an attachment
  older_than:7d        older than 7 days; d, m (months) or y; newer_than:2m within the last 2 months
  after:2026/10/01     on or after that day (local time); before:2026/10/01 before it; 2026-10-01 also reads
  * kind:receipt       receipt, delivery, security or action (it asks for something), read from its subject and text
  * text:tracking      the message text contains the phrase
  * ask:a bill to pay  a model judges it; passes when it is at least 70% sure, never before it has answered

PRECEDENCE: NOT binds tightest, then AND (or a space), then OR
  a b OR c             reads as (a AND b) OR c
  NOT a b              reads as (NOT a) AND b

FORGIVING (as you type; saving writes it in full)
  a or b               reads as a OR b
  -term                reads as NOT term; -50 and Coca-Cola stay text
  (a OR b              a missing ) or } is closed; a trailing AND, OR or NOT waits for more
  older_than:7 d       reads as older_than:7d
  12:30, re:hi         a word before : that isn't a field is text; saving refuses a mistyped field (subjct:) and Gmail
                       operators Conduit has not got (in:, bcc:, filename:, larger:, list:)

EXAMPLES
  category:promotions -is:starred older_than:30d          old promotions you didn't star
  from:me OR to:me                                        mail between you and someone
  is:robot -kind:security -kind:action                    automated mail that needs nothing
  label:"Work stuff" after:2026/01/01 has:attachment      this year's work files

GRAMMAR
  filter  = or { ( "OR" | "or" ) and } ;
  and     = unary { [ "AND" ] unary } ;            (* side by side = AND *)
  unary   = { "NOT" } [ "-" ] primary ;            (* -x: no space *)
  primary = "(" filter ")" | "{" unary { unary } "}" | quoted | field | text ;
  field   = multi ":" ( quoted | word { word } | "(" filter ")" | "{" unary { unary } "}" ) | single ":" ( word | quoted ) ;
  multi   = from | to | cc | subject | text | label | ask ;
  single  = category | is | has | kind | older_than | newer_than | after | before ;   (* any case *)
  word    = { char but space ( ) { } : " } ;      quoted = '"' { char | '\\"' | '\\\\' } '"' ;`;
