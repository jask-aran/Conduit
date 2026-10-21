import { Icons } from "@/components/ui";
import { createSignal, For, Index, onCleanup, type JSX } from "solid-js";
import { TraceHeader, Trail, Step, Orb, Trace, StepOutput, StepProse, TraceError, ORBITS_TRAILED, Read } from "@/components/ui";

import { orb } from "../demos";
import { row, token, type Page } from "../model";

/* Trace: every behaviour, from the library's pieces. A step that opens holds its own open state here (the app's
   transcript holds it per tool). */
export type StepProps = Parameters<typeof Step>[0];
export const Fold = (props: StepProps & { initial?: boolean }) => { const [open, setOpen] = createSignal(props.initial ?? false); return <Step {...props} open={open()} onToggle={() => setOpen(!open())} />; };
export const FoldTrace = (props: Omit<Parameters<typeof Trace>[0], "open" | "onToggle"> & { initial?: boolean }) => { const [open, setOpen] = createSignal(props.initial ?? true); return <Trace {...props} open={open()} onToggle={() => setOpen(!open())} />; };
export const OUTPUT = Array.from({ length: 14 }, (_, i) => `drwxr-xr-x  ${String(i + 2).padStart(2)} jask  staff  ${448 + i * 32}  Oct 16 22:${String(10 + i).padStart(2, "0")}  dir-${i}`).join("\n");
export function TruncatedOutput() { const [full, setFull] = createSignal(false); const text = () => full() ? OUTPUT : OUTPUT.split("\n").slice(-5).join("\n"); return <StepOutput text={text()} hidden={OUTPUT.length - text().length || OUTPUT.length - OUTPUT.split("\n").slice(-5).join("\n").length} full={full()} onToggleFull={() => setFull(!full())} />; }

/* Its states: every Status a trace can say, the orb it draws, and what its Latest line holds then. */
export type TraceState = { status: string; orb: () => JSX.Element; when: string; latest: string; tone?: "failed"; live?: boolean };
export const TRACE_STATES: { group: string; rows: TraceState[] }[] = [
  { group: "Before anything has shown", rows: [
    { status: "Starting", orb: () => <Orb state="connecting" />, when: "the prompt is sent", latest: "", live: true },
    { status: "Starting agent", orb: () => <Orb state="connecting" />, when: "sent, its agent's process still starting", latest: "", live: true },
    { status: "Waiting for model", orb: () => <Orb state="connecting" />, when: "sent, the agent up, nothing back from the model yet", latest: "", live: true },
  ] },
  { group: "Running", rows: [
    { status: "Thinking", orb: () => <Orb state="working" />, when: "between tools", latest: "The second paragraph has four sentences", live: true },
    { status: "Writing", orb: () => <Orb state="composing" />, when: "the answer is streaming", latest: "Ran wc -c lorem_ipsum.txt", live: true },
    { status: "Reading", orb: () => <Orb state="weaving" />, when: "a read is running", latest: "lorem_ipsum.txt", live: true },
    { status: "Editing", orb: () => <Orb state="working" frame={ORBITS_TRAILED} />, when: "an edit is running", latest: "lorem_ipsum.txt", live: true },
    { status: "Running", orb: () => <Orb state="solving" />, when: "a command is running", latest: "wc -c lorem_ipsum.txt", live: true },
    { status: "Searching", orb: () => <Orb state="searching" />, when: "a search is running (Fetching: a fetch)", latest: "“lorem ipsum”", live: true },
    { status: "Scripting tools", orb: () => <Orb state="solving" />, when: "a code-mode script is running", latest: "Reading lorem_ipsum.txt", live: true },
    { status: "Using format", orb: () => <Orb state="solving" />, when: "any other tool, by its name (Calling a tool: not named yet)", latest: "lorem_ipsum.txt", live: true },
    { status: "Running 3 tools", orb: () => <Orb state="solving" />, when: "several at once", latest: "npm test", live: true },
  ] },
  { group: "Settled", rows: [
    { status: "Done", orb: () => orb(true), when: "it finished", latest: "The second paragraph has four sentences" },
    { status: "Interrupted", orb: () => orb(false), when: "it was stopped", latest: "Ran npm test", tone: "failed" },
    { status: "Failed", orb: () => orb(false), when: "the request failed", latest: "429 Too Many Requests", tone: "failed" },
  ] },
];
export const TraceStates = () => <table class="g-trace-states"><thead><tr><th>Status</th><th>When</th><th>The trace</th></tr></thead>
  <For each={TRACE_STATES}>{(group) => <tbody><tr><th colspan="3" class="g-trace-group">{group.group}</th></tr>
    <For each={group.rows}>{(row) => <tr><th>{row.status}</th><td>{row.when}</td><td class="ui-read"><TraceHeader orb={row.orb()} status={row.status} time={row.live ? "12s" : "1m 00s"} work={row.status.startsWith("Starting") || row.status === "Waiting for model" ? undefined : "1 read, 1 edit"} latest={row.latest || undefined} live={row.live} tone={row.tone} opens={row.status !== "Starting"} /></td></tr>}</For></tbody>}</For></table>;
