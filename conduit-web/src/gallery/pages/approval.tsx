// Props: ApprovalSummary: title, service, lines (text, or { text?, fields?, code? }), meta. ApprovalCard: those, state (pending, allowed, declined, expired,
// used), busy, motion, onChoose(allow | always | deny). ServiceIcon: service, fallback.
import { createSignal } from "solid-js";
import { ApprovalCard, ApprovalSummary, type ApprovalState, Button, ServiceIcon } from "@/components/ui";
import { row, token, type Page } from "../model";

const SEND = { title: "Use Executor: Gmail · send", service: "Gmail", lines: [{ fields: [
  { label: "To", value: "rhys@example.com" }, { label: "Subject", value: "Thursday" }, { label: "Body", value: "Still on for 7? I booked the place on Smith St." }] }] };
const CHAT = { title: "Start a chat in Japan", service: null, lines: [{ fields: [{ label: "Message", value: "Find three ryokan near Takayama for early December" }] }] };
const SCRIPT = { title: "Run a script in Executor: Google · calendar events insert", service: "Google Calendar", lines: ["Google · calendar events insert", { text: "Script", code:
  "const event = await tools.google.api.calendar.eventsInsert({\n  calendarId: \"primary\",\n  requestBody: { summary: \"Dinner\", start: { dateTime: \"2026-10-30T19:00:00+11:00\" } },\n});\nreturn event.id;" }] };

function Answerable() {
  const [state, setState] = createSignal<ApprovalState>("pending");
  return <div class="g-stack">
    <ApprovalCard {...SEND} meta="23 h left" state={state()} onChoose={(choice) => setState(choice === "deny" ? "declined" : "allowed")} />
    <Button variant="ghost" size="sm" onClick={() => setState("pending")}>Ask again</Button>
  </div>;
}

export const approvalPage: Page = {
  title: "Approval",
  rail: "Blocks",
  summary: "An agent asking to do one thing that leaves its own space. The same summary is asked on the question card while a harness waits (sync), or as an ApprovalCard in the thread while the agent carries on (async).",
  preview: () => <ApprovalCard {...SEND} meta="23 h left" state="pending" />,
  usage: `import { ApprovalCard, ApprovalSummary } from "@/components/ui";

<ApprovalCard title="Use Executor: Gmail · send" service="Gmail" meta="23 h left"
  lines={[{ fields: [{ label: "To", value: "rhys@example.com" }] }]}
  state={ask.status} busy={sending()} onChoose={(choice) => answer(ask.id, choice)} />

// On the question card, in the prompt's place:
<ApprovalSummary title={approval.title} service={approval.service} lines={approval.lines} />`,
  examples: [
    row("pending · a service", "Waiting on the person: the service's mark, what it will send, Allow the one action waiting.", () => <ApprovalCard {...SEND} meta="23 h left" state="pending" />),
    row("pending · a script", "A program: the actions it names, then the script as it will run (scrolls, never cut).", () => <ApprovalCard {...SCRIPT} meta="23 h left" state="pending" />),
    row("pending · no service", "A call that is not a connector's (a chat, a device): the shield.", () => <ApprovalCard {...CHAT} meta="40 min left" state="pending" />),
    row("busy", "An answer on its way: the actions wait.", () => <ApprovalCard {...SEND} meta="23 h left" state="pending" busy />),
    row("answered", "What became of it, one quiet line.", () => <div class="g-stack">
      <ApprovalCard {...SEND} state="allowed" /><ApprovalCard {...CHAT} state="declined" /><ApprovalCard {...SEND} state="expired" />
    </div>),
    row("answer it", "Choose to see it answered.", () => <Answerable />),
    row("ApprovalSummary", "The summary alone, as the question card draws a sync approval.", () => <ApprovalSummary title="Run `rm -rf build` on laptop" lines={[{ text: "laptop · ~/code/app", code: "rm -rf build" }]} />),
    row("ServiceIcon", "Service marks (Simple Icons, CC0), one colour; a service without one takes the fallback.", () => <div class="g-row">
      {["Gmail", "Google Calendar", "Google Drive", "Google Docs", "Google Sheets", "GitHub", "Notion", "Linear", "Slack"].map((service) => <span title={service} style={{ width: "var(--icon)", height: "var(--icon)", display: "inline-grid" }}><ServiceIcon service={service} /></span>)}
    </div>),
  ],
  tokens: [{ title: "Approval", tokens: [
    token("--icon", "Mark size; the detail lines and actions start past it"),
    token("--measure-lg", "Card width"),
    token("--space-lg", "Card padding and gap"),
    token("--radius-surface", "Card corners"),
    token("--text-row", "Detail lines, meta, the answered line"),
    token("--measure-xs", "Tallest a script grows before it scrolls"),
  ] }],
  api: ["ApprovalCard", "ApprovalSummary", "ServiceIcon"],
};
