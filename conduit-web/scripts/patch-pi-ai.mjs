// Bridges a gap in pi-ai until it is closed upstream: OpenAI Responses labels every message `commentary` or
// `final_answer` when the message opens (its output item's `phase`), and pi-ai has it then, but writes it to the
// text block (`textSignature`) only at text_end. Conduit draws text by that label as it streams (DESIGN.md, Turns),
// so the label is set when the block starts too. Run on install; idempotent; fails loudly if pi-ai's code moved.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// The package's own entry, resolved as pi-durable resolves it; the file sits beside it.
const file = fileURLToPath(new URL("./api/openai-responses-shared.js", import.meta.resolve("@earendil-works/pi-ai")));
const before = `            applyMessagePhaseStopReason(item);
            const block = { type: "text", text: "" };`;
const after = `            applyMessagePhaseStopReason(item);
            const block = { type: "text", text: "", ...(item.phase ? { textSignature: encodeTextSignatureV1(item.id, item.phase) } : {}) }; /* conduit: phase at start */`;
const source = fs.readFileSync(file, "utf8");
if (source.includes("/* conduit: phase at start */")) process.exit(0);
if (source.split(before).length !== 2) {
  console.error(`patch-pi-ai: ${file} no longer has the code this patches. Check whether pi-ai now sets the phase at text_start, and update or remove scripts/patch-pi-ai.mjs.`);
  process.exit(1);
}
fs.writeFileSync(file, source.replace(before, after));
console.log("patch-pi-ai: OpenAI Responses text carries its phase from its first word");
