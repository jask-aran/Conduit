import { createSignal, For } from "solid-js";
import { ClockRow, DayStrip, HarnessPrompt, Icons, InboxRow, LevelMark, type ClockKind } from "@/components/ui";
import { DashIconButton, Group, GroupHeading } from "@/components/ui/dashboard";
import { row, type Page } from "../model";

/* Assistant: an agent that keeps going on its own. What its runs reported waits in its inbox; what runs it on a clock
   is listed next first over its day. In the app they are the agent's page's groups (dashboard/agent-page.tsx). */
const ENTRIES = [
  { id: "i-1", level: "urgent", headline: "Your Google Cloud billing account was suspended", source: "Email", time: "12m", body: "Action required: your billing account 0161FE-800D3A-F576E0 has been suspended.\nProjects on it stop serving until a payment method is added." },
  { id: "i-2", level: "attention", headline: "The Japan trip doc has one new edit", source: "Docs watch", time: "1h", body: "1 update made to “Japan/Korea Trip”: day 4 moved from Takayama to Kanazawa." },
  { id: "i-3", level: "fyi", headline: "Parcel from Goldi delivered", source: "Email", time: "3h", handled: true, outcome: "told you in the brief" },
  { id: "i-4", level: "failed", headline: "Calendar check could not reach Executor", source: "Check-back", time: "5h", body: "Executor answered 401: its Google connection needs signing in again." },
] as const;
const CLOCKS: { kind: ClockKind; title: string; cadence: string; status?: string; next: string; warn?: string; remove?: boolean; off?: boolean }[] = [
  { kind: "heartbeat", title: "Heartbeat", cadence: "Every 30m", next: "in 6m" },
  { kind: "feed", title: "Email", cadence: "Every 30m", status: "Executor · 2 new 24m", next: "in 6m", remove: true },
  { kind: "checkback", title: "Has the refund arrived?", cadence: "Once", next: "in 3h" },
  { kind: "brief", title: "Morning brief", cadence: "Daily 08:00", next: "in 8h" },
  { kind: "feed", title: "Hacker News", cadence: "Every 2h", status: "Script · last check failed", warn: "HTTP 503 from news.ycombinator.com", next: "in 1h", remove: true },
];

function Inbox(props: { entries?: readonly (typeof ENTRIES)[number][] }) {
  const [open, setOpen] = createSignal<string | null>("i-1");
  return <div class="g-aside"><Group id="g-inbox" labelled section="inbox" heading={<GroupHeading id="g-inbox" count={3}>Inbox</GroupHeading>}>
    <For each={props.entries ?? ENTRIES}>{(entry) => <InboxRow {...entry} handled={"handled" in entry ? entry.handled : false} outcome={"outcome" in entry ? entry.outcome : undefined}
      body={"body" in entry ? entry.body : undefined} open={open() === entry.id} onToggle={() => setOpen(open() === entry.id ? null : entry.id)} onOpenRun={() => {}} />}</For>
  </Group></div>;
}
const day = (now = 14 * 60 + 20) => <DayStrip now={now} quiet={{ start: 23 * 60, end: 7 * 60 }} pulse={30} marks={[{ at: 8 * 60, label: "Brief", kind: "brief" }, { at: 18 * 60, label: "Weekly review", kind: "schedule" }]} />;
const timed = () => <div class="g-aside"><Group id="g-timed" labelled section="timed" heading={<GroupHeading id="g-timed" count={CLOCKS.length}>Timed</GroupHeading>}>
  {day()}
  <For each={CLOCKS}>{(clock) => <ClockRow {...clock} actions={clock.remove ? <DashIconButton aria-label="Remove feed"><Icons.Delete /></DashIconButton> : undefined} />}</For>
</Group></div>;

export const assistantPage: Page = { title: "Assistant", rail: "Blocks",
  summary: "An agent that keeps going on its own: what its runs reported waits in its inbox, opening in place to the report; what runs on its clock is listed next first, over its day with quiet hours, the brief and the heartbeat's ticks.",
  preview: () => <div class="g-stack">{Inbox({ entries: ENTRIES.slice(0, 3) })}{timed()}</div>,
  usage: `import { InboxRow, ClockRow, DayStrip, LevelMark } from "@/components/ui";

<InboxRow level="urgent" headline="Billing account suspended" source="Email" time="12m"
  body={report} open={open} onToggle={toggle} onOpenRun={openRun} />

<DayStrip now={860} quiet={{ start: 1380, end: 420 }} pulse={30} marks={[{ at: 480, label: "Brief" }]} />
<ClockRow kind="feed" title="Email" cadence="Every 30m" status="Executor · 2 new 24m" next="in 6m" />`,
  anatomy: { scene: () => day(), parts: [
    { selector: ".ui-day-quiet", name: "Quiet hours", does: "a tinted band, two when they wrap midnight; no ticks inside", from: "quiet" },
    { selector: ".ui-day-label", name: "Mark", does: "a daily task's label over its tick", from: "marks", side: "above" },
    { selector: ".ui-day-tick", name: "Tick", does: "the heartbeat's, faded once past", from: "pulse", side: "below" },
    { selector: ".ui-day-now", name: "Now", does: "a line in the text's colour", from: "now" }] },
  examples: [
    row("LevelMark", "how a report reads: urgent, attention, FYI, failed, nothing to say, and handled", () => <div class="g-row">
      <For each={["urgent", "attention", "fyi", "failed", "none"]}>{(level) => <LevelMark level={level} />}</For><LevelMark level="fyi" handled /></div>, { source: "components/ui/assistant.tsx", surfaces: ["ground"] }),
    row("InboxRow", "one line each; one opens in place to the whole report, what became of it and Open run; handled ones rest quieter", () => <Inbox />, { source: "components/ui/assistant.tsx", surfaces: ["ground"], phone: true }),
    row("DayStrip", "midnight to midnight: quiet hours, the brief, the heartbeat's ticks (none in quiet hours) and now", () => <div class="g-aside">{day()}</div>, { source: "components/ui/assistant.tsx", surfaces: ["ground"], phone: true }),
    row("DayStrip · quiet hours", "now inside them, early morning", () => <div class="g-aside">{day(5 * 60 + 10)}</div>, { surfaces: ["ground"] }),
    row("ClockRow", "next first: the heartbeat, a feed, a check-back, the brief; a failing feed's icon a warning, its reason in the title", () => timed(), { source: "components/ui/assistant.tsx", surfaces: ["ground"], phone: true }),
    row("Quiet line", "a heartbeat that told no one leaves one line in the home thread, opening its run", () => <HarnessPrompt icon={<Icons.Heartbeat aria-hidden="true" />} onOpen={() => {}}>Heartbeat · 3 handled · 1 check-back set</HarnessPrompt>, { source: "components/ui/transcript.tsx · HarnessPrompt", surfaces: ["ground"] }),
  ],
  api: ["LevelMark", "InboxRow", "ClockRow", "DayStrip", "HarnessPrompt"],
};
