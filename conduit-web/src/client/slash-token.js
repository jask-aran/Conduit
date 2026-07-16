const TRIGGERS = new Set(["/", "@", "$"]);

export function detectCommandToken(value, caret = String(value || "").length) {
  const text = String(value || "");
  const first = text.search(/\S/);
  if (first < 0 || !TRIGGERS.has(text[first])) return null;
  const whitespace = text.slice(first).search(/\s/);
  const end = whitespace < 0 ? text.length : first + whitespace;
  if (caret < first + 1 || caret > end) return null;
  // Reserved provider seam: @ will address files/context and $ will address skills in a later sprint.
  return { trigger: text[first], query: text.slice(first + 1, caret), start: first, end };
}

export function replaceCommandToken(value, token, replacement = "") {
  return `${value.slice(0, token.start)}${replacement}${value.slice(token.end)}`;
}