/** A turn played, a second a beat: its Status, Work and Latest line follow the app's rules -- a running tool's Latest
 * is what it acts on, a finished one its past tense, thinking its summary; settled, the last thinking. */
export function LiveTurn() {
  type Beat = { status: string; orb: () => JSX.Element; latest?: string; work?: string; steps: number; running?: boolean };
  const T = "The second paragraph has four sentences";
  const BEATS: Beat[] = [
    { status: "Starting", orb: () => <Orb state="connecting" />, steps: 0 },
    { status: "Thinking", orb: () => <Orb state="working" />, latest: T, steps: 1 },
    { status: "Reading", orb: () => <Orb state="weaving" />, latest: "lorem_ipsum.txt", work: "1 read", steps: 2, running: true },
    { status: "Thinking", orb: () => <Orb state="working" />, latest: "Read lorem_ipsum.txt", work: "1 read", steps: 2 },
    { status: "Editing", orb: () => <Orb state="working" frame={ORBITS_TRAILED} />, latest: "lorem_ipsum.txt", work: "1 read, 1 edit", steps: 3, running: true },
    { status: "Thinking", orb: () => <Orb state="working" />, latest: "Edited lorem_ipsum.txt", work: "1 read, 1 edit", steps: 3 },
    { status: "Running", orb: () => <Orb state="solving" />, latest: "wc -c lorem_ipsum.txt", work: "1 read, 1 edit, 1 command", steps: 4, running: true },
    { status: "Writing", orb: () => <Orb state="composing" />, latest: "Ran wc -c lorem_ipsum.txt", work: "1 read, 1 edit, 1 command", steps: 4 },
    { status: "Done", orb: () => orb(true), latest: T, work: "1 read, 1 edit, 1 command", steps: 4 },
  ];
  const STEPS: [StepProps, StepProps][] = [
    [{ icon: <Icons.Thinking />, summary: T }, { icon: <Icons.Thinking />, summary: T }],
    [{ state: "running", verb: "Reading", subject: "lorem_ipsum.txt" }, { icon: <Icons.FileText />, verb: "Read", subject: "lorem_ipsum.txt", time: "0.4s" }],
    [{ state: "running", verb: "Editing", subject: "lorem_ipsum.txt" }, { icon: <Icons.WriteFile />, verb: "Edited", subject: "lorem_ipsum.txt", time: "1.1s" }],
    [{ state: "running", verb: "Running", subject: "wc -c lorem_ipsum.txt" }, { icon: <Icons.Shell />, verb: "Ran", subject: "wc -c lorem_ipsum.txt", time: "0ms" }],
  ];
  const [t, setT] = createSignal(0), [open, setOpen] = createSignal(true);
  const timer = setInterval(() => setT((v) => v >= BEATS.length + 2 ? 0 : v + 1), 1000);
  onCleanup(() => clearInterval(timer));
  const beat = () => BEATS[Math.min(t(), BEATS.length - 1)]!, done = () => beat().status === "Done";
  return <Trace orb={beat().orb()} status={beat().status} time={done() ? "08s" : `${String(t()).padStart(2, "0")}s`} work={beat().work} latest={beat().latest} live={!done()}
    open={open()} onToggle={() => setOpen(!open())}>
    {beat().steps ? <Trail><Index each={STEPS.slice(0, beat().steps)}>{(pair, index) => <Step {...(beat().running && index === beat().steps - 1 ? pair()[0] : pair()[1])} motion="entering" />}</Index></Trail> : undefined}
  </Trace>;
}

