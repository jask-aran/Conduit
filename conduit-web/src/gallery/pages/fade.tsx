import { Transcript, Message, CodeBlock } from "@/components/ui";
import { row, type Page } from "../model";
import { LONG, glanceMath } from "../demos";

const code = () => <CodeBlock lang="ts" code={LONG} fold={6} />;
const message = () => <Transcript><Message time="00:08" fold={3}>{Array.from({ length: 6 }, (_, i) => `line ${i + 1} of a long message`).join("\n")}</Message></Transcript>;

export const fadePage: Page = {
  title: "Fade", rail: "Foundations",
  summary: "Content cut short fades at its foot instead of stopping. One gradient in styles/fade.css serves every piece that folds or clamps content; each sets --fade-length and, if a maximum height clamps it first, --fade-at.",
  preview: code,
  examples: [
    row("a folded code block", "Past its fold: the last line and a half fade; --fade-length: 2.4em.", code, { code: "<CodeBlock fold>", surfaces: ["ground"] }),
    row("a folded message", "Past its fold: half a line fades; --fade-length: 0.5lh.", message, { code: "<Message fold>", surfaces: ["ground"] }),
    row("a clamped glance", "Math in a chat's preview: clamped at 15em, its last 2.5em fading; --fade-at: 15em · --fade-length: 2.5em.", () => glanceMath(), { code: "<GlanceAnswer html>", surfaces: ["ground"] }),
  ],
  tokens: [{ title: "Mask", tokens: [
    { name: "--fade-length", use: "Length of the fade; defaults to one line.", read: (cell) => getComputedStyle(cell.querySelector(".ui-code > pre") ?? cell).getPropertyValue("--fade-length").trim() || "1lh" },
    { name: "--fade-at", use: "End of the content; defaults to its full height.", read: (cell) => getComputedStyle(cell.querySelector(".ui-code > pre") ?? cell).getPropertyValue("--fade-at").trim() || "100%" },
  ] }],
};
