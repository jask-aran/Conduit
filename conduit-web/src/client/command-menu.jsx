import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon, BrainIcon, CopyIcon, FilePlus2Icon, FolderInputIcon, FolderPlusIcon,
  LayersIcon, MessageSquareIcon, MessageSquarePlusIcon, PanelLeftIcon, PencilIcon,
  PlayIcon, RefreshCwIcon, SettingsIcon, SlidersHorizontalIcon, SquareIcon,
  Trash2Icon,
} from "lucide-react";
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem,
  CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import { useSidebar } from "@/components/ui/sidebar";
import {
  groupPaletteCommands, PALETTE_PAGES, resolvePaletteCommands,
} from "./command-registry";
import { groupModels } from "./model-options";
import { rankPaletteResults } from "./palette-search";

const icons = {
  "new-chat": MessageSquarePlusIcon,
  "new-folder": FolderPlusIcon,
  attach: FilePlus2Icon,
  settings: SettingsIcon,
  model: SlidersHorizontalIcon,
  profile: LayersIcon,
  rename: PencilIcon,
  move: FolderInputIcon,
  stop: SquareIcon,
  regenerate: RefreshCwIcon,
  continue: PlayIcon,
  copy: CopyIcon,
  "copy-transcript": CopyIcon,
  delete: Trash2Icon,
  sidebar: PanelLeftIcon,
  chat: MessageSquareIcon,
  thinking: BrainIcon,
  retry: RefreshCwIcon,
  reload: RefreshCwIcon,
  back: ArrowLeftIcon,
};

const GROUP_HEADINGS = {
  commands: "Commands",
  settings: "Settings",
  navigation: "Go to",
  profiles: "Profiles",
  thinking: "Thinking level",
  danger: "Danger zone",
  models: "Models",
};

function CommandRow({ command, onRun }) {
  const Icon = icons[command.icon];
  return <CommandItem
    value={command.id}
    data-checked={command.checked || undefined}
    onSelect={() => onRun(command)}
  >
    {Icon && <Icon />}
    {command.detail
      ? <span className="flex min-w-0 flex-col">
        <span className="truncate">{command.label}</span>
        <span className="truncate text-xs text-muted-foreground">{command.detail}</span>
      </span>
      : command.label}
    {command.shortcut && <CommandShortcut>{command.shortcut}</CommandShortcut>}
  </CommandItem>;
}

function ModelRow({ item, checked, onChoose }) {
  return <CommandItem
    value={item.spec}
    data-checked={checked || undefined}
    onSelect={() => onChoose(item.spec)}
  >
    <SlidersHorizontalIcon />
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{item.label}</span>
      <span className="truncate text-xs text-muted-foreground">{item.spec}</span>
    </span>
  </CommandItem>;
}

function RankedRow({ row, currentModel, onRun, onChooseModel }) {
  if (row.kind === "model") {
    return <ModelRow
      item={row.model}
      checked={row.model.spec === currentModel}
      onChoose={onChooseModel}
    />;
  }
  return <CommandRow command={row.command} onRun={onRun} />;
}

/** Group ranked rows only for section labels; order stays score-global. */
function clusterRanked(rows) {
  const clusters = [];
  for (const row of rows) {
    const last = clusters[clusters.length - 1];
    if (last && last.group === row.group) last.items.push(row);
    else clusters.push({ group: row.group, heading: GROUP_HEADINGS[row.group] || row.group, items: [row] });
  }
  return clusters;
}

export function CommandMenu({
  open,
  onOpenChange,
  initialPage = null,
  launchNonce = 0,
  context,
  actions,
  models,
  model,
  onChooseModel,
}) {
  const { toggleSidebar } = useSidebar();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(initialPage);
  const pageMeta = page ? PALETTE_PAGES[page] : null;
  const searching = Boolean(query.trim());

  useEffect(() => {
    if (!open) {
      setQuery("");
      setPage(null);
      return;
    }
    setPage(initialPage || null);
    setQuery("");
  }, [open, initialPage, launchNonce]);

  const commands = useMemo(
    () => resolvePaletteCommands(context, { page }),
    [context, page],
  );
  const browseGroups = useMemo(() => groupPaletteCommands(commands), [commands]);
  const ranked = useMemo(
    () => rankPaletteResults({ commands, models: page ? [] : models, query, currentModel: model }),
    [commands, models, query, model, page],
  );

  const boundActions = {
    ...actions,
    toggleSidebar: actions.toggleSidebar || toggleSidebar,
  };

  const goBack = () => {
    setPage(null);
    setQuery("");
  };

  const close = () => {
    setQuery("");
    setPage(null);
    onOpenChange(false);
  };

  const run = (command) => {
    if (command.kind === "page" && command.page) {
      setPage(command.page);
      setQuery("");
      return;
    }
    if (command.kind === "back") {
      goBack();
      return;
    }
    close();
    requestAnimationFrame(() => command.run(boundActions));
  };

  const chooseModel = (spec) => {
    close();
    requestAnimationFrame(() => onChooseModel(spec));
  };

  const backCommand = {
    id: "page-back",
    kind: "back",
    label: "Back",
    icon: "back",
    group: "commands",
  };

  const placeholder = pageMeta
    ? ""
    : "Search commands…";

  const showBrowse = !searching;
  const showRanked = searching;

  return <CommandDialog open={open} onOpenChange={(next) => {
    // Escape on a page steps back instead of closing the palette.
    if (!next && page) {
      goBack();
      return;
    }
    if (!next) {
      setQuery("");
      setPage(null);
    }
    onOpenChange(next);
  }}>
    <Command
      shouldFilter={false}
      loop
      vimBindings={false}
      onKeyDown={(event) => {
        if (event.key === "Backspace" && page && !query) {
          event.preventDefault();
          goBack();
        }
      }}
    >
      <CommandInput
        prefix={pageMeta?.prefix || undefined}
        placeholder={placeholder}
        autoFocus
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[36rem]">
        <CommandEmpty>No matching commands.</CommandEmpty>
        {page && !searching && <CommandGroup>
          <CommandRow command={backCommand} onRun={run} />
        </CommandGroup>}
        {showRanked ? clusterRanked(ranked || []).map((cluster, index) => <Fragment key={`${cluster.group}-${index}`}>
          {(index > 0 || (page && !searching)) && <CommandSeparator />}
          <CommandGroup heading={cluster.heading}>
            {cluster.items.map((row) => <RankedRow
              key={row.id}
              row={row}
              currentModel={model}
              onRun={run}
              onChooseModel={chooseModel}
            />)}
          </CommandGroup>
        </Fragment>) : null}
        {showBrowse && !page ? <>
          {browseGroups.map((group, index) => <Fragment key={group.id}>
            {index > 0 && <CommandSeparator />}
            <CommandGroup heading={group.heading}>
              {group.items.map((command) => <CommandRow key={command.id} command={command} onRun={run} />)}
            </CommandGroup>
          </Fragment>)}
          {models.length > 0 && <>
            <CommandSeparator />
            {groupModels(models).map((group) => <CommandGroup key={group.provider} heading={`Models · ${group.provider}`}>
              {group.items.map((item) => <ModelRow
                key={item.spec}
                item={item}
                checked={item.spec === model}
                onChoose={chooseModel}
              />)}
            </CommandGroup>)}
          </>}
        </> : null}
        {showBrowse && page ? <>
          <CommandSeparator />
          <CommandGroup heading={pageMeta?.heading || "Results"}>
            {commands.map((command) => <CommandRow key={command.id} command={command} onRun={run} />)}
          </CommandGroup>
        </> : null}
      </CommandList>
    </Command>
  </CommandDialog>;
}
