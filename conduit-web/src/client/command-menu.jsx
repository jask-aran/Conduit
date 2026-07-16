import {
  CopyIcon, FilePlus2Icon, FolderInputIcon, ListIcon, MessageSquarePlusIcon, PencilIcon,
  PlayIcon, RefreshCwIcon, SettingsIcon, SlidersHorizontalIcon, SquareIcon, Trash2Icon,
} from "lucide-react";
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem,
  CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import { availableCommands } from "./command-registry";

const icons = {
  "new-chat": MessageSquarePlusIcon, attach: FilePlus2Icon, attachments: ListIcon, settings: SettingsIcon,
  model: SlidersHorizontalIcon, rename: PencilIcon, move: FolderInputIcon, stop: SquareIcon,
  regenerate: RefreshCwIcon, continue: PlayIcon, copy: CopyIcon, delete: Trash2Icon,
};

export function CommandMenu({ open, onOpenChange, context, actions }) {
  const available = availableCommands(context);
  const regular = available.filter((command) => !command.destructive);
  const destructive = available.filter((command) => command.destructive);
  const run = (command) => {
    onOpenChange(false);
    requestAnimationFrame(() => command.run(actions));
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
