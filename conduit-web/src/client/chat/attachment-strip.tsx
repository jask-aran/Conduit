import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import * as KDialog from "@kobalte/core/dialog";
import { FileIcon, Maximize2Icon, RotateCwIcon, XIcon } from "lucide-solid";
import { Button } from "@/components/primitives";
import type { UploadAttachment } from "../state/attachments";
import { attachmentUrl } from "../api/transport";
import { AttachmentImage, sizeLabel } from "./attachments";
import { createLeaving, fadeOut, type CardExit } from "./composer-cards";
import "./attachment-strip.css";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const isImage = (item: UploadAttachment) => Boolean(item.type?.startsWith("image/"));
const previewOf = (item: UploadAttachment, chatId?: string | null) =>
  item.objectUrl || (isImage(item) && chatId ? attachmentUrl(chatId, item.id, "?preview=1") : null);
const RING = 2 * Math.PI * 9;

/** Upload progress over a chip's media: a thin ring, filled as it goes. */
function ProgressRing(props: { progress: number }) {
  return <svg class="attachment-chip-ring" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="9" stroke-dasharray={`${RING}`} stroke-dashoffset={RING * (1 - Math.min(100, props.progress) / 100)} />
  </svg>;
}

function AttachmentChip(props: {
  item: UploadAttachment;
  chatId?: string | null;
  entering: boolean;
  onOpen: () => void;
  onRemove: (chip: HTMLElement) => void;
  onRetry: () => void;
}) {
  let chip!: HTMLDivElement;
  const failed = () => props.item.status === "error";
  const busy = () => props.item.status === "uploading" || props.item.status === "queued";
  const retryable = () => failed() && Boolean(props.item.file);
  const source = previewOf(props.item, props.chatId);
  return <div ref={chip} class="attachment-chip" data-kind={isImage(props.item) ? "image" : "file"} data-status={props.item.status} data-entering={props.entering || undefined} title={failed() ? `${props.item.name}: ${props.item.error || "Upload failed"}` : props.item.name}>
    <button type="button" class="attachment-chip-body" aria-label={retryable() ? `Retry ${props.item.name}` : `Show ${props.item.name}`} onClick={() => retryable() ? props.onRetry() : props.onOpen()}>
      <span class="attachment-chip-media">
        <Show when={source} fallback={<FileIcon />}><AttachmentImage src={source!} /></Show>
        <Show when={busy()}><ProgressRing progress={props.item.progress} /></Show>
        <Show when={retryable()}><RotateCwIcon class="attachment-chip-retry" /></Show>
      </span>
      <Show when={!isImage(props.item)}>
        <span class="attachment-chip-copy"><strong>{props.item.name}</strong><small>{failed() ? props.item.error || "Upload failed" : sizeLabel(props.item.size)}</small></span>
      </Show>
    </button>
    <button type="button" class="attachment-chip-remove" aria-label={`Remove ${props.item.name}`} onClick={() => props.onRemove(chip)}><XIcon /></button>
  </div>;
}

