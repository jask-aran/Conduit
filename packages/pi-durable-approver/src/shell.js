/**
 * A shell command as the simple commands it runs, so a judge or a rule sees each one: split at every way the shell
 * starts another command (; & && || | and newlines), with leading `NAME=value` assignments and `env` stripped (a
 * denylist matched the text after an assignment and missed the command: CVE-2026-48721).
 *
 * Returns null when the command cannot be read safely: substitutions ($( ), backticks, <( ), >( )), unbalanced
 * quotes, a backslash-newline, or heredocs. Null means "judge it as unreadable", never "allow".
 */
export function canonicalShell(command) {
  if (typeof command !== "string") return null;
  const text = command.trim();
  if (!text) return [];
  if (/\\\r?\n/.test(text) || /<<-?\s*['"]?\w/.test(text)) return null;
  const commands = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (quote) {
      // Inside single quotes nothing is special; inside double quotes, substitutions still run.
      if (quote === '"' && (char === "`" || (char === "$" && next === "("))) return null;
      if (quote === '"' && char === "\\" && next !== undefined) { current += char + next; i++; continue; }
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; current += char; continue; }
    if (char === "\\" && next !== undefined) { current += char + next; i++; continue; }
    if (char === "`" || (char === "$" && next === "(") || ((char === "<" || char === ">") && next === "(")) return null;
    if (char === ";" || char === "\n" || char === "\r" || char === "|" || char === "&") {
      // `&>` and `>&` are redirections, not separators.
      if (char === "&" && (next === ">" || current.endsWith(">"))) { current += char; continue; }
      commands.push(current);
      current = "";
      if ((char === "&" && next === "&") || (char === "|" && next === "|") || (char === "|" && next === "&")) i++;
      continue;
    }
    current += char;
  }
  if (quote) return null;
  commands.push(current);
  return commands.map(stripPrefixes).filter(Boolean);
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s'"]*)\s+/;
function stripPrefixes(simple) {
  let rest = simple.trim();
  for (;;) {
    const assignment = rest.match(ASSIGNMENT);
    if (assignment) { rest = rest.slice(assignment[0].length).trimStart(); continue; }
    // `env [-i] [NAME=value…] command`: the command is what runs.
    const env = rest.match(/^env(?:\s+-[A-Za-z-]+)*\s+/);
    if (env) { rest = rest.slice(env[0].length).trimStart(); continue; }
    return rest;
  }
}
