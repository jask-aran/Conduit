import { splitProps, type JSX } from "solid-js";
import { createComposerSurfaceSignal } from "../chat/composer-surface";
import { useLibrary } from "@/components/ui/swap";
import { isMobileLayout } from "./mobile-layout";

/* On a phone the header's two control groups are pills of the composer's own
   material, floating over the transcript like the composer below.
   In the gallery's Library previews every such pill is the library's Pill
   (components/ui/swap.ts): a circle round one button, a capsule round more. */
export function headerPill(buttons = 2) {
  const surface = createComposerSurfaceSignal();
  const lib = useLibrary();
  return (): { class?: string; "data-composer-surface"?: string; "data-surface"?: string; "data-solo"?: string } => !isMobileLayout() ? {}
    : lib ? { class: "ui-frost ui-pill", "data-surface": "frost", "data-solo": buttons === 1 ? "" : undefined }
    : { class: "composer-surface-material", "data-composer-surface": surface() };
}
/** The pill's attributes on its element. */
export function PillShell(props: { pill: ReturnType<typeof headerPill>; class: string; children: JSX.Element } & JSX.HTMLAttributes<HTMLDivElement>) {
  const [own, rest] = splitProps(props, ["pill", "class", "children"]);
  return <div {...rest} class={`${own.class} ${own.pill().class ?? ""}`} data-composer-surface={own.pill()["data-composer-surface"]}
    data-surface={own.pill()["data-surface"]} data-solo={own.pill()["data-solo"]}>{own.children}</div>;
}

export function HeaderActions(props: { children: JSX.Element }) {
  return <PillShell pill={headerPill(3)} class="chat-header-actions">{props.children}</PillShell>;
}
