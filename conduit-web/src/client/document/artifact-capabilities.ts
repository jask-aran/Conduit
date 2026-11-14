import { DOCUMENT_TOOLS, type DocumentHost, type DocumentToolName } from "@/components/document/host";
import type { MarkupCapabilities } from "@/components/markup";
import type { ArtifactKind } from "./artifacts";

/*
 * What each kind of artifact's ribbon offers, as two sets that stand apart on it: `edit`, the tools that change the
 * artifact itself (a paper's block kinds and text marks; a site has none, since its file is an agent's to change), and
 * `markup`, what Markup offers over it. `suggest`: Suggesting is offered beside Editing (DocumentHost.suggest). A tool in neither is not drawn and cannot be called. The interface's own
 * feedback declares its Markup in client/feedback/conduit-feedback.tsx, and has no edit set.
 */
export const ARTIFACT_CAPABILITIES = {
  paper: {
    edit: DOCUMENT_TOOLS,
    suggest: { controls: "margin" },
    markup: { deliveries: ["batched", "live"], tools: ["quote", "highlight", "pen", "shape", "text", "erase", "note"], screenshot: false, sent: "margin", thin: false, bar: "ribbon" },
  },
  site: {
    edit: [],
    markup: { deliveries: ["batched", "live"], tools: ["pen", "highlight", "shape", "text", "erase", "note"], screenshot: true, sent: "corner", thin: false, bar: "ribbon", grounded: true },
  },
} as const satisfies Record<ArtifactKind, { edit: readonly DocumentToolName[]; suggest?: DocumentHost["suggest"]; markup: Partial<MarkupCapabilities> }>;
