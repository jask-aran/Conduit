import { FilePlus2Icon, ListIcon, PlayIcon, RefreshCwIcon, SettingsIcon, SlidersHorizontalIcon, SquareIcon, CopyIcon } from "lucide-react";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { PopoverContent } from "@/components/ui/popover";

const icons = {
  attach: FilePlus2Icon, attachments: ListIcon, settings: SettingsIcon, model: SlidersHorizontalIcon,
  stop: SquareIcon, regenerate: RefreshCwIcon, continue: PlayIcon, copy: CopyIcon,
};

export function SlashSuggestions({ commands, activeIndex, onSelect }) {
  return <PopoverContent
    id="slash-command-list"
    role="listbox"
    side="top"
    align="start"
    className="slash-suggestions"
    onOpenAutoFocus={(event) => event.preventDefault()}
  >
    <ItemGroup role="presentation">
      {commands.map((command, index) => {
        const Icon = icons[command.icon];
        return <Item
          key={command.id}
          id={`slash-command-${command.id}`}
          role="option"
          aria-selected={index === activeIndex}
          data-active={index === activeIndex ? "true" : undefined}
          size="sm"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onSelect(command)}
        >
          <ItemMedia variant="icon">{Icon && <Icon />}</ItemMedia>
          <ItemContent><ItemTitle>/{command.slash}</ItemTitle><ItemDescription>{command.description}</ItemDescription></ItemContent>
        </Item>;
      })}
    </ItemGroup>
  </PopoverContent>;
}
