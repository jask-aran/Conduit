#!/usr/bin/env node
// Conduit's conventions, checked. Each rule below is here because agents kept breaking it; the reason sits with the
// rule.
//
//   node scripts/check-conventions.mjs           list every problem, exit 1 if any (npm run typecheck)
//   node scripts/check-conventions.mjs --warn    list every problem, exit 0, save a summary (npm run build)
//   node scripts/check-conventions.mjs --summary print the saved summary as one line (start-conduit.sh restart)
//
// A line that must break a rule carries `conventions-ok: <reason>` in a comment on it or the line above.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const summaryFile = path.join(root, "node_modules", ".cache", "conduit-conventions.txt");
const mode = process.argv[2] || "--check";

if (mode === "--summary") {
  console.log(fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, "utf8").trim() : "Conventions: not checked (no build yet)");
  process.exit(0);
}

// Forward slashes on Windows too: every rule below matches paths with them.
const rel = (file) => path.relative(root, file).split(path.sep).join("/");
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};
const files = walk(path.join(root, "src"));
const inDir = (file, dir) => rel(file).startsWith(dir + "/");
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const allowed = (lines, line) => /conventions-ok/.test(lines[line - 1] || "") || /conventions-ok/.test(lines[line - 2] || "");
// Blank out comments, keeping offsets, so commented-out code and prose don't count. A /* straight after a word or a
// quote is in a string (accept="image/*"), not a comment.
const stripComments = (text, css) => text.replace(css ? /\/\*[\s\S]*?\*\//g : /(?<![\w"'`])\/\*[\s\S]*?\*\/|(?<![:"'`\\])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

const problems = [];
const report = (file, text, index, rule, fix) => {
  const line = lineOf(text, index);
  const entry = `${rel(file)}:${line}  ${rule}: ${fix}`;
  // The text given here has its comments blanked, so the exemption is read from the file as written.
  if (!allowed(fs.readFileSync(file, "utf8").split("\n"), line) && !problems.includes(entry)) problems.push(entry);
};
const each = (file, text, regex, fn) => { for (const m of text.matchAll(regex)) fn(m); };

const appCode = files.filter((f) => /\.tsx$/.test(f) && inDir(f, "src/client"));
const uiCode = files.filter((f) => /\.tsx?$/.test(f) && (inDir(f, "src/client") || inDir(f, "src/components/ui") || inDir(f, "src/components/markup")));
// The gallery is dev tooling that lays out specimens; its own CSS is not app styling.
const css = files.filter((f) => f.endsWith(".css") && !inDir(f, "src/gallery"));
const tokenFiles = ["foundations.css", "theme.css", "palettes.css"];
const serverCode = files.filter((f) => f.endsWith(".js") && inDir(f, "src/server"));

// 1. App markup wearing library classes. The app calls components; it does not write their markup with `ui-*`
//    classes or raw controls. Such classes kept being added and removed again.
for (const file of appCode) {
  const text = stripComments(fs.readFileSync(file, "utf8"));
  each(file, text, /\bclass(?:List)?=\{?\s*["'`][^"'`]*\bui-[a-z]/g, (m) =>
    report(file, text, m.index, "library class in app code", "use the component from components/ui instead of its ui-* class (DESIGN.md Components v2)"));
  each(file, text, /<(button|input|select|textarea)\b/g, (m) =>
    report(file, text, m.index, `raw <${m[1]}>`, "use the components/ui control (DESIGN.md Components v2)"));
}

// 3. A fixed delay where the UI should wait for an event: a literal 150-600 ms timer is outlasted by a slowed
//    Animation speed, or nothing clears it. Wait for the motion to end (whenMotionEnds), use a duration token, or name
//    the constant when it is a real backoff.
for (const file of uiCode) {
  const text = stripComments(fs.readFileSync(file, "utf8"));
  for (const m of text.matchAll(/\bsetTimeout\s*\(/g)) {
    let depth = 0, i = m.index + m[0].length - 1, lastComma = -1, quote = null;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) { if (c === quote && text[i - 1] !== "\\") quote = null; continue; }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) { depth--; if (depth === 0) break; }
      else if (c === "," && depth === 1) lastComma = i;
    }
    if (lastComma > 0 && /^\s*\d[\d_]*\s*$/.test(text.slice(lastComma + 1, i)))
      report(file, text, m.index, "literal setTimeout delay", "wait for the event (whenMotionEnds, a duration token), or name the constant if it is a real backoff");
  }
}

// 4. Hand-kept "latest ask wins" counters compared after an await. createLatest (client/state/latest.ts) is that
//    machine once; counters creep back as `const id = ++counter`.
for (const file of uiCode.filter((f) => !f.endsWith(path.join("state", "latest.ts")))) {
  const text = stripComments(fs.readFileSync(file, "utf8"));
  each(file, text, /\bconst\s+\w+\s*=\s*\+\+[\w.]+/g, (m) =>
    report(file, text, m.index, "hand-kept latest counter", "use createLatest from client/state/latest.ts"));
}

// 5. Literal values where a token belongs. Outside the token files, sizes, colours, durations and layers come from
//    tokens; literals crept back in by the hundred. 0 and 1px pass (whole-pixel lines); media and container queries
//    pass.
// 6. Frost redeclared outside frost.css: each surface's own blur and fill made several different frosts.
// 8. Focus rings: there are never focus rings; foundations.css removes outlines globally.
for (const file of css) {
  const text = stripComments(fs.readFileSync(file, "utf8"), true);
  const name = path.basename(file);
  if (!tokenFiles.includes(name)) {
    for (const m of text.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)) {
      const [, prop, value] = m;
      const before = text.lastIndexOf("{", m.index);
      if (/@(media|container|supports)[^{]*$/.test(text.slice(text.lastIndexOf("}", before) + 1, before))) continue;
      const at = m.index + (m[0].length - value.length);
      for (const px of value.matchAll(/(?<![\w.-])(\d*\.?\d+)px\b/g))
        if (parseFloat(px[1]) >= 2) report(file, text, at, "literal px", `${prop}: ${px[0]} -- use a size token (foundations.css)`);
      // A mask's #000 is an opacity stop, not a colour.
      if (!/^(-webkit-)?mask/.test(prop) && /#[0-9a-fA-F]{3,8}\b|\b(?:oklch|rgba?|hsla?)\(/.test(value))
        report(file, text, at, "literal colour", `${prop} -- use a colour token (theme.css, palettes.css)`);
      // 0s and the reduced-motion 0.01ms are "no motion", not a duration.
      const durations = [...value.matchAll(/(?<![\w.-])(\d*\.?\d+)(m?s)\b/g)].map(([, n, u]) => parseFloat(n) * (u === "s" ? 1000 : 1));
      if (/^(transition|animation)/.test(prop) && durations.some((ms) => ms > 0.01))
        report(file, text, at, "literal duration", `${prop} -- use a duration token (DESIGN.md Motion)`);
      if (prop === "z-index" && /^\s*\d+\s*$/.test(value) && parseInt(value, 10) >= 10)
        report(file, text, at, "literal z-index", "use a --layer-* token");
    }
  }
  if (name !== "frost.css" && !tokenFiles.includes(name)) {
    each(file, text, /(?:^|[;{\s])(backdrop-filter|-webkit-backdrop-filter|--frost-fill|--frost-blur)\s*:(?!\s*none\b)/g, (m) =>
      report(file, text, m.index, "frost outside frost.css", "use the Frost surface; don't set blur or fill here (DESIGN.md Frost)"));
  }
  each(file, text, /([^{}]*:focus[^{}]*)\{([^{}]*)\}/g, (m) => {
    if (/(?:^|;)\s*(outline|box-shadow)\s*:(?!\s*(?:none|0)\b)/.test(m[2]))
      report(file, text, m.index + m[1].search(/\S/), "focus ring", "remove it: DESIGN.md says never focus rings");
  });
}

// 7. Express handlers wrapped in try/catch that only call next(error). Express 5 passes a rejected handler on by
//    itself.
for (const file of serverCode) {
  const text = stripComments(fs.readFileSync(file, "utf8"));
  each(file, text, /catch\s*\(\s*(\w+)\s*\)\s*\{\s*(?:return\s+)?next\(\s*\1\s*\);?\s*\}/g, (m) =>
    report(file, text, m.index, "try/catch around next(error)", "remove the try/catch; Express 5 forwards the rejection"));
}

// 9. Markup's boundary (components/markup/host.ts). The tool is lifted into other projects, so it
//    takes everything of the app's through its MarkupHost: it imports solid-js, its own folder and the library, and
//    nothing else. The receiver's store likewise runs under `conduit-markup serve` with no hub: Node's own modules only.
//    The document editor (components/document/host.ts) keeps the same boundary through its DocumentHost, with what it is
//    built on besides: the document format, which the hub shares, and the editor's own packages.
for (const [dir, host, more] of [["markup", "MarkupHost", ""], ["document", "DocumentHost", "|@\\/document-format\\.js|@tiptap\\/[\\w-]+(?:\\/[\\w-]+)?|solid-tiptap|yjs|y-prosemirror"]]) {
  for (const file of files.filter((f) => /\.tsx?$/.test(f) && inDir(f, `src/components/${dir}`))) {
    const text = stripComments(fs.readFileSync(file, "utf8"));
    each(file, text, /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g, (m) => {
      const from = m[1];
      if (!new RegExp(`^(solid-js(\\/.*)?|\\.\\/[\\w-]+|@\\/components\\/ui(\\/.*)?${more})$`).test(from)) report(file, text, m.index, `${dir} boundary`, `"${from}" is the app's: pass it through ${host}`);
    });
  }
}
{
  const file = path.join(root, "src/server/markup-store.js");
  const text = stripComments(fs.readFileSync(file, "utf8"));
  each(file, text, /\bfrom\s+["']([^"']+)["']/g, (m) => { if (!m[1].startsWith("node:")) report(file, text, m.index, "markup boundary", `"${m[1]}" is not Node's own: the store runs with no hub`); });
}

// 11. Selectors Chromium cannot narrow, in a stylesheet (the gallery's and motion-rules.ts's included). Measured adding a block to a 400-block paper:
//     - :has(): while any is in the page, ancestors are re-checked on DOM changes (3.9 ms of layout work a block, 0.4 ms with none).
//     - a sibling combinator led by a compound with no class, id or attribute (`* + *`, `li + li`, `:not(.a) + p`): everything under the parent
//       is looked through, and restyled where it matches, each time a child is added or removed (5.3 ms of style a block, 0.24 ms with none).
for (const file of files.filter((f) => f.endsWith(".css") || rel(f) === "src/client/motion-rules.ts")) {
  const text = stripComments(fs.readFileSync(file, "utf8"), file.endsWith(".css"));
  each(file, text, /:has\(/g, (m) => report(file, text, m.index, "has() in CSS", "have the component that renders the element set a data attribute, and select on that"));
  if (!file.endsWith(".css")) continue;
  each(file, text, /[^{}]+(?=\{)/g, (m) => {
    if (m[0].trimStart().startsWith("@")) return;
    let depth = 0;
    for (let at = 0; at < m[0].length; at++) {
      const char = m[0][at];
      if (char === "(" || char === "[") depth++;
      else if (char === ")" || char === "]") depth--;
      // In a bracket it is an attribute's operator; before `=` likewise.
      else if ((char === "+" || char === "~") && m[0][at + 1] !== "=" && !/\[[^\]]*$/.test(m[0].slice(0, at))) {
        const lead = m[0].slice(0, at).trimEnd().match(/(?:[^\s>+~,()[\]]|\[[^\]]*\]|\([^()]*(?:\([^()]*\)[^()]*)*\))*$/)[0];
        if (!/[.#[]/.test(lead.replace(/:not\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ""))) report(file, text, m.index + at, "bare sibling selector", `"${lead || "*"} ${char}" starts at no class: give the element before it a class, or say it with :not(:first-child)`);
      }
    }
  });
}

// 2. Unused locals, imports and parameters drift back once cleared. The flags stay out of tsconfig.json so a plain
//    type error and leftover code are reported separately.
try {
  execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["--noEmit", "--noUnusedLocals", "--noUnusedParameters", "--pretty", "false"], { cwd: root, stdio: "pipe" });
} catch (error) {
  for (const line of String(error.stdout).split("\n")) {
    const m = line.match(/^(.+?)\((\d+),\d+\): error TS6(?:133|138|192|196|198|199|205): (.+)$/);
    if (m) problems.push(`${m[1]}:${m[2]}  unused: ${m[3]}`);
  }
}

// 10. Size limits on tests and documents. Both were added faster than they were kept true, so one that is needed
//     replaces more than it adds. Fixed ceilings: LIMITS below. Figures that only fall: budgets.json (the tests' total
//     lines, and the repo's Markdown lines and files outside templates/ and docs/, where a plan is as long as it needs). sourceLines is every .ts, .tsx, .js and .css
//     line under src/: raised when planned feature work needs the room (117,000 for Markup & Conduit Documents), lowered after a cleanup.
const LIMITS = { tests: 300, testFiles: 100, testFileLines: 300, sourceLines: 123_000 };
const budgetFile = path.join(root, "budgets.json");
const testFiles = walk(path.join(root, "test")).filter((f) => /\.m?[jt]sx?$/.test(f));
const lineCount = (file) => { const text = fs.readFileSync(file, "utf8"); return text.split("\n").length - (text.endsWith("\n") ? 1 : 0); };
const tests = testFiles.reduce((n, f) => n + (fs.readFileSync(f, "utf8").match(/(?<![\w.])(?:test|it)(?:\.(?:only|skip|todo))?\s*\(/g) || []).length, 0);
if (tests > LIMITS.tests) problems.push(`test/  test count: ${tests} tests, limit ${LIMITS.tests}; cut one that does not assert durable behaviour`);
if (testFiles.length > LIMITS.testFiles) problems.push(`test/  test files: ${testFiles.length} files, limit ${LIMITS.testFiles}`);
for (const file of testFiles) {
  const lines = lineCount(file);
  if (lines > LIMITS.testFileLines) report(file, "", 0, "test file length", `${lines} lines, limit ${LIMITS.testFileLines}; cut tests that do not assert durable behaviour`);
}
const sourceLines = files.filter((f) => /\.(tsx?|js|css)$/.test(f)).reduce((n, f) => n + lineCount(f), 0);
if (sourceLines > LIMITS.sourceLines) problems.push(`src/  source lines: ${sourceLines} lines, limit ${LIMITS.sourceLines}; remove code before adding more`);
const counts = { testLines: testFiles.reduce((n, f) => n + lineCount(f), 0) };
try {
  const repo = path.resolve(root, "..");
  const markdown = execFileSync("git", ["-C", repo, "ls-files", "*.md", ":!templates", ":!docs"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .split("\n").filter((f) => f && fs.existsSync(path.join(repo, f)));
  counts.markdownLines = markdown.reduce((n, f) => n + lineCount(path.join(repo, f)), 0);
  counts.markdownFiles = markdown.length;
} catch { /* a packaged copy has no git; the other limits still hold */ }
const budgets = fs.existsSync(budgetFile) ? JSON.parse(fs.readFileSync(budgetFile, "utf8")) : {};
const over = Object.entries(counts).filter(([name, value]) => name in budgets && value > budgets[name]);
for (const [name, value] of over) problems.push(`budgets.json  budget: ${name} is ${value}, budget ${budgets[name]}; remove more than you add`);
// A fall is recorded at once, so the room it left cannot be used up again before someone remembers to record it.
const fallen = Object.entries(counts).filter(([name, value]) => !(name in budgets) || value < budgets[name]);
if (fallen.length) fs.writeFileSync(budgetFile, `${JSON.stringify({ ...budgets, ...Object.fromEntries(fallen) }, null, 2)}\n`);

for (const problem of problems) console.log(problem);
const byRule = {};
for (const p of problems) { const rule = p.split("  ")[1].split(":")[0]; byRule[rule] = (byRule[rule] || 0) + 1; }
const summary = problems.length
  ? `Conventions: ${problems.length} problems (${Object.entries(byRule).map(([r, n]) => `${n} ${r}`).join(", ")}); npm run typecheck lists them`
  : "Conventions: clean";
console.log(summary);
if (fallen.length) console.log(`budgets.json lowered (${fallen.map(([name, value]) => `${name} ${value}`).join(", ")}): commit it with your change`);
if (mode === "--warn") {
  fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
  fs.writeFileSync(summaryFile, summary + "\n");
} else if (problems.length) process.exitCode = 1;
