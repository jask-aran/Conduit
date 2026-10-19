import { Show, createUniqueId, splitProps, type JSX } from "solid-js";
import { ArrowRightIcon } from "lucide-solid";
import { StatusDot } from "./nav";
import { Button, Input } from "./controls";

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

/** Plain HTML form: works unchanged when server-rendered, with JavaScript off. */
export function PasswordSignIn(props: { after: string; error?: string | null; onSubmit?: JSX.FormHTMLAttributes<HTMLFormElement>["onSubmit"] }) {
  const id = createUniqueId();
  return <ConnectionForm action="/v0/auth/login" method="post" autocomplete="on" onSubmit={props.onSubmit}>
    <div class="ui-connection-password">
      <Input id={`${id}-password`} name="password" type="password" autocomplete="current-password" aria-label="Password" placeholder="Password" autofocus required aria-invalid={props.error ? "true" : undefined} aria-describedby={props.error ? `${id}-error` : undefined} />
      <Button type="submit" variant="ghost" size="icon" aria-label="Sign in" title="Sign in"><ArrowRightIcon /></Button>
    </div>
    <input name="after" type="hidden" value={props.after} />
    <Show when={props.error}><p id={`${id}-error`} class="ui-connection-error" role="alert">{props.error}</p></Show>
  </ConnectionForm>;
}

export function ServerControl(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { name: string; detail: string; connectivity: string; compact?: boolean }) {
  const [local, rest] = splitProps(props, ["name", "detail", "connectivity", "compact"]);
  const busy = () => local.connectivity === "connecting" || local.connectivity === "reconnecting";
  const tone = () => local.connectivity === "online" ? "success" : local.connectivity === "offline" ? "danger" : local.connectivity === "reconnecting" ? "warn" : "muted";
  return <Button {...rest} variant="ghost" class="ui-server-control" data-compact={local.compact ? "" : undefined}>
    <span class="ui-server-copy"><strong>{local.name}</strong><small>{local.detail}</small></span>
    <StatusDot label={local.detail} tone={tone()} spinning={busy()} />
  </Button>;
}

export function ConnectionRecovery(props: { title: string; error: string; onRetry: () => void; retryLabel?: string; embedded?: boolean }) {
  return <ConnectionScreen embedded={props.embedded}><section class="ui-connection-recovery"><h1>{props.title}</h1><p role="alert">{props.error}</p><Button onClick={props.onRetry}>{props.retryLabel ?? "Retry"}</Button></section></ConnectionScreen>;
}
