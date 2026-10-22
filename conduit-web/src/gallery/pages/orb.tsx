import type { ModeFrame, OrbState } from "@/components/ui";
import { createSignal } from "solid-js";
import { Transcript, Turn, Trace } from "@/components/ui";
import { Orb, settledOrbRate, PLAIN_SPHERE, SPUTTERING_SPHERE, ORBITS_TRAILED, Button } from "@/components/ui";
import { resolvePreset } from "thinking-orbs/engine";
import { row, token, type Page } from "../model";
/* Orbs: one Orb, a list of animations, each a speed. */
type OrbAnimation = { name: string; from: string; state: OrbState; frame?: ModeFrame; tint?: string; rate?: number; use: string };
const ORB_ANIMATIONS: OrbAnimation[] = [
  { name: "working", from: "thinking-orbs", state: "working", use: "Thinking: a turn with no tool running" },
  { name: "composing", from: "thinking-orbs", state: "composing", use: "Writing: a turn writing its answer" },
  { name: "weaving", from: "thinking-orbs", state: "weaving", use: "Reading a file" },
  { name: "searching", from: "thinking-orbs", state: "searching", use: "Searching, fetching" },
  { name: "solving", from: "thinking-orbs", state: "solving", use: "Running a command, a script, several tools, an unnamed tool" },
  { name: "connecting", from: "thinking-orbs", state: "connecting", use: "A turn starting" },
  { name: "listening", from: "thinking-orbs", state: "listening", use: "The mic, listening (PhoneComposer's Dictate)" },
  { name: "ORBITS_TRAILED", from: "orb-frames", state: "working", frame: ORBITS_TRAILED, use: "Editing a file" },
  { name: "PLAIN_SPHERE", from: "orb-frames", state: "working", frame: PLAIN_SPHERE, rate: settledOrbRate(false), use: "Done: a settled turn, turning slowly" },
  { name: "SPUTTERING_SPHERE", from: "orb-frames", state: "working", frame: SPUTTERING_SPHERE, tint: "var(--destructive)", rate: settledOrbRate(true), use: "Interrupted or failed: the sphere sputtering, in --destructive" },
  { name: "breathing", from: "thinking-orbs", state: "breathing", use: "not used" },
  { name: "shaping", from: "thinking-orbs", state: "shaping", use: "not used" },
];
const speedOf = (a: OrbAnimation) => a.frame ? 1 : resolvePreset(a.state, 20).speed;
const animationSample = (a: OrbAnimation) => <div class="g-orb-sizes">{[16, 20, 32].map((size) => <span style={{ width: `${size}px`, height: `${size}px` }}><Orb state={a.state} frame={a.frame} tint={a.tint} rate={a.rate} /></span>)}</div>;
/** A change of animation as the Orb plays it: held a moment, then crossfaded, both still moving. */
function OrbChange() {
  const [pick, setPick] = createSignal(ORB_ANIMATIONS[0]!);
  return <div class="g-orb-change"><span class="g-orb-big"><Orb state={pick().state} frame={pick().frame} tint={pick().tint} rate={pick().rate} /></span><div class="g-orb-picks">{ORB_ANIMATIONS.slice(0, 10).map((a) => <Button variant={pick() === a ? "secondary" : "ghost"} size="sm" onClick={() => setPick(a)}>{a.name}</Button>)}</div></div>;
}
const OrbHow = () => <ol class="g-orb-how">
  <li><strong>The renderer</strong>: thinking-orbs' <code>paintFrame</code> draws a list of dots (position, size, depth, brightness) on a canvas, near dots larger and brighter.</li>
  <li><strong>An animation</strong>: a frame function, (size, seconds) to dots, computed live each draw. thinking-orbs ships one per state, each a preset with a speed (how fast its time runs) and a few shape options; Conduit's own (orb-frames) are built from the engine's pieces and run at 1×.</li>
  <li><strong>The player</strong> (Orb): one frame loop for every orb on the page; draws only on screen with the tab visible, at its rate if it has one; fills its box at the screen's pixel density; tints its dots; a change is held 250ms then crossfaded over 200ms; paused (or reduced motion) it is one still frame.</li>
</ol>;

export const orbPage: Page = {
  title: "Orb",
  summary: "One Orb, a list of animations, each with a speed. Aura (Materials) is the voice's colour field, not an orb.",
  preview: () => animationSample(ORB_ANIMATIONS[0]!),
  usage: `import { Orb } from "@/components/ui";

<Orb state="connecting" />`,
  examples: [
    row("Pause and resume", "Turn status with a long workspace path", () => {
          const [paused, setPaused] = createSignal(false);
          return <><Transcript><Turn><Trace orb={<Orb state="weaving" paused={paused()} />} status="Reading" latest="/work/conduit/src/client/settings/settings-core.tsx" live /></Turn></Transcript><Button variant="ghost" outline size="sm" onClick={() => setPaused(!paused())}>{paused() ? "Resume animation" : "Pause animation"}</Button></>;
        }, { phone: true, code: '<Trace orb={<Orb state="weaving" paused={paused()} />} />' }),
    row("Preset options", "Resolved engine options at a limited draw rate", () => <Transcript><Turn><Trace orb={<Orb state="searching" opts={resolvePreset("searching", 20).opts} rate={12} />} status="Searching" latest="Find microphone settings" live /></Turn></Transcript>, { phone: true, code: '<Orb state="searching" opts={resolvePreset("searching", 20).opts} rate={12} />' }),
    row("How it draws", "thinking-orbs engine · orb-frames · Orb", () => <OrbHow />, {}),
    row("Paused", "<Orb paused>: one still frame (and with reduced motion); a change is not faded", () => <span class="g-orb-big"><Orb state="working" paused /></span>, {})
  ],
  motion: [
    ...ORB_ANIMATIONS.map((a) => row(a.name, `${a.use} · ${a.from} · ${speedOf(a)}× speed · ${a.rate ?? "every frame"} draws a second · 16 / 20 / 32px`, () => animationSample(a))),
    row("A change", "held 250ms, crossfaded over 200ms", () => <OrbChange />, {})
  ],
  tokens: [{ title: "Interrupted frame tint", tokens: [token("--destructive", "SPUTTERING_SPHERE tint; orb.css reads no tokens")] }],
  api: ["Orb", "Button"]
};
