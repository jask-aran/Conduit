import type { JSX } from "solid-js";
import { createComposerSurfaceSignal } from "../chat/composer-surface";
import { isMobileLayout } from "./mobile-layout";

/* On a phone the header's two control groups are pills of the composer's own
   material, floating over the transcript like the composer below. */
export function headerPill() {
  const surface = createComposerSurfaceSignal();
  return () => isMobileLayout() ? { class: "composer-surface-material", "data-composer-surface": surface() } : {};
}

export function HeaderActions(props: { children: JSX.Element }) {
  const pill = headerPill();
  return <div class={`chat-header-actions ${pill().class ?? ""}`} data-composer-surface={pill()["data-composer-surface"]}>
    {props.children}
  </div>;
}
