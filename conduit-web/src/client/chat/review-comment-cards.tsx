import { Icons } from "@/components/ui";
import { CardPreview, CardRead } from "@/components/ui/card";
import { Dialog } from "@/components/dialog";
import { Button as DialogButton, TextArea as DialogTextArea } from "@/components/ui/controls";
import { createSignal, For, lazy, Show, Suspense } from "solid-js";

import { Reference, References } from "@/components/ui";
import { reviewCommentParts, type ProjectedReviewComment, type ReviewComment } from "./review-comments";

import { requestReviewNavigation } from "./review-navigation";

// The preview pulls in CodeMirror, so it arrives with the dialog, not the chat.
const WorkspaceExcerptView = lazy(() => import("../workspace/workspace-excerpt-view"));

/** Review comments as References: under a sent message, or (editable) in the composer's rider. */
export function ReviewCommentCards(props: {
  items: readonly (ReviewComment | ProjectedReviewComment)[];
  label: string;
  chatId?: string;
  onRemove?: (item: ReviewComment) => void;
  onUpdate?: (item: ReviewComment, note: string) => void;
}) {
  return <Show when={props.items.length}><References label={props.label}>
    <For each={[...props.items]}>{(item) => {
      const removable = "id" in item ? item : null;
      const [editing, setEditing] = createSignal(false);
      const [note, setNote] = createSignal(item.note);
      const commit = () => {
        if (removable && props.onUpdate) props.onUpdate(removable, note());
        setEditing(false);
      };
      // The box starts small so the excerpt has the room, and grows with the note.
      const grow = (element: HTMLTextAreaElement) => {
        element.style.height = "auto";
        element.style.height = `${element.scrollHeight}px`;
      };
      const lines = item.from === item.to ? `:${item.from}` : `:${item.from}-${item.to}`;
      // A comparison comment can span added and removed text, so it says so.
      const diff = item.scope !== "file";
      const parts = () => reviewCommentParts(item);
      return <>
        <Reference icon={diff ? <Icons.FileDiff /> : <Icons.FileCode />} name={item.path.split("/").at(-1) ?? item.path} at={lines} note={item.note || undefined} title={item.excerpt}
          label={diff ? "Comment on a comparison" : "Comment on the working file"} onOpen={props.chatId ? () => requestReviewNavigation(props.chatId!, item) : undefined}
          onEdit={props.onUpdate && removable ? () => { setNote(removable.note); setEditing(true); } : undefined} onRemove={props.onRemove && removable ? () => props.onRemove?.(removable) : undefined} />
        <Show when={props.onUpdate && removable}><Dialog open={editing()} onOpenChange={(open) => {
          if (!open) setNote(item.note);
          setEditing(open);
        }} size="wide" title="Edit review comment" description={`${item.path}${lines}${diff ? " · comparison" : ""}`} close="Close comment editor"
          actions={<>
            <DialogButton variant="ghost" onClick={() => setEditing(false)}>Cancel</DialogButton>
            <DialogButton onClick={commit}>Save comment</DialogButton>
          </>}>
            <CardPreview>
              <Suspense fallback={<CardRead><span>{parts().before}</span><mark>{parts().selected}</mark><span>{parts().after}</span></CardRead>}>
                <WorkspaceExcerptView path={item.path} text={item.excerpt} firstLine={item.from} startColumn={item.startColumn} endColumn={item.endColumn} note={item.note} side={diff ? item.side : undefined} counterpart={item.counterpart} />
              </Suspense>
            </CardPreview>
            <DialogTextArea ref={(element: HTMLTextAreaElement) => queueMicrotask(() => grow(element))} autofocus aria-label={`Comment for ${item.path}`} maxlength={2000} rows={2} value={note()} onInput={(event) => { setNote(event.currentTarget.value); grow(event.currentTarget); }} onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); commit(); }
            }} />
        </Dialog></Show>
      </>;
    }}</For>
  </References></Show>;
}
