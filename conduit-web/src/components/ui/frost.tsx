import { splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "@/lib/utils";

export type Lift = "rest" | "raised";

/** "on-frost": no material of its own, but marked as on frost, for a frost host that takes classes and not attributes
 *  (a toast in Sonner's frame). */
// Its attributes are any element's (a button's included), typed loosely so a caller's own element's props pass through.
export function Frost(props: JSX.ButtonHTMLAttributes<any> & { as?: "div" | "span" | "p" | "button" | "section"; lift?: Lift; core?: boolean; plain?: boolean | "on-frost" }) {
  const [local, rest] = splitProps(props, ["as", "lift", "core", "plain", "class"]);
  return <Dynamic component={local.as ?? "div"} {...rest} class={local.plain ? local.class : cn("ui-frost", local.class)} data-surface={local.plain === true ? undefined : "frost"}
    data-lift={local.plain ? undefined : local.lift ?? "rest"} data-core={!local.plain && local.core ? "" : undefined} />;
}
