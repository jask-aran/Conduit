import { Match, Show, Switch } from "solid-js";
import { Spinner } from "@/components/primitives";
import type { SaveState } from "./autosave";

/**
 * How a settings section's edits stand, in its header beside the title:
 * a small spinner while saving, "Saved" once the latest edit is stored, and
 * "Not saved" with Retry when it failed -- which stays until retried or
 * edited again. Nothing before the first edit. It holds its own width so
 * the header does not shift as it changes.
 */
export function SaveStatus(props: { status: { state: SaveState; retry: () => void } | null }) {
  return <Show when={props.status}>{(status) =>
    <span class="settings-save-status" role="status" data-kind={status().state.kind}>
      <Switch>
        <Match when={status().state.kind === "saving"}><Spinner /><span>Saving</span></Match>
        <Match when={status().state.kind === "saved"}><span>Saved</span></Match>
        <Match when={status().state.kind === "failed"}>
          <span title={(status().state as { message: string }).message}>Not saved</span>
          <button type="button" onClick={() => status().retry()}>Retry</button>
        </Match>
      </Switch>
    </span>
  }</Show>;
}
