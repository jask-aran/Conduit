import { ListEndIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ComposerQueue({ queue, onClear }) {
  const steering = queue?.steering || [];
  const followUp = queue?.followUp || [];
  const items = [
    ...steering.map((prompt) => ({ prompt, mode: "steer" })),
    ...followUp.map((prompt) => ({ prompt, mode: "followUp" })),
  ];
  if (!items.length) return null;

  return <div className="composer-queue bg-muted/50 border-border/60 text-muted-foreground mb-0 flex flex-col gap-1.5 rounded-t-xl border border-b-0 px-4 pt-2.5 pb-3 text-sm">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium">Queued ({items.length})</span>
      {onClear && <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={onClear}>
        <Trash2Icon className="size-3" />
        Clear
      </Button>}
    </div>
    {items.map((item, index) => (
      <div key={`${item.mode}-${index}`} className="flex items-center gap-2">
        <ListEndIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.prompt}</span>
        {item.mode === "steer" && <span className="border-border rounded-full border px-1.5 text-[10px] uppercase">steer</span>}
      </div>
    ))}
  </div>;
}
