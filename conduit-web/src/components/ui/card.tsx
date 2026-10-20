import { Show, type JSX } from "solid-js";
import { XIcon } from "lucide-solid";
import { cn } from "@/lib/utils";
import { Button } from "./controls";
import { type Density, type Motion, motionOf } from "./shared";

/** size wide: a card that holds content (a list, an excerpt, an editor). close: a × in its corner, for a card with no Cancel. */
export function Card(props: { title: JSX.Element; detail?: JSX.Element; description?: JSX.Element; embedded?: boolean; class?: string; density?: Density; size?: "wide" | "large" | "split"; close?: boolean | (() => void); closeLabel?: string; closeDisabled?: boolean; actions?: JSX.Element; motion?: Motion; children?: JSX.Element }) {
  return <div role={props.embedded ? undefined : "dialog"} aria-label={!props.embedded && typeof props.title === "string" ? props.title : undefined} class={cn("ui-frost ui-card", props.class)} data-density={props.density} data-size={props.size} data-close={props.close ? "" : undefined} data-surface="frost" data-lift="raised" {...motionOf(props.motion)}>
    <h3>{props.title}</h3><Show when={props.detail}><p>{props.detail}</p></Show>
    <Show when={props.description}><span class="ui-card-description">{props.description}</span></Show>
    <Show when={props.close}><Button variant="ghost" size="icon-sm" class="ui-card-close" aria-label={props.closeLabel ?? "Close"} disabled={props.closeDisabled} onClick={() => typeof props.close === "function" && props.close()}><XIcon /></Button></Show>
    {props.children}
    <Show when={props.actions}><CardActions>{props.actions}</CardActions></Show>
  </div>;
}

export const CardActions = (props: { children: JSX.Element }) => <div class="ui-card-actions">{props.children}</div>;
export const CardForm = (props: JSX.FormHTMLAttributes<HTMLFormElement>) => <form {...props} class="ui-card-form" />;
/** Two sides of one task (pair this server, or add another): side by side while each keeps a QR's width, stacked when it cannot. Use with size="split". */
export const CardColumns = (props: { children: JSX.Element }) => <div class="ui-card-columns">{props.children}</div>;
export const CardColumn = (props: { title: string; children: JSX.Element }) => <section class="ui-card-column" aria-label={props.title}><h4>{props.title}</h4>{props.children}</section>;
export const CardBody = (props: { children: JSX.Element }) => <div class="ui-card-body">{props.children}</div>;
export const CardNote = (props: { children: JSX.Element; error?: boolean }) => <p class="ui-card-note" role={props.error ? "alert" : undefined} data-error={props.error ? "" : undefined}>{props.children}</p>;
export const CardRead = (props: { children: JSX.Element }) => <code class="ui-card-read">{props.children}</code>;
export const CardDetails = (props: { children: JSX.Element }) => <dl class="ui-card-details">{props.children}</dl>;
export const CardQR = (props: { svg: string; expired?: boolean }) => <div class="ui-card-qr" innerHTML={props.svg} data-expired={props.expired ? "" : undefined} aria-label="Pairing QR code" role="img" />;
export const CardPreview = (props: { children: JSX.Element }) => <div class="ui-card-preview">{props.children}</div>;
export const CardAttachments = (props: { children: JSX.Element }) => <ul class="ui-card-attachments">{props.children}</ul>;
export function CardAttachment(props: { name: string; detail: string; image?: JSX.Element; icon: JSX.Element; failed?: boolean; onRemove: () => void }) {
  return <li class="ui-card-attachment" data-error={props.failed ? "" : undefined}>
    <span class="ui-card-attachment-media" data-image={props.image ? "" : undefined}>{props.image ?? props.icon}</span>
    <span class="ui-card-attachment-copy"><strong>{props.name}</strong><small>{props.detail}</small></span>
    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${props.name}`} onClick={props.onRemove}><XIcon /></Button>
  </li>;
}
