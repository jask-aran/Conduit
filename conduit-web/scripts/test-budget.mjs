#!/usr/bin/env node
// The tests only ever shrink: their count (test()/it() call sites) and their lines (everything under test/) may not
// rise above the recorded budget (test/budget.json). `--record` writes the current figures, and only if no higher.
import fs from "node:fs";
import path from "node:path";

const root = new URL("../test/", import.meta.url).pathname;
const budgetFile = path.join(root, "budget.json");
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? files(full) : /\.(m?[jt]sx?)$/.test(entry.name) ? [full] : [];
});
let tests = 0, lines = 0;
for (const file of files(root)) {
  const text = fs.readFileSync(file, "utf8");
  lines += text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  tests += (text.match(/(?<![\w.])(?:test|it)(?:\.(?:only|skip|todo))?\s*\(/g) || []).length;
}
const budget = fs.existsSync(budgetFile) ? JSON.parse(fs.readFileSync(budgetFile, "utf8")) : null;
if (process.argv.includes("--record")) {
  if (budget && (tests > budget.tests || lines > budget.lines)) {
    console.error(`test budget: cannot record a rise (${tests} tests, ${lines} lines; budget ${budget.tests}, ${budget.lines})`);
    process.exit(1);
  }
  fs.writeFileSync(budgetFile, `${JSON.stringify({ tests, lines }, null, 2)}\n`);
  console.log(`test budget recorded: ${tests} tests, ${lines} lines`);
} else if (!budget) {
  console.error("test budget: none recorded (node scripts/test-budget.mjs --record)");
  process.exit(1);
} else if (tests > budget.tests || lines > budget.lines) {
  console.error(`test budget exceeded: ${tests} tests (budget ${budget.tests}), ${lines} lines (budget ${budget.lines}). Cut a test that does not assert durable behaviour.`);
  process.exit(1);
} else console.log(`test budget: ${tests}/${budget.tests} tests, ${lines}/${budget.lines} lines${tests < budget.tests || lines < budget.lines ? " (lower: record it with --record)" : ""}`);
