import { Show } from "solid-js";
import { Button } from "@/components/primitives";
import "./outside-thread-bar.css";

/**
 * Over the composer of a thread Conduit does not keep: whose thread it is, and
 * tracking, the one thing to do about that. Tracking keeps a thread in a
 * workspace, so in any other folder it says it will make the folder one.
 */
export function OutsideThreadBar(props: { harness: string; folder: string; workspace: boolean; busy: boolean; onTrack: () => void }) {
  const name = () => props.folder.split("/").filter(Boolean).at(-1) || props.folder;
  return <div class="outside-thread-bar" role="status">
    <span class="outside-thread-bar-copy"><strong>Not in Conduit</strong>
      <Show when={props.workspace} fallback={<> · Tracking makes <span title={props.folder}>{name()}</span> a workspace</>}> · {props.harness} keeps this thread</Show>
    </span>
    <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onTrack}>{props.busy ? "Tracking…" : "Track in Conduit"}</Button>
  </div>;
}
