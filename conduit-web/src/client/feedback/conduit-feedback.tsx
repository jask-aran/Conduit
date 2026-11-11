import names from "virtual:ui-pieces";
import { FeedbackTool, httpTransport, type FeedbackHost, type FeedbackMode } from "@/components/feedback";
import { toast } from "@/components/ui/notifications";
import { api } from "../api/client";
import { clientBuild, shellVersion } from "../platform/build-info";
import { installedClientKind } from "../platform/installed-client";
import { selectedUiScale } from "../preferences/ui-scale";

/*
 * Conduit as the feedback tool's host (components/feedback/host.ts): the library's piece names, the hub's routes, the
 * desktop shell's own page capture, and what an item says about this client. Nothing else of Conduit reaches the tool.
 */
/** The desktop shell pictures its own page, with nothing asked. */
export const capturePage: FeedbackHost["capturePage"] = installedClientKind === "desktop" ? async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await invoke<ArrayBuffer>("capture_page");
  return bytes.byteLength ? new Blob([bytes], { type: "image/png" }) : null;
} : undefined;

const host = (clientId: () => string): FeedbackHost => ({
  names,
  anchors: ["data-region", "data-tool", "data-surface", "data-tab", "data-doc-view", "data-pane"],
  transport: httpTransport(api),
  clientId,
  client: async () => ({ kind: installedClientKind, build: clientBuild, shell: await shellVersion(), interfaceSize: selectedUiScale() }),
  capturePage,
  notify: (outcome, message) => outcome === "sent" ? toast.success(message) : toast.error(message),
});

export default function ConduitFeedback(props: { mode: FeedbackMode; onMode: (mode: FeedbackMode) => void; onClose: () => void; client: () => string; keys: () => string[] }) {
  return <FeedbackTool host={host(props.client)} mode={props.mode} onMode={props.onMode} onClose={props.onClose} keys={props.keys} />;
}
