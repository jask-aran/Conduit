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
      lib("status", "StatusDot", "both", "control", "StatusDot: a row's live state", () => <div class="g-row"><StatusDot label="Idle" tone="success" /><StatusDot label="Working" tone="active" spinning /><StatusDot label="Waiting on you" tone="warn" /><StatusDot label="Failed" tone="danger" /><StatusDot label="Unread" tone="unread" /><StatusDot label="Stopping" spinning /><StatusDot label="Idle (may be stale)" tone="success" stale /></div>),
    ] },
  ],
};
