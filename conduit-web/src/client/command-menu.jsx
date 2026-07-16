import {
  CopyIcon, FilePlus2Icon, FolderInputIcon, MessageSquarePlusIcon, PencilIcon,
  PlayIcon, RefreshCwIcon, SettingsIcon, SlidersHorizontalIcon, SquareIcon, Trash2Icon,
} from "lucide-react";
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem,
  CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import { availablePaletteCommands } from "./command-registry";
import { groupModels, modelSearchValue } from "./model-options";

const icons = {
  "new-chat": MessageSquarePlusIcon, attach: FilePlus2Icon, settings: SettingsIcon,
  model: SlidersHorizontalIcon, rename: PencilIcon, move: FolderInputIcon, stop: SquareIcon,
  regenerate: RefreshCwIcon, continue: PlayIcon, copy: CopyIcon, delete: Trash2Icon,
};

export function CommandMenu({ open, onOpenChange, context, actions, models, model, onChooseModel }) {
  const available = availablePaletteCommands(context);
  const regular = available.filter((command) => !command.destructive);
  const destructive = available.filter((command) => command.destructive);
  const run = (command) => {
    onOpenChange(false);
    requestAnimationFrame(() => command.run(actions));
  };
  const chooseModel = (spec) => {
    onOpenChange(false);
    requestAnimationFrame(() => onChooseModel(spec));
  };
  return <CommandDialog open={open} onOpenChange={onOpenChange}>
    <Command loop>
      <CommandInput placeholder="Search commands…" autoFocus />
      <CommandList>
        <CommandEmpty>No matching commands.</CommandEmpty>
        <CommandGroup heading="Commands">
          {regular.map((command) => {
            const Icon = icons[command.icon];
            return <CommandItem key={command.id} value={command.id} keywords={[command.label, ...command.keywords]} onSelect={() => run(command)}>
              {Icon && <Icon />}{command.label}{command.shortcut && <CommandShortcut>{command.shortcut}</CommandShortcut>}
            </CommandItem>;
          })}
        </CommandGroup>
        {models.length > 0 && <>
          <CommandSeparator />
          {groupModels(models).map((group) => <CommandGroup key={group.provider} heading={`Models · ${group.provider}`}>
            {group.items.map((item) => <CommandItem
              key={item.spec}
              value={`model ${modelSearchValue(item)}`}
              data-checked={item.spec === model}
              onSelect={() => chooseModel(item.spec)}
            >
              <SlidersHorizontalIcon />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{item.label}</span>
                <span className="truncate text-xs text-muted-foreground">{item.spec}</span>
              </span>
            </CommandItem>)}
          </CommandGroup>)}
        </>}
        {destructive.length > 0 && <><CommandSeparator /><CommandGroup heading="Danger zone">
          {destructive.map((command) => {
            const Icon = icons[command.icon];
            return <CommandItem key={command.id} value={command.id} keywords={[command.label, ...command.keywords]} onSelect={() => run(command)}>
              {Icon && <Icon />}{command.label}
            </CommandItem>;
          })}
        </CommandGroup></>}
      </CommandList>
    </Command>
  </CommandDialog>;
}
