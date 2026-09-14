import { For, Show } from "solid-js";
import { FileCode2Icon, XIcon } from "lucide-solid";
import type { ProjectedReviewComment, ReviewComment } from "./review-comments";
import { Button } from "@/components/primitives";

export function ReviewCommentCards(props: {
  items: readonly (ReviewComment | ProjectedReviewComment)[];
  label: string;
  onRemove?: (item: ReviewComment) => void;
}) {
  return <Show when={props.items.length}><div class="review-comment-tray" aria-label={props.label}>
    <For each={[...props.items]}>{(item) => {
      const removable = "id" in item ? item : null;
      return <div class="review-comment-chip" title={item.excerpt}>
        <FileCode2Icon />
        <strong>{item.path.split("/").at(-1)}</strong><span>{item.from === item.to ? `:${item.from}` : `:${item.from}-${item.to}`}{item.note ? ` · ${item.note}` : ""}</span>
        <Show when={props.onRemove && removable}>{(comment) => <Button variant="ghost" size="icon-sm" aria-label={`Remove reference to ${item.path}`} onClick={() => props.onRemove?.(comment())}><XIcon /></Button>}</Show>
      </div>;
    }}</For>
  </div></Show>;
}
