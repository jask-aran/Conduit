import { useEffect, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function ReasoningBlock({
  content = "",
  active = false,
  redacted = false,
  durationSeconds = null,
  className,
}) {
  const [open, setOpen] = useState(active);
  const expandable = Boolean(content) && !redacted;
  const label = active ? "Thinking…" : `Thought for ${durationSeconds ?? 0} s`;

  useEffect(() => {
    setOpen(Boolean(active));
  }, [active]);

  return <div className={cn("reasoning-block my-1", className)}>
    {expandable ? (
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm">
          <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          <span>{label}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="text-muted-foreground mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed">
            {content}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    ) : (
      <div className="text-muted-foreground text-sm">{label}</div>
    )}
  </div>;
}
