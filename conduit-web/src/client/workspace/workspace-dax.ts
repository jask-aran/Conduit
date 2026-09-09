import { StreamLanguage, type StringStream } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// Token rules are adapted from Microsoft Monaco Editor's MIT-licensed
// src/languages/definitions/msdax/msdax.ts at 714328ce. Copyright Microsoft.
// This port uses call syntax instead of a static function list so new DAX
// functions receive highlighting without a registry update.

type DaxMode = "base" | "block-comment" | "string" | "table" | "column";

type DaxState = {
  mode: DaxMode;
};

const keywords = new Set([
  "ANYREF",
  "ANYVAL",
  "ASC",
  "AT",
  "AXIS",
  "BY",
  "COLUMN",
  "DEFINE",
  "DENSIFY",
  "DESC",
  "EVALUATE",
  "EXPR",
  "EXPRESSION",
  "FUNCTION",
  "GROUP",
  "IN",
  "MEASURE",
  "NOT",
  "ORDER",
  "RETURN",
  "SCALAR",
  "SHAPE",
  "START",
  "TABLE",
  "TOTAL",
  "VAL",
  "VAR",
  "VISUAL",
  "WITH",
]);

const types = new Set([
  "BOOLEAN",
  "CURRENCY",
  "DATETIME",
  "DECIMAL",
  "DOUBLE",
  "INT64",
  "INTEGER",
  "MEASUREREF",
  "NUMERIC",
  "STRING",
  "TABLEREF",
  "TABLE",
  "VARIANT",
]);

function consumeDelimited(stream: StringStream, state: DaxState, delimiter: string) {
  while (!stream.eol()) {
    if (stream.next() !== delimiter) continue;
    if (stream.peek() === delimiter) {
      stream.next();
      continue;
    }
    state.mode = "base";
    break;
  }
}

function consumeBlockComment(stream: StringStream, state: DaxState) {
  while (!stream.eol()) {
    if (stream.next() !== "*" || stream.peek() !== "/") continue;
    stream.next();
    state.mode = "base";
    break;
  }
}

export const daxLanguage = StreamLanguage.define<DaxState>({
  name: "dax",
  startState: () => ({ mode: "base" }),
  token(stream, state) {
    if (state.mode === "block-comment") {
      consumeBlockComment(stream, state);
      return "comment";
    }
    if (state.mode === "string") {
      consumeDelimited(stream, state, "\"");
      return "string";
    }
    if (state.mode === "table") {
      consumeDelimited(stream, state, "'");
      return "dax-table";
    }
    if (state.mode === "column") {
      consumeDelimited(stream, state, "]");
      return "dax-column";
    }

    if (stream.eatSpace()) return null;
    if (stream.match(/^(?:\/\/+|--).*/)) return "comment";
    if (stream.match(/^\/\*/)) {
      state.mode = "block-comment";
      consumeBlockComment(stream, state);
      return "comment";
    }
    if (stream.match(/^(?:dt|N)"/i) || stream.match(/^"/)) {
      state.mode = "string";
      consumeDelimited(stream, state, "\"");
      return "string";
    }
    if (stream.match(/^'/)) {
      state.mode = "table";
      consumeDelimited(stream, state, "'");
      return "dax-table";
    }
    if (stream.match(/^\[/)) {
      state.mode = "column";
      consumeDelimited(stream, state, "]");
      return "dax-column";
    }
    if (stream.match(/^0[xX][0-9a-fA-F]*/)) return "number";
    if (stream.match(/^\$[+-]?\d*(?:\.\d*)?/)) return "number";
    if (stream.match(/^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/)) return "number";
    if (stream.match(/^(?:=>|==|<>|<=|>=|!=|&&|\|\|)/)) return "dax-operator";
    if (stream.match(/^[<>=!%&+\-*/|~^]/)) return "dax-operator";
    if (stream.match(/^[;,(){}]/)) return "dax-delimiter";

    const identifier = stream.match(/^[a-z_][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*/i);
    if (identifier) {
      const name = stream.current().toUpperCase();
      if (keywords.has(name)) return "dax-keyword";
      if (types.has(name)) return "dax-type";
      if (/^\s*\(/.test(stream.string.slice(stream.pos))) return "dax-function";
      if (name === "TRUE" || name === "FALSE") return "bool";
      if (name === "BLANK") return "atom";
      return "variableName";
    }

    stream.next();
    return null;
  },
  languageData: {
    closeBrackets: { brackets: ["(", "[", "{", "'", "\""] },
    commentTokens: { line: "--", block: { open: "/*", close: "*/" } },
  },
  tokenTable: {
    "dax-column": tags.propertyName,
    "dax-delimiter": tags.punctuation,
    "dax-function": tags.function(tags.variableName),
    "dax-keyword": tags.keyword,
    "dax-operator": tags.operator,
    "dax-table": tags.typeName,
    "dax-type": tags.typeName,
  },
});
