import { Frost } from "./frost";
import { Steps } from "./steps";
import * as Icons from "./icons";
import { Show, type JSX } from "solid-js";

import { cn } from "@/lib/utils";
import { Button } from "./controls";
import { type Density, type Motion, motionOf } from "./shared";
import { Actions, CloseButton } from "./actions";
import { ChipCopy } from "./rider";

export function Card(props: { title?: JSX.Element; element?: "div" | "button"; onClick?: () => void; role?: "group"; label?: string; surface?: "frost" | "outline"; detail?: JSX.Element; description?: JSX.Element; embedded?: boolean; class?: string; density?: Density; size?: "wide" | "large" | "split" | "compact" | "row"; close?: boolean | (() => void); closeLabel?: string; closeIcon?: JSX.Element; closeDisabled?: boolean; actions?: JSX.Element; motion?: Motion; children?: JSX.Element }) {
  return <Frost as={props.element} type={props.element === "button" ? "button" : undefined} onClick={props.onClick} lift="raised" plain={props.surface === "outline"} role={props.role ?? (props.embedded ? undefined : "dialog")} aria-label={props.label ?? (!props.embedded && typeof props.title === "string" ? props.title : undefined)} class={cn("ui-card", props.surface === "outline" && "ui-outline", props.class)} data-density={props.density} data-size={props.size} data-close={props.close ? "" : undefined} {...motionOf(props.motion)}>
    <Show when={props.title}><h3>{props.title}</h3></Show><Show when={props.detail}><p>{props.detail}</p></Show>
    <Show when={props.description}><span class="ui-card-description">{props.description}</span></Show>
    <Show when={props.close}><CloseButton class="ui-card-close" label={props.closeLabel} icon={props.closeIcon} disabled={props.closeDisabled} onClick={() => typeof props.close === "function" && props.close()} /></Show>
    {props.children}
    <Show when={props.actions}><Actions>{props.actions}</Actions></Show>
  </Frost>;
}

export const CardForm = (props: JSX.FormHTMLAttributes<HTMLFormElement>) => <form {...props} class="ui-card-form" />;
export const CardBody = (props: { children: JSX.Element }) => <div class="ui-card-body">{props.children}</div>;
export const CardRead = (props: { children: JSX.Element }) => <code class="ui-card-read">{props.children}</code>;
export const CardDetails = (props: { children: JSX.Element }) => <dl class="ui-card-details">{props.children}</dl>;
/** Shut until asked for: a phone is likelier the one scanning than the one scanned. */
export const CardQR = (props: { svg: string; expired?: boolean; open?: boolean }) =>
  <Steps class="ui-card-qr-room" step={props.open ?? true ? "code" : ""}><Show when={props.open ?? true}><div class="ui-card-qr" innerHTML={props.svg} data-expired={props.expired ? "" : undefined} aria-label="Pairing QR code" role="img" /></Show></Steps>;
export const CardCaption = (props: { children: string; title?: string }) => <p class="ui-card-caption ui-truncate" title={props.title ?? props.children}>{props.children}</p>;
export const CardPreview = (props: { children: JSX.Element }) => <div class="ui-card-preview">{props.children}</div>;
export const Attachments = (props: { form?: "list" | "tray"; label?: string; children: JSX.Element }) =>
  <ul class="ui-attachments" data-form={props.form ?? "list"} aria-label={props.label}>{props.children}</ul>;
export const CardStage = (props: { children: JSX.Element }) => <div class="ui-card-stage">{props.children}</div>;
export const CardSteps = (props: { onPrevious: () => void; onNext: () => void; children: JSX.Element }) =>
  <div class="ui-card-steps">
    <Button variant="ghost" size="icon-sm" aria-label="Previous" title="Previous" onClick={() => props.onPrevious()}><Icons.ChevronLeft /></Button>
    {props.children}
    <Button variant="ghost" size="icon-sm" aria-label="Next" title="Next" onClick={() => props.onNext()}><Icons.ChevronRight /></Button>
  </div>;
export const AttachmentTile = (props: { name: string; image?: JSX.Element; icon: JSX.Element; current?: boolean; onOpen?: () => void }) =>
  <li class="ui-attachment-tile" data-image={props.image ? "" : undefined}>
    <button type="button" class={props.image ? undefined : "ui-frost"} aria-label={`Show ${props.name}`} aria-current={props.current ? "true" : undefined} title={props.name} onClick={() => props.onOpen?.()}>
      <Show when={props.image} fallback={<>{props.icon}<span>{props.name}</span></>}>{props.image}</Show>
    </button>
  </li>;
export function Attachment(props: { name: string; detail: string; image?: JSX.Element; icon: JSX.Element; failed?: boolean; onRemove?: () => void }) {
  return <li class="ui-attachment" data-image={props.image ? "" : undefined} title={props.image ? props.name : undefined} data-error={props.failed ? "" : undefined}>
    <span class="ui-attachment-media" data-image={props.image ? "" : undefined}>{props.image ?? props.icon}</span>
    <ChipCopy name={props.name} detail={props.detail} />
    <Show when={props.onRemove}><CloseButton label={`Remove ${props.name}`} onClick={() => props.onRemove?.()} /></Show>
  </li>;
}
