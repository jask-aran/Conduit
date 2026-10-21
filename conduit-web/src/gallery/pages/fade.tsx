import { Transcript, Message, CodeBlock } from "@/components/ui";
import { FormTable, form } from "../specs";
import { type Family, lib } from "../model";
import { LONG, glanceMath } from "../demos";

export const fadeFamily: Family = { title: "Fade", rail: "Foundations", note: "content cut short fades out at its foot rather than stopping: one gradient (styles/fade.css) for every piece that folds or clamps what it holds; each sets only how far it fades (--fade-length) and, if a max height clamps it first, where (--fade-at)", groups: [{ title: "Where it fades", layout: "desktop", atoms: [
    lib("fade-forms", "Fade", "desktop", "material", "styles/fade.css · --fade-length · --fade-at", () => <FormTable rows={[
      form("a folded code block", "past its fold: the last line and a half fade", () => <CodeBlock lang="ts" code={LONG} fold={6} />, "<CodeBlock fold>", "--fade-length: 2.4em"),
      form("a folded message", "past its fold: half a line fades", () => <Transcript><Message time="00:08" fold={3}>{Array.from({ length: 6 }, (_, i) => `line ${i + 1} of a long message`).join("\n")}</Message></Transcript>, "<Message fold>", "--fade-length: 0.5lh"),
      form("a clamped glance", "math in a chat's preview: clamped at 15em, its last 2.5em fading", () => glanceMath(), "<GlanceAnswer html>", "--fade-at: 15em · --fade-length: 2.5em"),
    ]} on={["desktop"]} widths={["220px", "minmax(0, 1fr)"]} />, "row"),
  ] }] };