/** Every attachment for the draft, larger and uncropped, to check or remove. */
function AttachmentsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: UploadAttachment[];
  chatId?: string | null;
  onRemove: (item: UploadAttachment) => unknown;
}) {
  const total = () => props.items.reduce((sum, item) => sum + (item.size || 0), 0);
  const removeAll = () => {
    props.onOpenChange(false);
    for (const item of props.items) void props.onRemove(item);
  };
  createEffect(() => { if (props.open && !props.items.length) props.onOpenChange(false); });
  return <KDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
    <KDialog.Portal>
      <KDialog.Content class="conduit-modal attachment-dialog" onClick={(event) => { if (event.target === event.currentTarget) props.onOpenChange(false); }}>
        <div class="conduit-modal-card attachment-dialog-card">
          <header class="attachment-dialog-head">
            <KDialog.Title>{props.items.length === 1 ? "1 attachment" : `${props.items.length} attachments`}</KDialog.Title>
            <KDialog.Description>{sizeLabel(total())}</KDialog.Description>
          </header>
          <ul class="attachment-dialog-list">
            <For each={props.items.map((item) => item.id)}>{(id) => {
              const item = createMemo<UploadAttachment | undefined>((last) => props.items.find((candidate) => candidate.id === id) ?? last);
              const source = () => item() && previewOf(item()!, props.chatId);
              return <Show when={item()}>{(current) => <li class="attachment-dialog-row" data-status={current().status}>
                <span class="attachment-dialog-preview" data-kind={isImage(current()) ? "image" : "file"}>
                  <Show when={source()} fallback={<FileIcon />}><AttachmentImage src={source()!} /></Show>
                </span>
                <span class="attachment-dialog-copy">
                  <strong>{current().name}</strong>
                  <small>{current().status === "error" ? current().error || "Upload failed" : [sizeLabel(current().size), current().type].filter(Boolean).join(" · ")}</small>
                </span>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${current().name}`} onClick={() => void props.onRemove(current())}><XIcon /></Button>
              </li>}</Show>;
            }}</For>
          </ul>
          <footer class="attachment-dialog-actions">
            <Button variant="ghost" size="sm" onClick={removeAll}>Remove all</Button>
            <Button size="sm" onClick={() => props.onOpenChange(false)}>Done</Button>
          </footer>
        </div>
      </KDialog.Content>
    </KDialog.Portal>
  </KDialog.Root>;
}

/**
 * Every attachment for the message being written, in one strip directly above
 * the composer: never taller than one row of chips, scrolling sideways as more
 * arrive, with the expand button opening them all at a readable size.
 *
 * Chips are keyed by attachment id. An upload's progress replaces its item with
 * a new object, and a list keyed by object would rebuild the chip -- replaying
 * its entrance -- on every update.
 */
export function AttachmentStrip(props: {
  items: UploadAttachment[];
  chatId?: string | null;
  surface: string;
  onRemove: (item: UploadAttachment) => unknown;
  onRetry: (item: UploadAttachment) => void;
}) {
  // Sent, the strip drops into the composer. The last chip removed by hand
  // takes the strip with it, faded in place.
  const [exit, setExit] = createSignal<CardExit>("drop");
  createEffect(() => { if (props.items.length > 0) setExit("drop"); });
  const shown = createLeaving(() => props.items, (items) => items.length > 0, exit);
  const byId = createMemo(() => new Map(shown.value().map((item) => [item.id, item])));
  const ids = createMemo(() => shown.value().map((item) => item.id), undefined, { equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]) });
  const [open, setOpen] = createSignal(false);
  const [fades, setFades] = createSignal({ start: false, end: false });
  let scroller: HTMLDivElement | undefined;
  // Chips there when the strip rises come with it; only later ones enter alone.
  let risen = false;

  const measure = () => {
    if (!scroller) return;
    const { scrollLeft, scrollWidth, clientWidth } = scroller;
    setFades({ start: scrollLeft > 1, end: scrollLeft + clientWidth < scrollWidth - 1 });
  };
  // New chips go on the end; show them, which is what pasting several needs.
  createEffect(on(() => ids().length, (count, previous) => {
    queueMicrotask(() => {
      if (scroller && previous != null && count > previous) scroller.scrollTo({ left: scroller.scrollWidth, behavior: reduced() ? "auto" : "smooth" });
      measure();
    });
  }));

  const remove = async (chip: HTMLElement, item: UploadAttachment) => {
    if (props.items.length === 1) { setExit("fade"); await props.onRemove(item); return; }
    const neighbours = [...(chip.parentElement?.children || [])].filter((node): node is HTMLElement => node !== chip && node instanceof HTMLElement);
    const before = new Map(neighbours.map((node) => [node, node.getBoundingClientRect().left]));
    const faded = await fadeOut(chip);
    // A removal that fails leaves the attachment in place, so it is shown again.
    if (await props.onRemove(item) === false) { faded?.cancel(); return; }
    if (reduced()) return;
    // The chips after it slide over to close the gap, by transform.
    for (const [node, left] of before) {
      const dx = left - node.getBoundingClientRect().left;
      if (node.isConnected && Math.abs(dx) > 0.5) node.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.2, .8, .2, 1)" });
    }
    measure();
  };

  const wheel = (event: WheelEvent) => {
    if (!scroller || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || scroller.scrollWidth <= scroller.clientWidth) return;
    event.preventDefault();
    scroller.scrollLeft += event.deltaY;
  };
  const attach = (element: HTMLDivElement) => {
    scroller = element;
    element.addEventListener("wheel", wheel, { passive: false });
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    onCleanup(() => { resize.disconnect(); element.removeEventListener("wheel", wheel); scroller = undefined; risen = false; });
    onMount(() => { measure(); risen = true; });
  };

  return <>
    <Show when={shown.value().length}>
      <div class="attachment-strip composer-surface-material composer-card" data-composer-surface={props.surface} data-leaving={shown.leaving() || undefined} role="group" aria-label="Attachments">
        <div ref={attach} class="attachment-strip-scroller" data-fade-start={fades().start || undefined} data-fade-end={fades().end || undefined} onScroll={measure}>
          <For each={ids()}>{(id) => {
            const item = createMemo<UploadAttachment>((last) => byId().get(id) ?? last, byId().get(id)!);
            return <AttachmentChip item={item()} chatId={props.chatId} entering={risen} onOpen={() => setOpen(true)} onRemove={(chip) => void remove(chip, item())} onRetry={() => props.onRetry(item())} />;
          }}</For>
        </div>
        <Button class="attachment-strip-expand" variant="ghost" size="icon-sm" aria-label={`Show all ${props.items.length} attachments`} title="Show all attachments" onClick={() => setOpen(true)}><Maximize2Icon /></Button>
      </div>
    </Show>
    <AttachmentsDialog open={open()} onOpenChange={setOpen} items={props.items} chatId={props.chatId} onRemove={props.onRemove} />
  </>;
}
