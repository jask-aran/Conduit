import { type JSX } from "solid-js";
import { cn } from "@/lib/utils";

export type Lift = "rest" | "raised";

export function Frost(props: { lift?: Lift; core?: boolean; class?: string; style?: JSX.CSSProperties; children?: JSX.Element }) {
  return <div class={cn("ui-frost", props.class)} data-surface="frost" data-lift={props.lift ?? "rest"} data-core={props.core ? "" : undefined} style={props.style}>{props.children}</div>;
}
