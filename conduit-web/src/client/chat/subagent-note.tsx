import { Notice } from "@/components/ui";

export function SubagentNote(props: { parent: string; onOpenParent?: () => void }) {
  return <Notice kind="capsule" hint="Only the chat that started a subagent can message it."
    action={props.onOpenParent ? { label: "Open parent", onClick: props.onOpenParent, name: `Open ${props.parent}` } : undefined}>Read-only · a subagent of {props.parent}</Notice>;
}
