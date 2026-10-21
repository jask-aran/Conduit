// Props: label, tone (success, active, warn, danger, muted, unread), spinning, stale; HTML span attributes.
import { NavRow } from "@/components/ui";
import { StatusDot } from "@/components/ui";
import { row, token, type Page } from "../model";

export const statusDotPage: Page = {
  title: "StatusDot",
  summary: "StatusDot reads the surface's --tint and --well values.",
  preview: () => <StatusDot label="Idle" tone="success" />,
  usage: `import { StatusDot } from "@/components/ui";

<StatusDot label="Running" tone="success" />`,
  examples: [
    row("muted", "Harness is not ready; status sits in a navigation row.", () => <NavRow end={<StatusDot label="Connecting" tone="muted" spinning={false} stale={false} />}>Claude Code</NavRow>, { code: '<NavRow end={<StatusDot tone="muted" />} />' }),
    row("long status label", "Accessible status and title retain the full reconnection message.", () => <NavRow icon={<StatusDot label="Running on development-laptop; connection may be stale while reconnecting" title="Running on development-laptop; connection may be stale while reconnecting" tone="active" stale />}>conduit-web / workspace / development-laptop</NavRow>, { code: '<NavRow icon={<StatusDot label title stale />} />' }),
    row("StatusDot", "StatusDot: a row's live state", () => <div class="g-row"><StatusDot label="Idle" tone="success" /><StatusDot label="Working" tone="active" spinning /><StatusDot label="Waiting on you" tone="warn" /><StatusDot label="Failed" tone="danger" /><StatusDot label="Unread" tone="unread" /><StatusDot label="Stopping" spinning /><StatusDot label="Idle (may be stale)" tone="success" stale /></div>),
  ],
  tokens: [{ title: "StatusDot", tokens: [
    token("--icon", "Icon or thumb size"),
    token("--icon-dot", "Dot size"),
    token("--status-success", "Success colour"),
    token("--status-warn", "Warning colour"),
    token("--status-unread", "Unread colour"),
    token("--opacity-muted", "Stale opacity"),
  ] }],
  api: ["StatusDot"],
};
