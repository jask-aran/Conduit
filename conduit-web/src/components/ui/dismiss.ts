import { createEffect, onCleanup } from "solid-js";

/**
 * createDismiss: how an open piece is put away from outside it, one way for every panel and bar. While open(), Esc
 * closes it (in the capture phase, ahead of the app's own Escape, and only if nothing has taken the key); with
 * `inside`, so does a press anywhere outside the nodes it gives (its own, and what it keeps live: the composer under a
 * Ledge). A piece with its own rungs of the Escape ladder passes onEscape instead of closing at once.
 */
export function createDismiss(props: {
  open: () => boolean;
  onClose: () => void;
  onEscape?: () => void;
  inside?: () => readonly (Node | null | undefined)[];
}) {
  createEffect(() => {
    if (!props.open()) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      (props.onEscape ?? props.onClose)();
    };
    const press = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || props.inside!().some((node) => node?.contains(target))) return;
      props.onClose();
    };
    window.addEventListener("keydown", key, true);
    if (props.inside) window.addEventListener("pointerdown", press, true);
    onCleanup(() => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", press, true);
    });
  });
}
