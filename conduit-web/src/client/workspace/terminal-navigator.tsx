import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { PlusIcon, SquareTerminalIcon, XIcon } from "lucide-solid";
import { api } from "../api/client";
import type { Pty } from "../remotes/terminal-pane";
import { SplitRow } from "../dashboard/primitives/split";

/**
 * The dock's Terminal as a navigator (6d): the place's shells, each a
 * document a click opens in the focused pane and Alt beside; a new one opens
 * the same way. Ending a shell is here; closing its pane leaves it running.
 */
export function TerminalNavigator(props: { projectId: string; projectName: string; workingRoot?: string; openIds: string[]; onOpen: (id: string, beside: boolean) => void }) {
  const [ptys, setPtys] = createSignal<Pty[]>([]);
  const [error, setError] = createSignal("");
  const refresh = async () => {
    try {
      const { ptys = [] } = await api<{ ptys: Pty[] }>(`/v0/ptys?projectId=${encodeURIComponent(props.projectId)}`);
      setPtys(ptys.filter((item) => item.status === "running"));
      setError("");
    } catch (cause) { setError((cause as Error).message); }
  };
  onMount(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    window.addEventListener("conduit:ptys-changed", refresh);
    onCleanup(() => { window.clearInterval(timer); window.removeEventListener("conduit:ptys-changed", refresh); });
  });
  const create = async (beside: boolean) => {
    try {
      const record = await api<Pty>("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: props.projectId, ...(props.workingRoot ? { cwd: props.workingRoot } : {}) }) });
      window.dispatchEvent(new Event("conduit:ptys-changed"));
      props.onOpen(record.id, beside);
    } catch (cause) { setError((cause as Error).message); }
  };
  const end = async (id: string) => {
    try { await api(`/v0/ptys/${encodeURIComponent(id)}`, { method: "DELETE" }); } catch (cause) { setError((cause as Error).message); }
    window.dispatchEvent(new Event("conduit:ptys-changed"));
  };
  return <div class="terminal-navigator">
    <SplitRow element="button" type="button" class="terminal-navigator-new" lead={<PlusIcon />} primary="New terminal" onClick={(event: MouseEvent) => void create(event.altKey)} />
    <Show when={error()}><p class="terminal-navigator-error" role="alert">{error()}</p></Show>
    <Show when={ptys().length} fallback={<p class="terminal-navigator-empty">No terminals in {props.projectName}.</p>}>
      <For each={ptys()}>{(pty) =>
        <SplitRow element="button" type="button" data-open={props.openIds.includes(pty.id) || undefined} lead={<SquareTerminalIcon />}
          primary={pty.title || pty.currentCommand || "Shell"} context={pty.cwd || undefined}
          trailing={<span role="button" tabIndex={-1} class="terminal-navigator-end" aria-label="End terminal" title="End terminal" onClick={(event) => { event.stopPropagation(); void end(pty.id); }}><XIcon /></span>}
          onClick={(event: MouseEvent) => props.onOpen(pty.id, event.altKey)} />}
      </For>
    </Show>
  </div>;
}
