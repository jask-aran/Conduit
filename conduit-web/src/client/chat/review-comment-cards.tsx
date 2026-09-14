import { createSignal, For, Show } from "solid-js";
import { FileCode2Icon, FileDiffIcon, PencilIcon, XIcon } from "lucide-solid";
import { reviewCommentParts, type ProjectedReviewComment, type ReviewComment } from "./review-comments";
import { Button, Dialog, DialogContent, Textarea } from "@/components/primitives";
import { requestReviewNavigation } from "./review-navigation";

export function ReviewCommentCards(props: {
  items: readonly (ReviewComment | ProjectedReviewComment)[];
  label: string;
  chatId?: string;
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
      // A comparison comment can span added and removed text, so it says so.
      const diff = item.scope !== "file";
      const parts = () => reviewCommentParts(item);
      return <>
        <div class="review-comment-chip" title={item.excerpt}>
          <button type="button" class="review-comment-chip-link" title={diff ? "Comment on a comparison" : "Comment on the working file"} disabled={!props.chatId} onClick={() => props.chatId && requestReviewNavigation(props.chatId, item)}>
            <Show when={diff} fallback={<FileCode2Icon />}><FileDiffIcon /></Show>
            <strong>{item.path.split("/").at(-1)}</strong>
            <span>{lines}</span>
            <Show when={item.note}><span>· {item.note}</span></Show>
          </button>
          <Show when={props.onUpdate && removable}>{(comment) => <Button variant="ghost" size="icon-sm" aria-label={`Edit comment for ${item.path}`} onClick={() => { setNote(comment().note); setEditing(true); }}><PencilIcon /></Button>}</Show>
          <Show when={props.onRemove && removable}>{(comment) => <Button variant="ghost" size="icon-sm" aria-label={`Remove reference to ${item.path}`} onClick={() => props.onRemove?.(comment())}><XIcon /></Button>}</Show>
        </div>
        <Show when={props.onUpdate && removable}><Dialog open={editing()} onOpenChange={(open) => {
          if (!open) setNote(item.note);
          setEditing(open);
        }}>
          <DialogContent class="review-comment-editor" title="Edit review comment" description={`${item.path}${lines}${diff ? " · comparison" : ""}`} closeLabel="Close comment editor">
            <pre class="review-comment-excerpt" aria-label="Commented text"><span>{parts().before}</span><mark>{parts().selected}</mark><span>{parts().after}</span></pre>
            <Textarea autofocus aria-label={`Comment for ${item.path}`} maxlength={2000} rows={10} value={note()} onInput={(event) => setNote(event.currentTarget.value)} onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); commit(); }
            }} />
            <div class="review-comment-editor-actions">
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <Button onClick={commit}>Save comment</Button>
            </div>
          </DialogContent>
        </Dialog></Show>
      </>;
    }}</For>
  </div></Show>;
}
