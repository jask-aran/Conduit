import { StreamLanguage } from "@codemirror/language";
import { tags } from "@lezer/highlight";

type CsvState = {
  column: number;
  quoted: boolean;
};

const columnTokens = [
  "csv-blue",
  "csv-green",
  "csv-amber",
  "csv-purple",
  "csv-cyan",
  "csv-yellow",
] as const;

export const csvLanguage = StreamLanguage.define<CsvState>({
  name: "csv",
  startState: () => ({ column: 0, quoted: false }),
  token(stream, state) {
    if (stream.sol() && !state.quoted) state.column = 0;
    if (stream.peek() === "," && !state.quoted) {
      stream.next();
      state.column += 1;
      return "csv-separator";
    }

    const token = columnTokens[state.column % columnTokens.length] ?? "csv-blue";
    while (!stream.eol()) {
      const character = stream.next();
      if (character === "\"") {
        if (state.quoted && stream.peek() === "\"") stream.next();
        else state.quoted = !state.quoted;
      } else if (character === "," && !state.quoted) {
        stream.backUp(1);
        break;
      }
    }
    return token;
  },
  blankLine(state) {
    if (!state.quoted) state.column = 0;
  },
  tokenTable: {
    "csv-blue": tags.heading,
    "csv-green": tags.string,
    "csv-amber": tags.number,
    "csv-purple": tags.keyword,
    "csv-cyan": tags.variableName,
    "csv-yellow": tags.typeName,
    "csv-separator": tags.separator,
  },
});

export function isCsvFile(path: string) {
  return /\.csv$/i.test(path);
}
