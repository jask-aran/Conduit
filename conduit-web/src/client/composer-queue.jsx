import { ListEndIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

const MODE_META = {
  steer: {
    label: "steer",
    hint: "After tools, before next model step",
  },
  followUp: {
    label: "follow-up",
    hint: "After this turn finishes",
  },
};

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
      <div className="min-w-0">
        <span className="text-xs font-medium">Queued ({items.length})</span>
        <p className="text-[11px] leading-snug text-muted-foreground/90">
          Follow-up waits for the turn to end. Steer injects after the current tools.
        </p>
      </div>
      {onClear && <Button
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 gap-1 px-2 text-xs"
        title="Pulls queue text into the composer. Pi may still deliver queued messages (no clear_queue RPC)."
        onClick={onClear}
      >
        <Trash2Icon className="size-3" />
        Edit draft
      </Button>}
    </div>
    {items.map((item, index) => {
      const meta = MODE_META[item.mode] || MODE_META.followUp;
      return <div key={`${item.mode}-${index}-${item.prompt.slice(0, 24)}`} className="flex items-center gap-2">
        <ListEndIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={item.prompt}>{item.prompt}</span>
        <span
          className="border-border shrink-0 rounded-full border px-1.5 text-[10px] uppercase"
          title={meta.hint}
        >{meta.label}</span>
      </div>;
    })}
  </div>;
}
