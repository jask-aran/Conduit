import { Icons } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Button as DialogButton } from "@/components/ui/controls";
import { Attachments, Attachment } from "@/components/ui/card";
import { createEffect, createMemo, createSignal, For, lazy, on, onCleanup, onMount, Show, Suspense } from "solid-js";


import { Button as LibraryButton, Chip, Chips, Rider, RiderActions } from "@/components/ui";
import type { UploadAttachment } from "../state/attachments";
import { attachmentUrl } from "../api/transport";
import { AttachmentImage, sizeLabel } from "./attachments";
import { createLeaving, fadeOut, riderMotion, type CardExit } from "./composer-cards";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const isImage = (item: UploadAttachment) => Boolean(item.type?.startsWith("image/"));
const previewOf = (item: UploadAttachment, chatId?: string | null) =>
  item.objectUrl || (isImage(item) && chatId ? attachmentUrl(chatId, item.id, "?preview=1") : null);
// The file viewer's icons. Its icon theme lives in the workspace's lazy chunk,
// so it is fetched on the first file chip rather than carried by the composer.
const WorkspaceFileIcon = lazy(() => import("@/components/ui/file-marks").then((module) => ({ default: module.FileTypeIcon })));
const FileMark = (props: { name: string }) => <Suspense fallback={<Icons.File />}><WorkspaceFileIcon name={props.name} /></Suspense>;

/** One attachment as a Chip: a press shows it (or retries a failed upload that can be), its remove button removes it. */
function AttachmentChip(props: { item: UploadAttachment; chatId?: string | null; entering: boolean; onOpen: () => void; onRemove: (chip: HTMLElement) => void; onRetry: () => void }) {
  const failed = () => props.item.status === "error";
  const source = previewOf(props.item, props.chatId);
  return <Chip name={props.item.name} detail={failed() ? props.item.error || "Upload failed" : sizeLabel(props.item.size)}
    image={isImage(props.item) && source ? <AttachmentImage src={source} /> : undefined} icon={<FileMark name={props.item.name} />}
    status={props.item.status === "uploading" || props.item.status === "queued" || props.item.status === "error" ? props.item.status : "done"} progress={props.item.progress}
    retry={failed() && Boolean(props.item.file)} title={failed() ? `${props.item.name}: ${props.item.error || "Upload failed"}` : props.item.name}
    motion={props.entering ? "entering" : undefined} onOpen={props.onOpen} onRetry={props.onRetry} onRemove={props.onRemove} />;
}

/** Every attachment for the draft, larger and uncropped, to check or remove. */
function AttachmentsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: UploadAttachment[];
  chatId?: string | null;
  onRemove: (item: UploadAttachment) => unknown;
  onRemoveAll: () => void;
}) {
  const total = () => props.items.reduce((sum, item) => sum + (item.size || 0), 0);
  const removeAll = () => { props.onOpenChange(false); props.onRemoveAll(); };
  createEffect(() => { if (props.open && !props.items.length) props.onOpenChange(false); });
  return <Dialog open={props.open} onOpenChange={props.onOpenChange} size="wide"
   title={props.items.length === 1 ? "1 attachment" : `${props.items.length} attachments`}
    description={sizeLabel(total())}
    actions={<><DialogButton variant="ghost" size="sm" onClick={removeAll}>Remove all</DialogButton>
            <DialogButton size="sm" onClick={() => props.onOpenChange(false)}>Done</DialogButton></>}>
    <Attachments>
            <For each={props.items.map((item) => item.id)}>{(id) => {
              const item = createMemo<UploadAttachment | undefined>((last) => props.items.find((candidate) => candidate.id === id) ?? last);
              const source = () => item() && previewOf(item()!, props.chatId);
              return <Show when={item()}>{(current) => <Attachment name={current().name}
                detail={current().status === "error" ? current().error || "Upload failed" : [sizeLabel(current().size), current().type].filter(Boolean).join(" · ")}
                failed={current().status === "error"} icon={<FileMark name={current().name} />}
                image={source() ? <AttachmentImage src={source()!} /> : undefined}
                onRemove={() => void props.onRemove(current())} />}</Show>;
            }}</For>
          </Attachments>
  </Dialog>;
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
  onRemove: (item: UploadAttachment) => unknown;
  onRetry: (item: UploadAttachment) => void;
}) {
  // Sent, the strip drops into the composer. The last chip removed by hand
  // takes the strip with it, faded in place.
  const [exit, setExit] = createSignal<CardExit>("drop");
  // Removing everything fades the strip at once, not chip by chip as each
  // removal lands; one that fails brings the strip back with what is left.
  const [clearing, setClearing] = createSignal(false);
  createEffect(() => { if (props.items.length > 0 && !clearing()) setExit("drop"); });
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

  const removeAll = async () => {
    setExit("none");
    setClearing(true);
    await Promise.all(props.items.map((item) => props.onRemove(item)));
    setClearing(false);
  };
  const remove = async (chip: HTMLElement, item: UploadAttachment) => {
    if (props.items.length === 1) { setExit("fade"); await props.onRemove(item); return; }
    const faded = await fadeOut(chip, 100);
    // The chip gives its room up now, not when the server confirms, and the
    // chips after it slide over by transform. A removal that fails puts it back.
    const neighbours = [...(chip.parentElement?.children || [])].filter((node): node is HTMLElement => node !== chip && node instanceof HTMLElement);
    const before = new Map(neighbours.map((node) => [node, node.getBoundingClientRect().left]));
    chip.hidden = true;
    if (!reduced()) {
      for (const [node, left] of before) {
        const dx = left - node.getBoundingClientRect().left;
        if (Math.abs(dx) > 0.5) node.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: 180, easing: "cubic-bezier(.2, .8, .2, 1)" });
      }
    }
    measure();
    if (await props.onRemove(item) === false) { chip.hidden = false; faded?.cancel(); measure(); }
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
      <Rider label="Attachments" layout="strip" motion={riderMotion(clearing() ? "fade" : shown.leaving())}>
        <Chips ref={attach} fadeStart={fades().start} fadeEnd={fades().end} onScroll={measure}>
          <For each={ids()}>{(id) => {
            const item = createMemo<UploadAttachment>((last) => byId().get(id) ?? last, byId().get(id)!);
            return <AttachmentChip item={item()} chatId={props.chatId} entering={risen} onOpen={() => setOpen(true)} onRemove={(chip) => void remove(chip, item())} onRetry={() => props.onRetry(item())} />;
          }}</For>
        </Chips>
        <RiderActions stack>
          <LibraryButton variant="ghost" size="icon-sm" aria-label="Show all attachments" title="Show all attachments" onClick={() => setOpen(true)}><Icons.Maximize /></LibraryButton>
          <LibraryButton variant="ghost" size="icon-sm" aria-label="Remove all attachments" title="Remove all" onClick={() => void removeAll()}><Icons.Delete /></LibraryButton>
        </RiderActions>
      </Rider>
    </Show>
    <AttachmentsDialog open={open()} onOpenChange={setOpen} items={props.items} chatId={props.chatId} onRemove={props.onRemove} onRemoveAll={() => void removeAll()} />
  </>;
}
