import { splitProps, type JSX } from "solid-js";
import { Button } from "./controls";

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
