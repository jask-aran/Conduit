import { FilePlus2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";

export function SlashSuggestions({ commands, activeIndex, onSelect }) {
  return <PopoverContent
    side="top"
    align="start"
    className="slash-suggestions"
    onOpenAutoFocus={(event) => event.preventDefault()}
  >
    <div
      id="slash-command-list"
      role="listbox"
      aria-label="Suggestions"
      data-slot="composer-trigger-popover-items"
      className="flex flex-col py-1"
    >
      {commands.map((command, index) => <Button
        key={command.id}
        id={`slash-command-${command.id}`}
        type="button"
        role="option"
        variant="ghost"
        aria-selected={index === activeIndex}
        data-highlighted={index === activeIndex ? "" : undefined}
        className="h-auto w-full justify-start rounded-none px-3 py-2 text-start data-[highlighted]:bg-accent"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => onSelect(command)}
      >
        <FilePlus2Icon />
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <span className="font-medium">/{command.slash}</span>
          <span className="text-xs leading-tight text-muted-foreground">{command.description}</span>
        </span>
      </Button>)}
    </div>
  </PopoverContent>;
}
