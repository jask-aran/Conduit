import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Reading, ReadingStat, ReadingStats, SettingLine, SettingNote, SettingValue, Group } from "@/components/ui";
import { api } from "../api/client";

/** GET /v0/server/machine (machine-readout.js): rates are since the previous reading; null where the platform cannot say. */
type Machine = {
  host: string; platform: string; uptime: number; cores: number; load: number[] | null; cpu: number | null;
  memory: { total: number; used: number }; disk: { total: number; used: number; path: string } | null;
  network: { rx: number; tx: number } | null; processes: Array<{ pid: number; name: string; cpu: number; memory: number }> | null;
};

const bytes = (value: number) => value >= 1e12 ? `${(value / 1e12).toFixed(1)} TB` : value >= 1e9 ? `${(value / 1e9).toFixed(1)} GB`
  : value >= 1e6 ? `${(value / 1e6).toFixed(0)} MB` : value >= 1e3 ? `${(value / 1e3).toFixed(0)} kB` : `${Math.round(value)} B`;
const rate = (value: number) => `${bytes(value)}/s`;
const percent = (value: number) => `${Math.round(value * 100)}%`;
const days = (seconds: number) => seconds >= 86400 ? `${Math.floor(seconds / 86400)}d` : seconds >= 3600 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 60)}m`;

/**
 * The server machine's readout, inside its folder on Devices: CPU, memory, disk and network as the Reading's tiles,
 * then the busiest processes as data lines. Read every few seconds while `open`, never while folded.
 */
export function MachineReadout(props: { open: boolean; url?: string; title?: string }) {
  const [machine, setMachine] = createSignal<Machine | null>(null);
  const [error, setError] = createSignal("");
  createEffect(() => {
    if (!props.open) return;
    let stopped = false;
    const read = () => api<Machine>(props.url || "/v0/server/machine").then((value) => { if (!stopped) { setMachine(value); setError(""); } })
      .catch((failure) => {
        if (stopped) return;
        // A device whose Conduit predates readouts answers 501: it is told to update, not shown as broken.
        const older = (failure as { status?: number })?.status === 501;
        setError(older ? "This device's Conduit is older: update it there to see its readout." : failure instanceof Error ? failure.message : String(failure));
        if (older) clearInterval(timer);
      });
    const timer = window.setInterval(read, 3000);
    void read();
    onCleanup(() => { stopped = true; clearInterval(timer); });
  });
  return <>
    <Show when={machine()}>{(now) => <>
      <Reading>
        <ReadingStats title={props.title || `Machine · ${now().host}`}>
          <ReadingStat label="CPU" value={now().cpu === null ? "–" : percent(now().cpu!)}
            detail={`${now().cores} cores${now().load ? ` · load ${now().load![0]!.toFixed(2)}` : ""}`} />
          <ReadingStat label="Memory" value={percent(now().memory.used / now().memory.total)} detail={`${bytes(now().memory.used)} of ${bytes(now().memory.total)}`} />
          <Show when={now().disk}>{(disk) => <ReadingStat label="Disk" value={percent(disk().used / disk().total)} detail={`${bytes(disk().used)} of ${bytes(disk().total)}`} />}</Show>
          <Show when={now().network}>{(network) => <ReadingStat label="Network" value={`↓ ${rate(network().rx)}`} detail={`↑ ${rate(network().tx)} · up ${days(now().uptime)}`} />}</Show>
        </ReadingStats>
      </Reading>
      <Show when={now().processes?.length}>
        <Group kind="column" title="Busiest processes">
          <For each={now().processes!}>{(item) =>
            <SettingLine plain mono label={item.name} state={`pid ${item.pid}`} title={`${item.name} (pid ${item.pid}): ${percent(item.cpu)} of a core, ${bytes(item.memory)} resident`}>
              <SettingValue mono>{percent(item.cpu)} · {bytes(item.memory)}</SettingValue>
            </SettingLine>}
          </For>
        </Group>
      </Show>
    </>}</Show>
    <Show when={error()}><SettingNote tone={error().startsWith("This device's Conduit is older") ? "quiet" : "error"}>{error().startsWith("This device's") ? error() : `The machine's readout could not be read: ${error()}`}</SettingNote></Show>
  </>;
}
