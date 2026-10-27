import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Button } from "@/components/ui/controls";
import { SettingGroup, SettingLine } from "@/components/ui/overlay";
import { api } from "../api/client";

/** An MCP server reaching the person's accounts (GET /v0/agent/connectors), signed in to once for the hub. Today the
 *  hub's agent calls its tools from codemode; anything that is not a read asks first. */
type Connector = { id: string; label: string; url: string; status: "off" | "connecting" | "on" | "error"; tools: number; error?: string };
const CONNECTOR_STATE = { off: "Not connected", connecting: "Connecting…", on: "Connected", error: "Not working" } as const;

/** Models & accounts' Connectors group: Connect signs in in another tab (the system browser in the apps). */
export function ConnectorsGroup() {
  const [connectors, setConnectors] = createSignal<Connector[]>([]);
  const [connecting, setConnecting] = createSignal<string | null>(null);
  const loadConnectors = () => api<Connector[]>("/v0/agent/connectors").then(setConnectors).catch(() => {});
  // Signing in happens in another tab; the row follows it there for a while.
  let watching = 0;
  const watch = () => { clearInterval(watching); let left = 40; watching = window.setInterval(() => { if (--left <= 0) clearInterval(watching); void loadConnectors(); }, 3000); };
  onCleanup(() => clearInterval(watching));
  const connect = async (connector: Connector) => {
    setConnecting(connector.id);
    try {
      const { authorizationUrl } = await api<{ authorizationUrl: string }>(`/v0/agent/connectors/${encodeURIComponent(connector.id)}/connect`, { method: "POST", body: JSON.stringify({}) });
      window.open(authorizationUrl, "_blank", "noopener,noreferrer");
      watch();
    } finally { setConnecting(null); }
  };
  const disconnect = async (connector: Connector) => {
    setConnecting(connector.id);
    try { await api(`/v0/agent/connectors/${encodeURIComponent(connector.id)}`, { method: "DELETE" }); await loadConnectors(); }
    finally { setConnecting(null); }
  };

  onMount(() => void loadConnectors());
  // A hub without its agent has nothing to call them yet: the group waits for one.
  return <Show when={connectors().length}><SettingGroup title="Connectors">
    <For each={connectors()}>{(connector) =>
      <SettingLine label={connector.label} title={`${connector.url}: your accounts through one MCP server, signed in once for this hub. The agent calls its tools from code; anything that is not a read asks you first.`}
        state={<>{connector.status === "on" ? `${connector.tools} tools` : connector.status === "error" ? connector.error || CONNECTOR_STATE.error : CONNECTOR_STATE[connector.status]}</>}>
        <Show when={connector.status === "off" || connector.status === "error"} fallback={
          <Button size="sm" variant="ghost" disabled={connecting() === connector.id || connector.status === "connecting"} onClick={() => void disconnect(connector)}>Disconnect</Button>}>
          <Button size="sm" disabled={connecting() === connector.id} onClick={() => void connect(connector)}>Connect</Button>
        </Show>
      </SettingLine>}
    </For>
  </SettingGroup></Show>;
}
