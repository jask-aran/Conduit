import names from "virtual:ui-pieces";
import { MarkupTool, httpTransport, type MarkupHost, type MarkupMode } from "@/components/markup";
import { toast } from "@/components/ui/notifications";
import { api } from "../api/client";
import { clientBuild, shellVersion } from "../platform/build-info";
import { installedClientKind } from "../platform/installed-client";
import { selectedUiScale } from "../preferences/ui-scale";

/*
 * Conduit as Markup's host for feedback on its own interface (components/markup/host.ts): the library's piece names, the hub's routes, the
 * desktop shell's own page capture, and what an item says about this client. Nothing else of Conduit reaches the tool.
 */
/** The desktop shell pictures its own page, with nothing asked. */
export const capturePage: MarkupHost["capturePage"] = installedClientKind === "desktop" ? async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await invoke<ArrayBuffer>("capture_page");
  return bytes.byteLength ? new Blob([bytes], { type: "image/png" }) : null;
} : undefined;

const host = (clientId: () => string): MarkupHost => ({
  names,
  anchors: ["data-region", "data-tool", "data-surface", "data-tab", "data-doc-view", "data-pane"],
  transport: httpTransport(api),
  clientId,
  client: async () => ({ kind: installedClientKind, build: clientBuild, shell: await shellVersion(), interfaceSize: selectedUiScale() }),
  capturePage,
  notify: (outcome, message) => outcome === "sent" ? toast.success(message) : toast.error(message),
});

export default function ConduitFeedback(props: { mode: MarkupMode; onMode: (mode: MarkupMode) => void; onClose: () => void; client: () => string; keys: () => string[] }) {
  return <MarkupTool host={host(props.client)} mode={props.mode} onMode={props.onMode} onClose={props.onClose} keys={props.keys} />;
}
