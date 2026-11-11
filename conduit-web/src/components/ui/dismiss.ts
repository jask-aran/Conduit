import { createEffect, onCleanup } from "solid-js";

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
