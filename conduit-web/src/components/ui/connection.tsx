import * as Icons from "./icons";
import { Show, createUniqueId, splitProps, type JSX } from "solid-js";
import { CircleAlertIcon } from "lucide-solid";
import { StatusDot } from "./nav";
import { Button, Input, Spinner } from "./controls";

export function ConnectionForm(props: JSX.FormHTMLAttributes<HTMLFormElement>) {
  return <form {...props} class="ui-connection" />;
}
export const ConnectionHeading = (props: { mark: JSX.Element; children: JSX.Element }) => <header class="ui-connection-heading">{props.mark}<h1>{props.children}</h1></header>;
export const ConnectionChoices = (props: { children: JSX.Element }) => <ul class="ui-connection-choices">{props.children}</ul>;
export function ConnectionChoice(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { icon: JSX.Element; detail?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["icon", "detail", "children"]);
  return <li><Button {...rest} variant="ghost" class="ui-connection-choice"><span class="ui-connection-icon">{local.icon}</span><span>{local.children}</span><code>{local.detail}</code></Button></li>;
}
export const ConnectionGroup = (props: { children: JSX.Element }) => <p class="ui-connection-group">{props.children}</p>;
export function CameraPreview(props: { videoRef: (element: HTMLVideoElement) => void; message: string; onClose: () => void }) {
  return <div class="ui-camera"><video ref={props.videoRef} playsinline muted /><div class="ui-camera-frame" aria-hidden="true" /><p role="status">{props.message}</p><Button variant="ghost" outline onClick={props.onClose}>Cancel</Button></div>;
}

/** Shared access page, including safe-area room and a scrollable keyboard layout. */
export const ConnectionScreen = (props: { children: JSX.Element; embedded?: boolean }) => <main class="ui-connection-screen" data-embedded={props.embedded ? "" : undefined}>{props.children}</main>;

/*
 * Signing in, one set of pieces for every place that does it (the sign-in screen, Connect, a server's own page):
 * an address that says what it found, a line saying so, and the password row that appears beneath it.
 */
export type AddressState = "checking" | "found" | "missing";

/** An address field that ticks once a server answered there; the looking is said by the ConnectionStatus beneath. */
export function ConnectionAddress(props: JSX.InputHTMLAttributes<HTMLInputElement> & { state?: AddressState }) {
  const [local, rest] = splitProps(props, ["state"]);
  return <div class="ui-connection-address" data-state={local.state}>
    <Input {...rest} type="text" inputMode="url" autocomplete="url" autocapitalize="none" spellcheck={false} aria-invalid={local.state === "missing" ? "true" : undefined} />
    <span class="ui-connection-address-mark" aria-hidden="true"><Show when={local.state === "found"}><Icons.Check /></Show></span>
  </div>;
}

/** What the check found, one line: the server's name (or its host) and a detail, or why nothing answered. It rises in. */
export function ConnectionStatus(props: { state: AddressState; title: string; detail?: string }) {
  return <p class="ui-connection-status" data-state={props.state} role={props.state === "missing" ? "alert" : "status"}>
    <span class="ui-connection-status-mark" aria-hidden="true"><Show when={props.state === "checking"} fallback={props.state === "found" ? <span class="ui-status-dot" /> : <CircleAlertIcon />}><Spinner /></Show></span>
    <strong>{props.title}</strong><Show when={props.detail}><small title={props.detail}>{props.detail}</small></Show>
  </p>;
}

/** The password and its arrow, one row; busy while it signs in, its error beneath. Rises in when it follows an address. */
export function ConnectionPassword(props: JSX.InputHTMLAttributes<HTMLInputElement> & { busy?: boolean; error?: string | null; reveal?: boolean }) {
  const [local, rest] = splitProps(props, ["busy", "error", "reveal", "id"]);
  const id = local.id ?? createUniqueId();
  return <div class="ui-connection-password-step" data-reveal={local.reveal ? "" : undefined}>
    <div class="ui-connection-password">
      <Input {...rest} id={id} type="password" autocomplete="current-password" aria-label="Password" placeholder="Password" aria-invalid={local.error ? "true" : undefined} aria-describedby={local.error ? `${id}-error` : undefined} />
      <Button type="submit" variant="ghost" size="icon" aria-label="Sign in" title="Sign in" disabled={local.busy || rest.disabled}><Show when={local.busy} fallback={<Icons.Proceed />}><Spinner /></Show></Button>
    </div>
    <Show when={local.error}><p id={`${id}-error`} class="ui-connection-error" role="alert">{local.error}</p></Show>
  </div>;
}

/** Plain HTML form: works unchanged when server-rendered, with JavaScript off. */
export function PasswordSignIn(props: { after: string; error?: string | null; onSubmit?: JSX.FormHTMLAttributes<HTMLFormElement>["onSubmit"] }) {
  const id = createUniqueId();
  return <ConnectionForm action="/v0/auth/login" method="post" autocomplete="on" onSubmit={props.onSubmit}>
    <ConnectionPassword id={`${id}-password`} name="password" autofocus required error={props.error} />
    <input name="after" type="hidden" value={props.after} />
  </ConnectionForm>;
}

export function ServerControl(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { name: string; detail: string; connectivity: string; compact?: boolean; inline?: boolean }) {
  const [local, rest] = splitProps(props, ["name", "detail", "connectivity", "compact", "inline"]);
  const busy = () => local.connectivity === "connecting" || local.connectivity === "reconnecting";
  const tone = () => local.connectivity === "online" ? "success" : local.connectivity === "offline" ? "danger" : local.connectivity === "reconnecting" ? "warn" : "muted";
  const dot = () => <StatusDot label={local.detail} tone={tone()} spinning={busy()} />;
  // The name where you are (Row · current), its dot beside it; its state and latency in the data voice, as its menu's meta.
  // inline: one line, the state after the name (a desktop rail's foot); otherwise the state under it (a phone's list).
  return <Button {...rest} variant="ghost" class="ui-server-control" data-compact={local.compact ? "" : undefined} data-inline={local.inline ? "" : undefined}>
    <Show when={!local.compact} fallback={dot()}>
      <span class="ui-server-copy"><span class="ui-server-name"><strong>{local.name}</strong>{dot()}</span><small>{local.detail}</small></span>
    </Show>
  </Button>;
}

export function ConnectionRecovery(props: { title: string; error: string; onRetry: () => void; retryLabel?: string; embedded?: boolean }) {
  return <ConnectionScreen embedded={props.embedded}><section class="ui-connection-recovery"><h1>{props.title}</h1><p role="alert">{props.error}</p><Button onClick={props.onRetry}>{props.retryLabel ?? "Retry"}</Button></section></ConnectionScreen>;
}
