import { createSignal, For, type JSX } from "solid-js";
import { AgentRider, AgentRow, AgentRows, Button, HarnessPrompt, Orb, Trace, type AgentState } from "@/components/ui";

import { orb, queued } from "../demos";
import { row, type Page } from "../model";

/* Agents: a turn's subagents under its head, and a chat's background agents on its composer. The rows open the
   subagent's transcript in the app (a chat of its own); here a press does nothing. */
const ROWS: { id?: string; title: string; state: AgentState; activity?: string; time?: string; usage?: string }[] = [
  { title: "Research gassho house pricing in Shirakawa-go", state: "running", activity: "reading booking.com/hotel/jp/shirakawa-go-gassho", time: "12s" },
  { title: "Check train times from Takayama", state: "finished", time: "34s", usage: "8.2k tokens" },
  { id: "sa-3", title: "Draft a two-day itinerary", state: "running", activity: "answering", time: "1m 12s" },
  { id: "sa-2", title: "Compare ryokan cancellation policies", state: "failed", time: "9s" },
  { id: "sa-4", title: "Summarise reviews of Kanbe-e", state: "stopped", time: "41s" },
];
const turn = (rows: typeof ROWS, live = true): JSX.Element =>
  <Trace orb={live ? <Orb state="working" /> : orb(true)} status={live ? "Delegating" : "Done"} time={live ? "1m 12s" : "1m 40s"} work={rows.length === 1 ? "1 agent" : `${rows.length} agents`}
    pinned={<AgentRows><For each={rows}>{(agent) => <AgentRow {...agent} onOpen={() => {}} onStop={agent.id ? () => {} : undefined} />}</For></AgentRows>} />;
const STRIP: { id: string; title: string; state: AgentState; activity?: string; usage?: string; time: string }[] = [
  { id: "sa-1", title: "Research gassho house pricing", state: "running", activity: "fetching booking.com/hotel/jp/shirakawa-go-gassho", time: "1m 12s" },
  { id: "sa-2", title: "Check train times", state: "finished", usage: "8.2k tokens", time: "34s" },
  { id: "sa-3", title: "Draft a two-day itinerary with rest stops", state: "running", activity: "answering", time: "22s" },
  { id: "sa-4", title: "Compare ryokan cancellation policies", state: "failed", time: "9s" },
];
const strip = (rows: typeof STRIP) => <div class="g-composer"><AgentRider>
  <For each={rows}>{(row) => <AgentRow line {...row} onOpen={() => {}} onStop={() => {}} />}</For>
</AgentRider></div>;
function StripCycle() {
  const [shown, setShown] = createSignal(STRIP.slice(0, 1));
  const step = () => setShown(shown().length >= STRIP.length ? STRIP.slice(0, 1) : STRIP.slice(0, shown().length + 1));
  return <div class="g-stack"><div class="g-row"><Button size="sm" variant="ghost" outline onClick={step}>Add an agent</Button></div>{strip(shown())}</div>;
}

export const agentsPage: Page = { title: "Agents", summary: "Work an agent handed to another, for every harness, as a list with an icon and a status each: a turn's subagents under its head, a chat's background agents on its composer. Each opens the subagent's transcript, a chat of its own.", rail: "Blocks",
  preview: () => <div class="g-stack">{turn(ROWS.slice(0, 2))}{strip(STRIP.slice(0, 3))}</div>,
  usage: `import { AgentRows, AgentRow, AgentRider } from "@/components/ui";

<AgentRows>
  <AgentRow title="Research pricing" state="running" activity="reading booking.com/…" time="12s" onOpen={open} />
</AgentRows>

<AgentRider>
  <AgentRow line id="sa-1" title="Research pricing" state="running" activity="answering" time="1m 12s" onOpen={open} onStop={stop} />
</AgentRider>`,
  anatomy: { scene: () => turn(ROWS.slice(0, 1)), parts: [
    { selector: ".ui-agent-mark", name: "Mark", does: "a spinner while it works; the agent's glyph, or a warning, after", from: "Spinner · Icons.Agent" },
    { selector: ".ui-agent-title", name: "Task", does: "what it was handed, cut short", from: "title", side: "above" },
    { selector: ".ui-agent-line", name: "Now", does: "what it is doing, in mono; how it ended, after", from: "activity · state", side: "below" },
    { selector: ".ui-agent-time", name: "Time", does: "how long it has run", from: "time" }] },
  examples: [
    row("AgentRow states", "a turn's own (no id) and background ones (an id, and Stop while they work); finished, failed, stopped", () => turn(ROWS), { source: "components/ui/agents.tsx", surfaces: ["ground"], phone: true }),
    row("AgentRider", "a chat's background agents on its composer, a line each: mark, id, task, status, time; Stop while it works; past five it scrolls", () => strip(STRIP), { source: "components/ui/agents.tsx", surfaces: ["ground"], phone: true }),
    row("AgentRider · one", "a single agent", () => strip(STRIP.slice(0, 1)), { surfaces: ["ground"] }),
    row("Report", "a background agent's report arrives as the harness's own line, and opens the subagent's transcript", () => <HarnessPrompt onOpen={() => {}}>sa-1 finished: Research gassho house pricing</HarnessPrompt>, { source: "components/ui/transcript.tsx · HarnessPrompt", surfaces: ["ground"] }),
    row("Beside the queued rider", "riders stack on the composer; the agents sit above what waits to be sent", () => <div class="g-stack">{strip(STRIP.slice(0, 2))}<div class="g-composer">{queued()}</div></div>, { surfaces: ["ground"] }),
  ],
  motion: [row("An agent arrives", "each new agent's line fades into the rider", () => <StripCycle />, { surfaces: ["ground"] })],
  api: ["AgentRows", "AgentRow", "AgentRider", "Trace", "HarnessPrompt"],
};
