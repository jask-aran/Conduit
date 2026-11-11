import { createSignal, For, type JSX } from "solid-js";
import { AgentDelegate, AgentReport, AgentReportItem, AgentRider, AgentRiderGroup, AgentRow, AgentRows, AgentSpawn, Button, HarnessPrompt, Orb, RoutineIcon, RunLine, Trace, type AgentState } from "@/components/ui";

import { orb, queued } from "../demos";
import { row, type Page } from "../model";

const ROWS: { id?: string; title: string; state: AgentState; activity?: string; time?: string; usage?: string }[] = [
  { title: "Research gassho house pricing in Shirakawa-go", state: "running", activity: "reading booking.com/hotel/jp/shirakawa-go-gassho", time: "12s" },
  { title: "Check train times from Takayama", state: "finished", time: "34s", usage: "8.2k tokens" },
  { id: "bg-3", title: "Draft a two-day itinerary", state: "running", activity: "answering", time: "1m 12s" },
  { id: "bg-2", title: "Compare ryokan cancellation policies", state: "failed", time: "9s" },
  { id: "bg-4", title: "Summarise reviews of Kanbe-e", state: "stopped", time: "41s" },
];
const turn = (rows: typeof ROWS, live = true): JSX.Element =>
  <Trace orb={live ? <Orb state="working" /> : orb(true)} status={live ? "Delegating" : "Done"} time={live ? "1m 12s" : "1m 40s"} work={rows.length === 1 ? "1 agent" : `${rows.length} agents`}
    pinned={<AgentRows><For each={rows}>{(agent) => <AgentRow {...agent} onOpen={() => {}} onStop={agent.id ? () => {} : undefined} />}</For></AgentRows>} />;
const STRIP: { id: string; title: string; state: AgentState; activity?: string; usage?: string; time: string }[] = [
  { id: "bg-1", title: "Research gassho house pricing", state: "running", activity: "fetching booking.com/hotel/jp/shirakawa-go-gassho", time: "1m 12s" },
  { id: "bg-2", title: "Check train times", state: "finished", usage: "8.2k tokens", time: "34s" },
  { id: "bg-3", title: "Draft a two-day itinerary with rest stops", state: "running", activity: "answering", time: "22s" },
  { id: "bg-4", title: "Compare ryokan cancellation policies", state: "failed", time: "9s" },
];
const strip = (rows: typeof STRIP) => <div class="g-composer"><AgentRider>
  <AgentRiderGroup label="Foreground"><AgentRow line id="fg-1" title="Look over the itinerary draft" state="running" activity="read itinerary.md" time="06s" onOpen={() => {}} stopRoom /></AgentRiderGroup>
  <AgentRiderGroup label="Background"><For each={rows}>{(row) => <AgentRow line {...row} onOpen={() => {}} onStop={() => {}} />}</For></AgentRiderGroup>
  <AgentRiderGroup label="Runs"><AgentRow line title="Heartbeat #14" state="running" activity="checking inbox" time="24s" onOpen={() => {}} onStop={() => {}} /></AgentRiderGroup>
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
  <AgentRiderGroup label="Foreground"><AgentRow line id="fg-1" title="Look over the draft" state="running" activity="read draft.md" time="6s" onOpen={open} stopRoom /></AgentRiderGroup>
  <AgentRiderGroup label="Background"><AgentRow line id="bg-1" title="Research pricing" state="running" activity="answering" time="1m 12s" onOpen={open} onStop={stop} /></AgentRiderGroup>
