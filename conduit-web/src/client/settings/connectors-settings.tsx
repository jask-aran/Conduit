import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Button } from "@/components/ui/controls";
import { SettingLine, SettingValue } from "@/components/ui/overlay";
import { LiveNote, Note } from "@/components/ui";
import { api } from "../api/client";
import { Group } from "@/components/ui/group";

/** An MCP server reaching the person's accounts (GET /v0/agent/connectors), signed in to once for the hub. Today the
 *  hub's agent calls its tools from codemode; anything that is not a read asks first. */
type Connector = { id: string; label: string; url: string; status: "off" | "connecting" | "on" | "error"; tools: number; error?: string };
const CONNECTOR_STATE = { off: "Not connected", connecting: "Connecting…", on: "Connected", error: "Not working" } as const;

/** Services › Integrations: what the hub is connected to, each way. Accounts the agents act in (connectors), and
 *  the hub's own tools handed to other harnesses (its MCP server). The tools themselves are listed in AI › Tools. */
export const IntegrationsSettings = () => <><ConnectorsGroup /><McpAccess /></>;

/**
 * Conduit's tools for other harnesses: the hub's MCP endpoint (conduit_ui, conduit_inbox and browser). Claude Code started by Conduit on the
 * hub is given it; Codex and other MCP clients are added by hand, from what is copied here. The token is copied inside
 * the entry, never shown.
 */
/** How long a copied entry's confirmation (or a refusal) stays before the line returns to rest. */
const COPIED_HOLD_MS = 2000;
function McpAccess() {
  const [access, setAccess] = createSignal<{ url: string; codex: string; browser: boolean } | null>(null);
  const [copied, setCopied] = createSignal("");
  onMount(() => void api<{ url: string; codex: string; browser: boolean }>("/v0/mcp/access").then(setAccess).catch(() => {}));
  const copy = (what: string, text: string) => void navigator.clipboard.writeText(text).then(() => { setCopied(what); window.setTimeout(() => setCopied(""), COPIED_HOLD_MS); })
    .catch(() => setCopied("Copying was not allowed here"));
  return <Show when={access()}>{(found) => <Group title="Conduit's tools in other harnesses">
    <SettingLine plain label="conduit" mono title="Conduit's MCP server: another harness can arrange your tabs and edit the hub's shared inbox. It needs a signed-in session or the hub's token.">
      <SettingValue mono>{found().url}</SettingValue>
    </SettingLine>
    <SettingLine plain label="Codex" state="paste into ~/.codex/config.toml">
      <Button variant="ghost" size="sm" onClick={() => copy("Codex entry copied", found().codex)}>Copy entry</Button>
    </SettingLine>
    <Show when={copied()}><LiveNote>{copied()}</LiveNote></Show>
    <Note>Claude Code chats started on the hub have both already.{found().browser ? "" : " The hub browser is not installed on this hub."}</Note>
  </Group>}</Show>;
}

/** Connected accounts: Connect signs in in another tab (the system browser in the apps). */
function ConnectorsGroup() {
  const [connectors, setConnectors] = createSignal<Connector[]>([]);
  const [connecting, setConnecting] = createSignal<string | null>(null);
  // What went wrong last, by connector ("" for the list itself): said in the row until the next try.
  const [failure, setFailure] = createSignal<Record<string, string>>({});
  const fail = (id: string, error: unknown) => setFailure({ ...failure(), [id]: error instanceof Error ? error.message : String(error) });
  const clear = (id: string) => { const { [id]: _, ...rest } = failure(); setFailure(rest); };
  const loadConnectors = () => api<Connector[]>("/v0/agent/connectors").then((list) => { setConnectors(list); clear(""); }).catch((error) => fail("", error));
  // Signing in happens in another tab; the row follows it there for a while.
  let watching = 0;
  // A connect answered after the page closed must not start the watch.
  let disposed = false;
  const watch = () => { if (disposed) return; clearInterval(watching); let left = 40; watching = window.setInterval(() => { if (--left <= 0) clearInterval(watching); void loadConnectors(); }, 3000); };
  onCleanup(() => { disposed = true; clearInterval(watching); });
  const connect = async (connector: Connector) => {
    setConnecting(connector.id); clear(connector.id);
    try {
      const { authorizationUrl } = await api<{ authorizationUrl: string }>(`/v0/agent/connectors/${encodeURIComponent(connector.id)}/connect`, { method: "POST", body: JSON.stringify({}) });
      // A blocked tab gives nothing back: the sign-in is then opened here instead.
      if (!window.open(authorizationUrl, "_blank", "noopener,noreferrer")) window.location.assign(authorizationUrl);
      watch();
    } catch (error) { fail(connector.id, error); }
    finally { setConnecting(null); }
  };
  const disconnect = async (connector: Connector) => {
    setConnecting(connector.id); clear(connector.id);
    try { await api(`/v0/agent/connectors/${encodeURIComponent(connector.id)}`, { method: "DELETE" }); await loadConnectors(); }
    catch (error) { fail(connector.id, error); }
    finally { setConnecting(null); }
  };

  onMount(() => void loadConnectors());
  // A hub without its agent has nothing to call them yet: the group waits for one.
  return <Show when={connectors().length}><Group title="Connected accounts">
    <For each={connectors()}>{(connector) =>
      <SettingLine label={connector.label} title={`${connector.url}: signed in once for this hub. Anything that is not a read asks you first.`}
        state={<>{failure()[connector.id] || (connector.status === "on"
          ? `Connected · ${connector.tools} tools`
          : connector.status === "error" ? connector.error || CONNECTOR_STATE.error : CONNECTOR_STATE[connector.status])}</>}>
        <Show when={connector.status === "off" || connector.status === "error"} fallback={
          <Button size="sm" variant="destructive" outline disabled={connecting() === connector.id || connector.status === "connecting"} onClick={() => void disconnect(connector)}>Disconnect</Button>}>
          <Button size="sm" variant="ghost" disabled={connecting() === connector.id} onClick={() => void connect(connector)}>Connect</Button>
        </Show>
      </SettingLine>}
    </For>
  </Group></Show>;
}
