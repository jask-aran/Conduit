import assert from "node:assert/strict";
import test from "node:test";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { csvLanguage, isCsvFile } from "../src/client/workspace/csv-language.ts";

test("CSV fields receive repeating column colours without splitting quoted commas", () => {
  const source = 'Item,Price,"Region, Name",Status\nFuse,12.5,"AU, East",Active';
  const highlighted = [];
  highlightTree(csvLanguage.parser.parse(source), classHighlighter, (from, to, classes) => {
    highlighted.push({ from, text: source.slice(from, to), classes });
  });

  const firstRow = highlighted.filter((token) => token.from < source.indexOf("\n"));
  assert.deepEqual(firstRow.map((token) => token.text), [
    "Item",
    ",",
    "Price",
    ",",
    '"Region, Name"',
    ",",
    "Status",
  ]);
  assert.notEqual(firstRow[0].classes, firstRow[2].classes);
  assert.equal(firstRow[4].text, '"Region, Name"');
  assert.equal(highlighted.find((token) => token.text === "Fuse")?.classes, firstRow[0].classes);
});

test("CSV filename matching is case-insensitive and exact", () => {
  assert.equal(isCsvFile("report.CSV"), true);
  assert.equal(isCsvFile("report.csv.txt"), false);
});