</AgentRider>`,
  anatomy: { scene: () => turn(ROWS.slice(0, 1)), parts: [
    { selector: ".ui-agent-row .ui-row-lead", name: "Mark", does: "a spinner while it works; the agent's glyph, or a warning, after", from: "Spinner · Icons.Agent" },
    { selector: ".ui-agent-title", name: "Task", does: "what it was handed, cut short", from: "title", side: "above" },
    { selector: ".ui-agent-row .ui-row-detail", name: "Now", does: "what it is doing, in mono; how it ended, after", from: "activity · state", side: "below" },
    { selector: ".ui-agent-row .ui-row-meta", name: "Time", does: "how long it has run", from: "time" }] },
  examples: [
    row("AgentRow states", "a turn's own (no id) and background ones (an id, and Stop while they work); finished, failed, stopped", () => turn(ROWS), { source: "components/ui/agents.tsx", surfaces: ["ground"], phone: true }),
    row("AgentRider", "a chat's background agents on its composer, a line each: mark, id, task, status, time; Stop while it works; past five it scrolls", () => strip(STRIP), { source: "components/ui/agents.tsx", surfaces: ["ground"], phone: true }),
    row("AgentRider · one", "a single agent", () => strip(STRIP.slice(0, 1)), { surfaces: ["ground"] }),
    row("AgentSpawn", "where background agents branched off a turn: one quiet line (Started, the ids, the task for one) that drops down what was started, a line each opening its run; Report jumps to the report once it is back. How they are doing rides on the composer", () =>
      <Trace orb={orb(true)} status="Done" time="4s" pinned={<AgentRows><AgentSpawn ids={["sa-1"]} title="Research gassho house pricing" status="Finished" onReport={() => {}}><AgentRow line id="sa-1" title="Research gassho house pricing" state="finished" usage="4.1k context" time="12.4s" onOpen={() => {}} /></AgentSpawn><AgentSpawn ids={["sa-2", "sa-3", "sa-4"]} status="1 of 3 running"><AgentRow line id="sa-2" title="Check Shirakawa-go bus times" state="finished" usage="2.8k context" time="8.0s" onOpen={() => {}} /><AgentRow line id="sa-3" title="Find ryokan with private onsen" state="running" activity="fetch_content booking.com" time="14s" onOpen={() => {}} /><AgentRow line id="sa-4" title="Compare rail pass prices" state="failed" time="3.2s" onOpen={() => {}} /></AgentSpawn></AgentRows>} />,
      { source: "components/ui/agents.tsx", surfaces: ["ground"], phone: true }),
    row("AgentReport", "the join: background agents' answers where they reached the thread, one line for those that landed together, the same line as Started; it drops down each agent's line (opening its run) and what it said; Started goes back to the spawn line", () =>
      <AgentRows><AgentReport ids={["sa-2", "sa-3", "sa-4"]} status="2 finished · 1 failed" onBack={() => {}}>
        <AgentReportItem id="sa-2" title="Check Shirakawa-go bus times" state="finished" time="8.0s" onOpen={() => {}}>Nohi buses leave Takayama every hour from 8:00.</AgentReportItem>
        <AgentReportItem id="sa-3" title="Find ryokan with private onsen" state="finished" time="14.2s" onOpen={() => {}}>Three in Ogimachi have private baths; two have rooms in May.</AgentReportItem>
        <AgentReportItem id="sa-4" title="Compare rail pass prices" state="failed" time="3.2s" onOpen={() => {}}>The fare site would not load.</AgentReportItem>
      </AgentReport></AgentRows>,
      { source: "client/chat/agents.tsx · TurnReports", surfaces: ["ground"], phone: true }),
    row("AgentDelegate", "a turn's foreground fan-out: several agents the turn waits for, one line (Delegated · 3 agents) dropping down an AgentRow each; one foreground agent stays its own AgentRow", () =>
      <AgentRows><AgentDelegate count={3} status="1 of 3 running"><For each={STRIP.slice(0, 3)}>{(row) => <AgentRow line {...row} id={undefined} onOpen={() => {}} />}</For></AgentDelegate></AgentRows>,
      { source: "client/chat/agents.tsx · TurnAgents", surfaces: ["ground"], phone: true }),
    row("RunLine", "a run enters from outside: its report opens under the line, or a quiet summary stays on it", () =>
      <AgentRows><RunLine icon={<RoutineIcon routine="heartbeat" />} label="Heartbeat" number={14} trigger="Scheduled 09:00" time="24s" woke onOpen={() => {}}>Three new messages need your attention.</RunLine>
        <RunLine icon={<RoutineIcon routine="heartbeat" />} label="Heartbeat" number={15} trigger="Hourly" time="8s" woke={false} summary="nothing new" onOpen={() => {}} />
        <RunLine icon={<RoutineIcon routine="brief" />} label="Morning brief" number={3} time="9s" woke={false} status="Failed" summary="could not check inbox" onOpen={() => {}} /></AgentRows>,
      { source: "components/ui/agents.tsx", surfaces: ["ground"], phone: true }),
    row("Report", "a background agent's report arrives as the harness's own line, and opens the subagent's transcript", () => <HarnessPrompt onOpen={() => {}}>sa-1 finished: Research gassho house pricing</HarnessPrompt>, { source: "components/ui/transcript.tsx · HarnessPrompt", surfaces: ["ground"] }),
    row("Beside the queued rider", "riders stack on the composer; the agents sit above what waits to be sent", () => <div class="g-stack">{strip(STRIP.slice(0, 2))}<div class="g-composer">{queued()}</div></div>, { surfaces: ["ground"] }),
  ],
  motion: [row("An agent arrives", "each new agent's line fades into the rider", () => <StripCycle />, { surfaces: ["ground"] })],
  api: ["AgentRows", "AgentRow", "AgentSpawn", "AgentReport", "AgentReportItem", "AgentDelegate", "RunLine", "RoutineIcon", "AgentRider", "AgentRiderGroup", "Inbound", "Trace", "HarnessPrompt"],
};
