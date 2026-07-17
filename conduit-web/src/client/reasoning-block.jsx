import { useEffect, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function ReasoningBlock({ content = "", redacted = false, active = false, className }) {
  const [open, setOpen] = useState(active);

  useEffect(() => {
    if (active) setOpen(true);
    else setOpen(false);
  }, [active]);

  if (redacted) {
    return <div className={cn("reasoning-block text-muted-foreground my-1 text-sm italic", className)}>
      Reasoning redacted
    </div>;
  }

  if (!content && !active) return null;

  return <Collapsible open={open} onOpenChange={setOpen} className={cn("reasoning-block my-1", className)}>
    <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm">
      <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      <span>{active ? "Thinking…" : "Thought process"}</span>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <pre className="text-muted-foreground mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed">
        {content || (active ? "…" : "")}
      </pre>
    </CollapsibleContent>
  </Collapsible>;
}
