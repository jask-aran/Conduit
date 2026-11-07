import { createSignal, For } from "solid-js";
import { Button, IconButton, Icons, Row, Segmented, Tray } from "@/components/ui";
import { row, type Page } from "../model";

/* A tray in a phone-shaped box: rows behind it, dimmed while it is up. */
const scene = (opts: { lead?: boolean; open?: boolean } = {}) => {
  const [open, setOpen] = createSignal(opts.open ?? true);
  const [tab, setTab] = createSignal("now");
  return <div class="g-shell" style={{ position: "relative", height: "calc(40 * var(--u-space))", width: "min(100%, var(--measure-lg))", overflow: "hidden" }}>
    <div style={{ display: "grid", padding: "var(--space-lg)", gap: "var(--space-xs)" }}>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Open the tray</Button>
      <For each={["Morning brief", "Heartbeat", "Held mail", "Reflection"]}>{(title) => <Row density="list" lead={<Icons.FileText />} label={title} context="A report" />}</For>
    </div>
    <Tray open={open()} onClose={() => setOpen(false)} label="jbot's panel" title={opts.lead ? undefined : "jbot"}
      lead={opts.lead ? <Segmented size="sm" label="Tab" value={tab()} onChange={setTab} options={[{ value: "now", label: "Now" }, { value: "routines", label: "Routines" }, { value: "memory", label: "Memory" }]} /> : undefined}
      actions={<IconButton kind="pane" label="Settings"><Icons.Settings /></IconButton>}>
      <For each={Array.from({ length: 14 }, (_, index) => `Row ${index + 1}`)}>{(label) => <Row density="list" element="button" lead={<Icons.Inbox />} label={label} context="what it holds scrolls under the head" />}</For>
    </Tray>
  </div>;
};

export const trayPage: Page = {
  title: "Tray", rail: "Blocks",
  summary: "A phone's surface risen from the foot over what it belongs to (a chat's panel: jbot's), the rest dimmed by a scrim. One height whatever it holds, its body scrolling under its head (a title or a lead, its actions, its close, never wrapping); put away by its close, the scrim, Esc or a swipe down anywhere on it (its body once at its top); felt opening and shutting.",
  preview: () => scene({ lead: true }),
  usage: `import { Tray } from "@/components/ui";

<Tray open={open()} onClose={() => setOpen(false)} label="jbot's panel"
  lead={<Segmented size="sm" … />} actions={<IconButton kind="pane" label="Settings">…</IconButton>}>
  {rows}
</Tray>`,
  anatomy: { scene: () => scene({ lead: true }), parts: [
    { selector: ".ui-tray-scrim", name: "Scrim", does: "dims what it rises over; a tap puts it away", from: "Tray" },
    { selector: ".ui-tray-head", name: "Head", does: "grip, title or lead, actions and close; a swipe down anywhere carries the tray", from: "Tray" },
    { selector: ".ui-tray-body", name: "Body", does: "scrolls under the head edge to edge, its gutter kept", from: "Tray" },
  ] },
  examples: [
    row("title", "a title by its actions and close", () => scene(), { surfaces: ["ground"], phone: "only", code: '<Tray title="jbot" …>' }),
    row("lead", "a lead in the title's place (tabs)", () => scene({ lead: true }), { surfaces: ["ground"], phone: "only", code: "<Tray lead={<Segmented size=\"sm\" … />} …>", source: "components/ui/chat.tsx · ChatBeside on a phone" }),
  ],
  api: ["Tray"],
};
