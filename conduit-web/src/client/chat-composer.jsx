import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpIcon, ChevronDownIcon, PaperclipIcon, SquareIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Popover, PopoverAnchor } from "@/components/ui/popover";
import { AttachmentTray } from "./attachment-tray";
import { availableComposerCommands } from "./command-registry";
import { thinkingLabel } from "./model-options";
import { SlashSuggestions } from "./slash-suggestions";
import { detectCommandToken, replaceCommandToken } from "./slash-token";

const list = (value) => Array.isArray(value) ? value : [];
export function ChatComposer({
  draft,
  streaming,
  stopping,
  models,
  model,
  effort,
  modelNotice,
  attachments,
  chatId,
  commandContext,
  commandActions,
  onDraftChange,
  onChooseModel,
  onChooseEffort,
  onSend,
}) {
  const textarea = useRef(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const selectedModel = models.find((item) => item.spec === model);
  const thinkingLevels = list(selectedModel?.thinkingLevels);
  const modelLabel = selectedModel?.label || model.split("/").pop() || "Select model";
  const canSend = !stopping && Boolean(draft.trim() || streaming);
  const token = detectCommandToken(draft, caret);
  const slashCommands = useMemo(() => {
    if (token?.trigger !== "/") return [];
    const query = token.query.toLowerCase();
    return availableComposerCommands(commandContext).filter((command) =>
      !query || command.slash.startsWith(query) || command.label.toLowerCase().includes(query)
        || command.keywords.some((keyword) => keyword.includes(query)));
  }, [commandContext, token?.query, token?.trigger]);
  const suggestionsOpen = !dismissed && token?.trigger === "/" && slashCommands.length > 0;

  useLayoutEffect(() => {
    const control = textarea.current;
    if (!control) return;
    control.style.height = "0px";
    control.style.height = `${Math.min(control.scrollHeight, 192)}px`;
  }, [draft]);
  useEffect(() => { setActiveIndex(0); setDismissed(false); }, [token?.query, token?.trigger]);

  const chooseSlash = (command) => {
    if (!token) return;
    const next = replaceCommandToken(draft, token);
    onDraftChange(next);
    setDismissed(true);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(token.start, token.start);
      command.run(commandActions);
    });
  };

  return <div className="composer-wrap">
    <AttachmentTray attachments={attachments} chatId={chatId} />
    <InputGroup className="composer has-disabled:bg-secondary has-disabled:opacity-100">
      <Popover open={suggestionsOpen} modal={false}>
        <PopoverAnchor asChild>
          <InputGroupTextarea
            ref={textarea}
            rows={1}
            value={draft}
            onChange={(event) => {
              onDraftChange(event.target.value);
              setCaret(event.target.selectionStart ?? event.target.value.length);
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (suggestionsOpen && ["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault();
                setActiveIndex((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + slashCommands.length) % slashCommands.length);
                return;
              }
              if (suggestionsOpen && ["Enter", "Tab"].includes(event.key)) {
                event.preventDefault();
                chooseSlash(slashCommands[activeIndex]);
                return;
              }
              if (suggestionsOpen && event.key === "Escape") {
                event.preventDefault();
                setDismissed(true);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder="Send a message..."
            aria-label="Message Pi"
            aria-controls={suggestionsOpen ? "slash-command-list" : undefined}
            aria-expanded={suggestionsOpen}
            aria-activedescendant={suggestionsOpen ? `slash-command-${slashCommands[activeIndex]?.id}` : undefined}
          />
        </PopoverAnchor>
        {suggestionsOpen && <SlashSuggestions commands={slashCommands} activeIndex={activeIndex} onSelect={chooseSlash} />}
      </Popover>
      <InputGroupAddon align="block-end" className="composer-actions">
        <div className="composer-actions-left">
          <InputGroupButton
            size="icon-sm"
            aria-label={`Attach files${attachments.items.length ? ` (${attachments.items.length})` : ""}`}
            onClick={() => attachments.inputRef.current?.click()}
          ><PaperclipIcon /></InputGroupButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton variant="ghost" size="sm" aria-label={`${modelLabel} ${effort || "off"}`}>
                <span className="max-w-24 truncate sm:max-w-36">{modelLabel}</span>
                <span className="hidden text-muted-foreground sm:inline">{effort || "off"}</span>
                <ChevronDownIcon data-icon="inline-end" />
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-72">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Model</DropdownMenuLabel>
                {modelNotice && <div className="px-1.5 pb-2 text-xs text-muted-foreground">{modelNotice}</div>}
                <DropdownMenuRadioGroup value={model} onValueChange={onChooseModel}>
                  {models.map((item) => <DropdownMenuRadioItem key={item.spec} value={item.spec} onSelect={(event) => event.preventDefault()}>
                    <span className="truncate">{item.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{item.provider}</span>
                  </DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Thinking</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={effort} onValueChange={onChooseEffort}>
                  {thinkingLevels.map((level) => <DropdownMenuRadioItem key={level} value={level}>{thinkingLabel(level)}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => requestAnimationFrame(commandActions.model)}>Manage models…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <InputGroupButton
          variant="default"
          size="icon-sm"
          disabled={!canSend}
          onClick={onSend}
          aria-label={stopping ? "Stopping response" : streaming ? "Stop response" : "Send message"}
        >
          {streaming ? <SquareIcon /> : <ArrowUpIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>;
}
