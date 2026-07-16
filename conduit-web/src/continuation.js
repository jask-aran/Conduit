export const CONTINUE_PROMPT = "Continue the immediately preceding assistant response from exactly where it stopped. Do not repeat completed text.";

function normalize(value) {
  return String(value || "").replaceAll("\r\n", "\n");
}

function exactOverlapLength(left, right) {
  if (!left || !right) return 0;
  const prefix = new Uint32Array(right.length);
  for (let index = 1, matched = 0; index < right.length; index += 1) {
    while (matched > 0 && right[index] !== right[matched]) matched = prefix[matched - 1];
    if (right[index] === right[matched]) matched += 1;
    prefix[index] = matched;
  }
  let matched = 0;
  const start = Math.max(0, left.length - right.length);
  for (let index = start; index < left.length; index += 1) {
    while (matched > 0 && left[index] !== right[matched]) matched = prefix[matched - 1];
    if (left[index] === right[matched]) matched += 1;
    if (matched === right.length && index < left.length - 1) matched = prefix[matched - 1];
  }
  return matched;
}

// Experimental and intentionally removable: only exact suffix/prefix overlap is joined.
export function mergeContinuation(partial, continuation) {
  const left = normalize(partial);
  const right = normalize(continuation);
  return left + right.slice(exactOverlapLength(left, right));
}
