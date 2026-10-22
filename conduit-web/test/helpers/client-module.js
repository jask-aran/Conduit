import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

/**
 * Client code Node cannot load as is: modules that use the app's `@/`
 * aliases or TSX. `source` is an ES module of re-exports, relative to test/;
 * it is bundled with the app's tsconfig and its exports returned.
 */
export async function importClient(source) {
  const { outputFiles } = buildSync({
    stdin: { contents: source, resolveDir: fileURLToPath(new URL("..", import.meta.url)) },
    tsconfig: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)),
    bundle: true, platform: "node", format: "esm", jsx: "transform", write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