export const tracePage: Page = { title: "Trace", summary: "A turn's work, over its answer. Its head is two lines -- the Status line (Status · Time · Work) and the Latest line -- beside the Orb; opened, its Trail of Steps.", rail: "Blocks",
  preview: () => <div class="ui-read g-read g-trace-anatomy">
        <FoldTrace orb={orb(true)} status="Done" time="1m 00s" work="1 read, 1 edit, 1 command" latest="The second paragraph has four sentences"><Trail><Step icon={<Icons.Thinking />} summary="The second paragraph has four sentences" /><Step icon={<Icons.FileText />} verb="Read" subject="lorem_ipsum.txt" time="0ms" /><Step icon={<Icons.WriteFile />} verb="Edited" subject="lorem_ipsum.txt" time="1m 00s" /></Trail></FoldTrace>
      </div>,
  usage: `import { Trace, Orb, Trail, Step, StepOutput } from "@/components/ui";

<Trace status="Done" time="12s" work="1 command" orb={<Orb state="working" />}
  opens open={open()} onToggle={() => setOpen(!open())}>
  <Trail>
    <Step verb="Ran" subject="git status" time="0.4s" opens open={stepOpen()} onToggle={() => setStepOpen(!stepOpen())}>
      <StepOutput text={output()} />
    </Step>
  </Trail>
</Trace>`,
  anatomy: { scene: () => <div class="ui-read g-read g-trace-anatomy">
        <FoldTrace orb={orb(true)} status="Done" time="1m 00s" work="1 read, 1 edit, 1 command" latest="The second paragraph has four sentences"><Trail><Step icon={<Icons.Thinking />} summary="The second paragraph has four sentences" /><Step icon={<Icons.FileText />} verb="Read" subject="lorem_ipsum.txt" time="0ms" /><Step icon={<Icons.WriteFile />} verb="Edited" subject="lorem_ipsum.txt" time="1m 00s" /></Trail></FoldTrace>
      </div>, parts: [{ selector: ".ui-trace-orb", name: "Orb", does: "what it is doing, as motion (Foundations · Orbs)", from: "Orb" },
    { selector: ".ui-trace-line > b", name: "Status", does: "one word for what it is doing or how it ended (States below)", from: "Status line", side: "above" },
    { selector: ".ui-trace-time", name: "Time", does: "from the prompt: counting while it runs, then how long it took", from: "Status line", side: "above" },
    { selector: ".ui-trace-line > span:last-child", name: "Work", does: "its tools counted by kind, most first", from: "Status line", side: "above" },
    { selector: ".ui-trace-latest", name: "Latest line", does: "running: what the running tool acts on, else the last step in the past tense, or the last thinking; settled: the last thinking", from: "the second line" },
    { selector: ".ui-trail", name: "Trail", does: "its steps, one line each", from: "Trail, opened" },
    { selector: ".ui-step-item:nth-child(2) .ui-step", name: "Step", does: "Icon · Verb · Subject · Flags · Time; opens to what it did (Steps below)", from: "a line of the Trail" }] },
  examples: [
    row("States", "<TraceHeader status orb latest live tone>", () => <TraceStates />),
    row("read", "a tool, settled: its kind's icon, past verb, subject, time; opens to its output; verb foreground · subject code face · time caption tabular", () => <Read class="g-read">{<Trail><Fold icon={<Icons.FileText />} verb="Read" subject="lorem_ipsum.txt" time="0ms" initial><StepOutput text={"Lorem ipsum dolor sit amet, consectetur adipiscing elit.\nSed do eiusmod tempor incididunt ut labore."} /></Fold></Trail>}</Read>, { surfaces: ["ground"], code: "<Step icon verb subject time><StepOutput text /></Step>" }),
    row("drawn once opened", "opens: its body is not drawn until first opened, then kept to fold away; foldBody", () => <Read class="g-read">{<Trail><Fold icon={<Icons.Shell />} verb="Ran" subject="npm run build" time="3s" opens><StepOutput text={"vite v7 building for production…\n✓ built in 2.9s"} /></Fold></Trail>}</Read>, { surfaces: ["ground"], code: "<Step opens>" }),
    row("running", "present verb, a spinner for its icon; ui-spinner icon-sm", () => <Read class="g-read"><Trail><Step state="running" verb="Running" subject="npm run build" /></Trail></Read>, { surfaces: ["ground"], code: "state=running" }),
    row("failed · stopped", "flagged at the end; failed tints its icon; flag strong · failed icon --destructive", () => <Read class="g-read">{<Trail><Fold icon={<Icons.Shell />} verb="Ran" subject="npm test" time="14s" state="failed"><StepOutput text={"FAIL src/sum.test.ts\n  expected 3, received 4"} /></Fold><Step icon={<Icons.WriteFile />} verb="Edited" subject="src/sum.ts" state="stopped" /></Trail>}</Read>, { surfaces: ["ground"], code: "state=failed · stopped" }),
    row("long output", "cut to a preview (a command's end, a file's start), the rest a click away; scrolls past 20 units", () => <Read class="g-read">{<Trail><Fold icon={<Icons.Shell />} verb="Ran" subject="ls -la" time="0.2s" initial><TruncatedOutput /></Fold></Trail>}</Read>, { surfaces: ["ground"], code: "<StepOutput hidden full onToggleFull>" }),
    row("thinking", "its summary (the last heading, or last sentence); opens to the whole text; prose a step quieter", () => <Read class="g-read">{<Trail><Fold icon={<Icons.Thinking />} summary="The second paragraph has four sentences; keep the first two" initial><StepProse><p>The second paragraph has four sentences; keep the first two, they carry the point. The rest repeats it.</p></StepProse></Fold></Trail>}</Read>, { surfaces: ["ground"], code: "<Step summary><StepProse>" }),
    row("narration", "what the agent said between steps", () => <Read class="g-read">{<Trail><Fold icon={<Icons.Message />} summary="I'll shorten it and check the word count."><StepProse><p>I'll shorten it and check the word count.</p></StepProse></Fold></Trail>}</Read>, { surfaces: ["ground"], code: "<Step summary>" }),
    row("not kept", "text a stop discarded: struck, flagged; struck · .55", () => <Read class="g-read">{<Trail><Fold icon={<Icons.Thinking />} summary="Then rename the file to lorem.txt" discarded><StepProse><p>Then rename the file to lorem.txt</p></StepProse></Fold></Trail>}</Read>, { surfaces: ["ground"], code: "<Step discarded>" }),
    row("hidden reasoning", "reasoning the provider kept: a note, said once, nothing to open; italic · no cursor", () => <Read class="g-read">{<Trail><Step note icon={<Icons.Thinking />} summary="Reasoning not shared by the provider" /></Trail>}</Read>, { surfaces: ["ground"], code: "<Step note summary>" }),
    row("group", "a run of one kind: how many, the steps on a rail under its icon; rail --tint", () => <Read class="g-read">{<Trail><Fold icon={<Icons.FileText />} verb="Read 3 files" time="1.2s" initial><Trail nested="group"><Fold icon={<Icons.FileText />} verb="Read" subject="src/main.tsx" time="0.4s"><StepOutput text="import { render } from 'solid-js/web';" /></Fold><Step icon={<Icons.FileText />} verb="Read" subject="src/app.tsx" time="0.3s" /><Step icon={<Icons.FileText />} verb="Read" subject="package.json" time="0.5s" /></Trail></Fold></Trail>}</Read>, { surfaces: ["ground"], code: "<Step verb><Trail nested=group>" }),
    row("code mode", "a script: the tools it calls, in order, as quiet rows -- planned, running, failed, earlier -- then its output; planned .45 · earlier muted", () => <Read class="g-read">{<Trail><Fold icon={<Icons.Code />} verb="Scripting tools" state="running" initial><Trail nested="calls">
    <Step state="earlier" verb="2 earlier calls" /><Step icon={<Icons.FileText />} verb="Read" subject="lorem_ipsum.txt" time="12ms" /><Step icon={<Icons.Shell />} verb="Ran" subject="wc -w lorem_ipsum.txt" time="40ms" flags={["repeats"]} />
    <Step icon={<Icons.Search />} verb="Searched" subject="“lorem”" state="failed" time="8ms" /><Step state="running" verb="Editing" subject="lorem_ipsum.txt" /><Step icon={<Icons.Tool />} verb="Using" subject="format" state="planned" />
  </Trail></Fold></Trail>}</Read>, { surfaces: ["ground"], code: "<Step><Trail nested=calls><Step state>" }),
    row("error", "a failed request in the trail; head --destructive · pre code face", () => <Read class="g-read"><Trail><TraceError time="16 Oct 2026, 22:18:04" facts={["Model: Muse Spark 1.3", "Provider: Meta", "Profile: Assistant"]} message="429 Too Many Requests: rate limit reached for this model." /></Trail></Read>, { surfaces: ["ground"], code: "<TraceError time facts message>" })
  ],
  motion: [
    row("A turn", "Trace > TraceHeader · Trail > Step", () => <Read class="g-read g-live-turn"><LiveTurn /></Read>)
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--space-sm", "small spacing"),
    token("--icon-sm", "small icons"),
    token("--space-2xs", "smallest gaps"),
    token("--icon-xl", "spacing and size"),
    token("--row-gap", "spacing and size"),
    token("--muted-foreground", "secondary text")
  ] }],
  api: ["Trace", "TraceHeader", "Orb", "Trail", "Step", "StepOutput", "StepProse", "TraceError", "Read"],
};
