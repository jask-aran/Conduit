import { HeaderNote } from "@/components/ui";

/**
 * Beside the breadcrumb of a subagent's transcript: that it is a subagent's, read-only (it is written by the agent
 * that was handed the task, and answered to the chat that handed it), and its parent, the one place to go from it.
 */
export function SubagentNote(props: { parent: string; onOpenParent?: () => void }) {
  return <HeaderNote label="Subagent" title={`A subagent of ${props.parent}. Its transcript is read-only.`}
    action={props.onOpenParent ? { label: "Parent", onClick: props.onOpenParent, name: `Open ${props.parent}` } : undefined} />;
}
