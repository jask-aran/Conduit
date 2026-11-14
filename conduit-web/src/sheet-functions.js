import { CellError, ErrorType, FunctionArgumentType, HyperFormula } from "hyperformula";

/*
 * Functions a spreadsheet's workbooks use that the engine lacks, registered for every engine once this module is loaded (sheet-format.js imports it,
 * so the hub and the page compute the same values).
 */
const { NUMBER, RANGE, NOERROR } = FunctionArgumentType;
const number = (value) => typeof value === "number" ? value : typeof value?.val === "number" ? value.val : undefined;
const RANKED = { parameters: [{ argumentType: NUMBER }, { argumentType: RANGE }, { argumentType: NUMBER, defaultValue: 0 }] };
const Sum = (sum, count) => ({ sum, count });
// SUMIFS's own plugin, so AVERAGEIFS takes the same criteria, wildcards and per-range cache.
class SpreadsheetGaps extends HyperFormula.getFunctionPlugin("SUMIFS") {
  /** 1 + how many numbers in the range beat `n` (largest first unless `order` is not 0); text, booleans and blanks are skipped, an error is returned. */
  ranked(ast, state, name, average) {
    return this.runFunction(ast.args, state, this.metadata(name), (n, range, order) => {
      let beat = 0, ties = 0;
      for (const cell of range.valuesFromTopLeftCorner()) {
        if (cell instanceof CellError) return cell;
        const value = number(cell);
        if (value === undefined) continue;
        if (value === n) ties++; else if (order ? value < n : value > n) beat++;
      }
      return ties ? 1 + beat + (average ? (ties - 1) / 2 : 0) : new CellError(ErrorType.NA);
    });
  }
  rank(ast, state) { return this.ranked(ast, state, "RANK", false); }
  rankeq(ast, state) { return this.ranked(ast, state, "RANK.EQ", false); }
  rankavg(ast, state) { return this.ranked(ast, state, "RANK.AVG", true); }
  /** Only numbers in the average range count; an error there in a matching row is the result. */
  averageifs(ast, state) {
    return this.runFunction(ast.args, state, this.metadata("AVERAGEIFS"), (values, ...conditions) => {
      const total = this.computeConditionalAggregationFunction(values, conditions, "AVERAGEIFS", Sum(0, 0),
        (left, right) => left instanceof CellError ? left : right instanceof CellError ? right : Sum(left.sum + right.sum, left.count + right.count),
        (cell) => cell instanceof CellError ? cell : number(cell) === undefined ? Sum(0, 0) : Sum(number(cell), 1));
      return total instanceof CellError ? total : total.count ? total.sum / total.count : new CellError(ErrorType.DIV_BY_ZERO);
    });
  }
}
SpreadsheetGaps.implementedFunctions = {
  RANK: { method: "rank", ...RANKED }, "RANK.EQ": { method: "rankeq", ...RANKED }, "RANK.AVG": { method: "rankavg", ...RANKED },
  AVERAGEIFS: { method: "averageifs", parameters: [{ argumentType: RANGE }, { argumentType: RANGE }, { argumentType: NOERROR }], repeatLastArgs: 2 },
};
const names = Object.fromEntries(Object.keys(SpreadsheetGaps.implementedFunctions).map((name) => [name, name]));
HyperFormula.registerFunctionPlugin(SpreadsheetGaps, { enGB: names, enUS: names });

/** Bare TRUE and FALSE as a spreadsheet reads them (`=VLOOKUP(A1,B:C,2,FALSE)`): the engine knows them only as functions. */
export const NAMES = [{ name: "TRUE", expression: "=TRUE()" }, { name: "FALSE", expression: "=FALSE()" }];
