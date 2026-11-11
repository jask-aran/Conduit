import { Notice } from "@/components/ui";

export function OutsideThreadChip(props: { harness: string; folder: string; workspace: boolean; busy: boolean; onTrack: () => void }) {
  const name = () => props.folder.split("/").filter(Boolean).at(-1) || props.folder;
  const detail = () => props.workspace
    ? `${props.harness} keeps this thread. Tracking keeps it in Conduit.`
    : `${props.harness} keeps this thread. Tracking keeps it in Conduit and makes ${name()} a workspace.`;
  return <Notice kind="capsule" hint={detail()} action={{ label: "Track", busyLabel: "Tracking…", busy: props.busy, onClick: props.onTrack,
    name: props.workspace ? "Track in Conduit" : `Track in Conduit, making ${name()} a workspace` }}>Not in Conduit</Notice>;
}
