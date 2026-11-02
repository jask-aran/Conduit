import { For } from "solid-js";
import { ReportCard, RoomRow, ClockRow, DayStrip, HarnessPrompt, Icons, LevelMark, type ClockKind, Group, GroupHeading } from "@/components/ui";
import { DashIconButton } from "@/components/ui/dashboard";
import { row, type Page } from "../model";

/* Assistant: an agent that keeps going on its own. What runs it on a clock is listed next first over its day. In the app they are the agent's page's groups (dashboard/agent-page.tsx). */
const CLOCKS: { kind: ClockKind; title: string; cadence: string; status?: string; next: string; warn?: string; remove?: boolean; off?: boolean }[] = [
  { kind: "heartbeat", title: "Heartbeat", cadence: "Every 30m", next: "in 6m" },
  { kind: "feed", title: "Email", cadence: "Every 30m", status: "Executor · 2 new 24m", next: "in 6m", remove: true },
  { kind: "checkback", title: "Has the refund arrived?", cadence: "Once", next: "in 3h" },
  { kind: "brief", title: "Morning brief", cadence: "Daily 08:00", next: "in 8h" },
  { kind: "feed", title: "Hacker News", cadence: "Every 2h", status: "Script · last check failed", warn: "HTTP 503 from news.ycombinator.com", next: "in 1h", remove: true },
];

const day = (now = 14 * 60 + 20) => <DayStrip now={now} quiet={{ start: 23 * 60, end: 7 * 60 }} pulse={30} marks={[{ at: 8 * 60, label: "Brief", kind: "brief" }, { at: 18 * 60, label: "Weekly review", kind: "schedule" }]} />;
const timed = () => <div class="g-aside"><Group kind="dash" id="g-timed" labelled section="timed" heading={<GroupHeading id="g-timed" count={CLOCKS.length}>Timed</GroupHeading>}>
  {day()}
  <For each={CLOCKS}>{(clock) => <ClockRow {...clock} actions={clock.remove ? <DashIconButton aria-label="Remove feed"><Icons.Delete /></DashIconButton> : undefined} />}</For>
</Group></div>;

export const assistantPage: Page = { title: "Assistant", rail: "Blocks",
  summary: "An agent that keeps going on its own: what runs on its clock is listed next first, over its day with quiet hours, the brief and the heartbeat's ticks.",
  preview: () => <div class="g-stack">{timed()}</div>,
  usage: `import { ClockRow, DayStrip, LevelMark } from "@/components/ui";

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
    row("DayStrip", "midnight to midnight: quiet hours, the brief, the heartbeat's ticks (none in quiet hours) and now", () => <div class="g-aside">{day()}</div>, { source: "components/ui/assistant.tsx", surfaces: ["ground"], phone: true }),
    row("DayStrip · quiet hours", "now inside them, early morning", () => <div class="g-aside">{day(5 * 60 + 10)}</div>, { surfaces: ["ground"] }),
    row("ClockRow", "next first: the heartbeat, a feed, a check-back, the brief; a failing feed's icon a warning, its reason in the title", () => timed(), { source: "components/ui/assistant.tsx", surfaces: ["ground"], phone: true }),
    row("ReportCard", "a report jbot sent (a message with a title) in its stream: title, first line, when, the bell when it reached the phone; opens the whole report in a reader", () => <div class="g-stack">
      <ReportCard title="Morning brief" line="Three things today: the dentist moved to 2pm, a parcel arrives, and rent is due." time="09:00" notified onOpen={() => {}} />
      <ReportCard title="Ryokan options for March" line="Four places with rooms left, two under ¥30,000 a night." time="14:12" onOpen={() => {}} /></div>, { source: "components/ui/assistant.tsx", surfaces: ["ground"], phone: true }),
    row("RoomRow", "another room's messages in jbot's stream (an email thread), folded to one quiet line: over which channel, the room, how many, the last line; opens in place to the exchange", () => <div class="g-stack">
      <RoomRow icon={<Icons.Mail aria-hidden="true" />} channel="email" room="Dentist booking" count={3} last="Thursday at 2pm works, see you then." time="11:02" />
      <RoomRow icon={<Icons.Mail aria-hidden="true" />} channel="email" room="70% off everything this weekend" count={1} last="Huge sale" time="09:14" /></div>, { source: "components/ui/assistant.tsx", surfaces: ["ground"], phone: true }),
    row("Quiet line", "a heartbeat that told no one leaves one line in the home thread, opening its run", () => <HarnessPrompt icon={<Icons.Heartbeat aria-hidden="true" />} onOpen={() => {}}>Heartbeat · 3 handled · 1 check-back set</HarnessPrompt>, { source: "components/ui/transcript.tsx · HarnessPrompt", surfaces: ["ground"] }),
  ],
  api: ["LevelMark", "ClockRow", "DayStrip", "ReportCard", "RoomRow", "HarnessPrompt"],
};
