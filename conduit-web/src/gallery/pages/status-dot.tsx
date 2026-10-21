// Props: label, tone (success, active, warn, danger, muted, unread), spinning, stale; HTML span attributes.
import { NavRow } from "@/components/ui";
import { FormTable, form } from "../specs";
import { StatusDot } from "@/components/ui";
import { lib, type Family } from "../model";

export const statusDotFamily: Family = {
  title: "StatusDot", stage: true,
  note: "StatusDot reads the surface's --tint and --well values, at the surface and density picked above.",
  usage: `import { StatusDot } from "@/components/ui";

<StatusDot label="Running" tone="success" />`,
  api: ["StatusDot"],
  groups: [
    { title: "Examples", staged: true, atoms: [
      lib("status-dot-examples", "status-dot · more examples", "both", "control", "status-dot", () => <FormTable rows={[
        form("muted", "Harness is not ready; status sits in a navigation row.", () => <NavRow end={<StatusDot label="Connecting" tone="muted" spinning={false} stale={false} />}>Claude Code</NavRow>, '<NavRow end={<StatusDot tone="muted" />} />'),
        form("long status label", "Accessible status and title retain the full reconnection message.", () => <NavRow icon={<StatusDot label="Running on development-laptop; connection may be stale while reconnecting" title="Running on development-laptop; connection may be stale while reconnecting" tone="active" stale />}>conduit-web / workspace / development-laptop</NavRow>, '<NavRow icon={<StatusDot label title stale />} />'),
      ]} on={["ground", "frost"]} />, "row"),

      lib("status", "StatusDot", "both", "control", "StatusDot: a row's live state", () => <div class="g-row"><StatusDot label="Idle" tone="success" /><StatusDot label="Working" tone="active" spinning /><StatusDot label="Waiting on you" tone="warn" /><StatusDot label="Failed" tone="danger" /><StatusDot label="Unread" tone="unread" /><StatusDot label="Stopping" spinning /><StatusDot label="Idle (may be stale)" tone="success" stale /></div>),
    ] },
  ],
};
