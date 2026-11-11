import { createSignal, For, onMount, Show } from "solid-js";
import { Button, Input, SettingDetails, SettingLine, Group, Note } from "@/components/ui";
import { api } from "../api/client";

type Session = { id: string; kind: "browser" | "native" | "script"; userAgent: string | null; createdAt: string | null; lastSeenAt: string | null; current: boolean };

export function clientName(session: Pick<Session, "kind" | "userAgent">) {
  const agent = session.userAgent || "";
  const os = /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Windows/.test(agent) ? "Windows"
    : /Mac OS X/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "";
  if (session.kind === "native" || /conduit-devtools-native|Conduit\//.test(agent)) return os ? `Conduit app on ${os}` : "Conduit app";
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "A browser";
  return os ? `${browser} on ${os}` : browser;
}

const ago = (at: string | null) => {
  if (!at) return "";
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60_000));
  return minutes < 2 ? "active now" : minutes < 60 ? `${minutes} min ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`;
};

export function SignInsGroup() {
  const [sessions, setSessions] = createSignal<Session[] | null>(null);
  const [error, setError] = createSignal("");
  const load = () => api<{ sessions: Session[] }>("/v0/auth/sessions").then((result) => setSessions(result.sessions)).catch((failure) => setError((failure as Error).message));
  onMount(() => void load());
  const end = async (session: Session) => {
    setError("");
    try { await api(`/v0/auth/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" }); await load(); }
    catch (failure) { setError((failure as Error).message); }
  };
  const people = () => (sessions() ?? []).filter((session) => session.kind !== "script")
    .sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastSeenAt || "0") - Date.parse(a.lastSeenAt || "0"));
  const scripts = () => (sessions() ?? []).filter((session) => session.kind === "script").length;
  const recent = (session: Session) => session.current || Date.now() - Date.parse(session.lastSeenAt || "0") < 24 * 60 * 60_000;
  const others = () => people().filter((session) => !session.current);
  const older = () => people().filter((session) => !recent(session));
  const endOthers = async () => {
    setError("");
    try { await Promise.all(others().map((session) => api(`/v0/auth/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" }))); }
    catch (failure) { setError((failure as Error).message); }
    await load();
  };
  const line = (session: Session) => <SettingLine plain label={clientName(session)} state={session.current ? "this device" : ago(session.lastSeenAt)}
    title={session.userAgent || undefined}>
    <Show when={!session.current}><Button size="sm" variant="ghost" haptic="destructive" onClick={() => void end(session)}>Sign out</Button></Show>
  </SettingLine>;
  return <Group title="Signed in">
    <For each={people().filter(recent)}>{line}</For>
    <Show when={older().length}><SettingDetails summary={`${older().length} not used in the last day`}><For each={older()}>{line}</For></SettingDetails></Show>
    <Show when={others().length > 1}><SettingLine plain label="Other devices" state={`${others().length} sign-ins`}>
      <Button size="sm" variant="destructive" outline onClick={() => void endOthers()}>Sign out all others</Button>
    </SettingLine></Show>
    <Show when={scripts()}><SettingLine plain label="Scripts" state={`${scripts()} short sessions`} title="Sessions scripts and probes made for themselves; each ends an hour after its last use." /></Show>
    <Show when={error()}><Note tone="error">{error()}</Note></Show>
  </Group>;
}

export function PasswordGroup() {
  const [open, setOpen] = createSignal(false);
  const [current, setCurrent] = createSignal("");
  const [next, setNext] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal<{ tone: "error" | "quiet"; text: string } | null>(null);
  const save = async () => {
    setBusy(true); setMessage(null);
    try {
      await api("/v0/auth/password", { method: "POST", body: JSON.stringify({ current: current(), next: next() }) });
      setOpen(false); setCurrent(""); setNext("");
      setMessage({ tone: "quiet", text: "Password changed. Every other device was signed out." });
    } catch (failure) { setMessage({ tone: "error", text: (failure as Error).message }); }
    finally { setBusy(false); }
  };
  return <Group title="Password">
    <SettingLine plain label="Password" title="The one password for this hub. Changing it signs out every other device.">
      <Show when={!open()}><Button size="sm" variant="secondary" onClick={() => { setOpen(true); setMessage(null); }}>Change…</Button></Show>
    </SettingLine>
    <Show when={open()}>
      <SettingLine label="Current">
        <Input type="password" autocomplete="current-password" aria-label="Current password" value={current()} onInput={(event) => setCurrent(event.currentTarget.value)} />
      </SettingLine>
      <SettingLine label="New" state={next() && next().length < 8 ? "at least 8 characters" : undefined}>
        <Input type="password" autocomplete="new-password" aria-label="New password" value={next()} onInput={(event) => setNext(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && current() && next().length >= 8) void save(); }} />
      </SettingLine>
      <SettingLine plain label="Other devices are signed out">
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setCurrent(""); setNext(""); }}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={busy() || !current() || next().length < 8} onClick={() => void save()}>Change password</Button>
      </SettingLine>
    </Show>
    <Show when={message()}>{(shown) => <Note tone={shown().tone}>{shown().text}</Note>}</Show>
  </Group>;
}
