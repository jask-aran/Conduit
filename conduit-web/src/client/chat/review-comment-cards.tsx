import { createSignal, For, Show } from "solid-js";
import { FileCode2Icon, PencilIcon, XIcon } from "lucide-solid";
import type { ProjectedReviewComment, ReviewComment } from "./review-comments";
import { Button, Dialog, DialogContent, Textarea } from "@/components/primitives";

export function ReviewCommentCards(props: {
  items: readonly (ReviewComment | ProjectedReviewComment)[];
  label: string;
  onRemove?: (item: ReviewComment) => void;
  onUpdate?: (item: ReviewComment, note: string) => void;
}) {
  return <Show when={props.items.length}><div class="review-comment-tray" aria-label={props.label}>
    <For each={[...props.items]}>{(item) => {
      const removable = "id" in item ? item : null;
      const [editing, setEditing] = createSignal(false);
      const [note, setNote] = createSignal(item.note);
      const commit = () => {
        if (removable && props.onUpdate) props.onUpdate(removable, note());
        setEditing(false);
      };
      const lines = item.from === item.to ? `:${item.from}` : `:${item.from}-${item.to}`;
      return <>
        <div class="review-comment-chip" title={item.excerpt}>
          <FileCode2Icon />
          <strong>{item.path.split("/").at(-1)}</strong>
          <span>{lines}</span>
          <Show when={item.note}><span>· {item.note}</span></Show>
          <Show when={props.onUpdate && removable}>{(comment) => <Button variant="ghost" size="icon-sm" aria-label={`Edit comment for ${item.path}`} onClick={() => { setNote(comment().note); setEditing(true); }}><PencilIcon /></Button>}</Show>
          <Show when={props.onRemove && removable}>{(comment) => <Button variant="ghost" size="icon-sm" aria-label={`Remove reference to ${item.path}`} onClick={() => props.onRemove?.(comment())}><XIcon /></Button>}</Show>
        </div>
        <Show when={props.onUpdate && removable}>{() => <Dialog open={editing()} onOpenChange={(open) => {
          if (!open) setNote(item.note);
          setEditing(open);
        }}>
          <DialogContent class="review-comment-editor" title="Edit review comment" description={`${item.path}${lines}`} closeLabel="Close comment editor">
            <Textarea autofocus aria-label={`Comment for ${item.path}`} maxlength={2000} rows={10} value={note()} onInput={(event) => setNote(event.currentTarget.value)} onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); commit(); }
            }} />
            <div class="review-comment-editor-actions">
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <Button onClick={commit}>Save comment</Button>
            </div>
          </DialogContent>
        </Dialog>}</Show>
      </>;
    }}</For>
  </div></Show>;
}
