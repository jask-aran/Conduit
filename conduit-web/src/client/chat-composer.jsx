import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpIcon, ChevronDownIcon, PaperclipIcon, SquareIcon, WaypointsIcon } from "lucide-react";
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
import { ButtonGroup } from "@/components/ui/button-group";
import { Popover, PopoverAnchor } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { ContextDisplay } from "@/components/assistant-ui/context-display";
import { AttachmentTray } from "./attachment-tray";
import { availableComposerCommands } from "./command-registry";
import { ComposerQueue } from "./composer-queue";
import { thinkingLabel } from "./model-options";
import { SlashSuggestions } from "./slash-suggestions";
import { detectCommandToken, replaceCommandToken } from "./slash-token";

const list = (value) => Array.isArray(value) ? value : [];

export function ChatComposer({
  draft,
  generation = "idle",
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
  contextUsage = null,
  compacting = false,
  queue = null,
  serverOnline = true,
  onDraftChange,
  onChooseModel,
  onChooseEffort,
  onSend,
  onStop,
  onClearQueue,
  onSteer,
}) {
  const textarea = useRef(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const selectedModel = models.find((item) => item.spec === model);
  const thinkingLevels = list(selectedModel?.thinkingLevels);
  const modelLabel = selectedModel?.label || model.split("/").pop() || "Select model";
  const busy = streaming || generation === "active" || generation === "submitting";
  const isStopping = stopping || generation === "stopping";
  const hasText = Boolean(draft.trim());
  const canQueue = serverOnline && !isStopping && busy && hasText;
  const canSendIdle = serverOnline && !isStopping && !busy && hasText;
  const canStop = serverOnline && (busy || isStopping);
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

  const primaryLabel = isStopping
    ? "Stopping response"
    : canQueue
      ? "Queue follow-up"
      : canSendIdle
        ? "Send message"
        : canStop
          ? "Stop response"
          : "Send message";

  return <div className="composer-wrap">
    <AttachmentTray attachments={attachments} chatId={chatId} />
    <ComposerQueue queue={queue} onClear={onClearQueue} />
    <InputGroup className="composer has-disabled:bg-secondary has-disabled:opacity-100">
      <Popover open={suggestionsOpen} modal={false}>
        <PopoverAnchor asChild>
          <InputGroupTextarea
            ref={textarea}
            rows={1}
            value={draft}
            disabled={!serverOnline}
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
              if (event.key === "Enter" && event.shiftKey && (event.metaKey || event.ctrlKey)) {
                if (canQueue && onSteer) {
                  event.preventDefault();
                  onSteer();
                }
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (isStopping) return;
                if (hasText && (canQueue || canSendIdle)) onSend();
                else if (canStop && onStop) onStop();
              }
            }}
            placeholder={serverOnline
              ? (busy ? "Queue a follow-up, or Steer after tools…" : "Send a message...")
              : "Server unavailable"}
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
            disabled={!serverOnline}
          ><PaperclipIcon /></InputGroupButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton variant="ghost" size="sm" aria-label={`${modelLabel} ${effort || "off"}`} disabled={!serverOnline}>
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
        <div className="composer-actions-right flex items-center gap-1">
          <ContextDisplay.Ring
            modelContextWindow={contextUsage?.contextWindow}
            usage={contextUsage}
            compacting={compacting}
          />
          <ButtonGroup className="items-center">
            {canStop && <InputGroupButton
              variant={hasText && busy ? "outline" : "default"}
              size="icon-sm"
              disabled={!canStop}
              onClick={() => onStop?.()}
              aria-label="Stop response"
              title="Stop response (abort only)"
            >
              {isStopping
                ? <Spinner className="size-4" />
                : <span className="relative inline-flex">
                    {(generation === "active" || streaming) && <Spinner className="absolute inset-0 size-4 opacity-40" />}
                    <SquareIcon className="relative" />
                  </span>}
            </InputGroupButton>}
            {canQueue && <InputGroupButton
              variant="outline"
              size="icon-sm"
              onClick={() => onSteer?.()}
              aria-label="Steer after tools"
              title="Steer: inject after current tools (Ctrl/Cmd+Shift+Enter)"
            >
              <WaypointsIcon />
            </InputGroupButton>}
            <InputGroupButton
              variant="default"
              size="icon-sm"
              disabled={!(canQueue || canSendIdle) || isStopping}
              onClick={() => {
                if (isStopping) return;
                if (canQueue || canSendIdle) onSend();
              }}
              aria-label={primaryLabel}
              title={primaryLabel}
            >
              {generation === "submitting"
                ? <Spinner className="size-4" />
                : <ArrowUpIcon />}
            </InputGroupButton>
          </ButtonGroup>
        </div>
      </InputGroupAddon>
    </InputGroup>
  </div>;
}
