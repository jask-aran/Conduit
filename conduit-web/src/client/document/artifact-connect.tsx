import { createMemo, For, Show } from "solid-js";
import { Icons, Note, Row } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/notifications";
import type { ChatSummary, Project } from "../api/contracts";
import { artifactKnown, artifactsOf } from "./artifacts";
import { connect, connectionsOf, disconnect } from "./connections";

/** "Connect to artifact…" from a chat: its project's artifacts, each pressed to connect the chat or to end that. Open while it has a chat. */
export default function ArtifactConnect(props: { chat: { chat: ChatSummary; project: Project } | null; onClose: () => void }) {
  const linked = (id: string) => Boolean(props.chat && connectionsOf(props.chat.chat.id).some((one) => one.id === id));
  const turn = (id: string) => { const chat = props.chat?.chat.id; if (chat) void (linked(id) ? disconnect : connect)(id, chat).catch((error: Error) => toast.error(error.message)); };
  return <Dialog open={Boolean(props.chat)} title="Connect to artifact" description="A connected chat is handed the comments you send it from that artifact." onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <Show when={props.chat}>{(found) => {
      // By id: the list is read again each time a connection changes, and a row rebuilt under the pointer loses the keyboard.
      const ids = createMemo(() => artifactsOf(found().project.id).map((artifact) => artifact.id), [], { equals: (a, b) => a.join() === b.join() });
      return <>
        <For each={ids()}>{(id) => <Row density="list" element="button" lead={<Icons.FileText />} label={artifactKnown(id)?.name} selected={linked(id)} end={<Show when={linked(id)}><Icons.Check /></Show>} onClick={() => turn(id)} />}</For>
        <Show when={!ids().length}><Note kind="card">No artifacts in this project</Note></Show>
      </>;
    }}</Show>
  </Dialog>;
}
