import { Notice } from "@/components/ui";

/**
 * Where a subagent's composer would be: that its transcript is read-only (it is written by the agent that was handed
 * the task, and answered to the chat that handed it), whose it is, and the way to that parent.
 */
export function SubagentNote(props: { parent: string; onOpenParent?: () => void }) {
  return <Notice kind="capsule" hint="Only the chat that started a subagent can message it."
    action={props.onOpenParent ? { label: "Open parent", onClick: props.onOpenParent, name: `Open ${props.parent}` } : undefined}>Read-only · a subagent of {props.parent}</Notice>;
}
