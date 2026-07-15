import {
  ArrowUpIcon,
  ChevronDownIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
} from "lucide-react";
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
  InputGroupInput,
} from "@/components/ui/input-group";

const list = (value) => Array.isArray(value) ? value : [];
const thinkingLabel = (level) => level === "xhigh" ? "XHigh" : `${level[0]?.toUpperCase() || ""}${level.slice(1)}`;

export function ChatComposer({
  draft,
  streaming,
  models,
  model,
  effort,
  modelNotice,
  onDraftChange,
  onChooseModel,
  onChooseEffort,
  onSend,
}) {
  const selectedModel = models.find((item) => item.spec === model);
  const thinkingLevels = list(selectedModel?.thinkingLevels);
  const modelLabel = selectedModel?.label || model.split("/").pop() || "Select model";
  const canSend = Boolean(draft.trim() || streaming);

  return <div className="composer-wrap">
    <InputGroup className="composer">
      <InputGroupInput
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
        placeholder="Send a message..."
        aria-label="Message Pi"
      />
      <InputGroupAddon align="inline-start">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <InputGroupButton size="icon-sm" aria-label="Add to message">
              <PlusIcon />
            </InputGroupButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuItem disabled>
                <PaperclipIcon />
                Attach files
                <span className="ml-auto text-xs text-muted-foreground">Soon</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </InputGroupAddon>
      <InputGroupAddon align="inline-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <InputGroupButton variant="outline" size="sm" aria-label={`${modelLabel} ${effort || "off"}`}>
              <span className="max-w-24 truncate sm:max-w-36">{modelLabel}</span>
              <span className="hidden text-muted-foreground sm:inline">{effort || "off"}</span>
              <ChevronDownIcon data-icon="inline-end" />
            </InputGroupButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-72">
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
                {thinkingLevels.map((level) => <DropdownMenuRadioItem key={level} value={level}>
                  {thinkingLabel(level)}
                </DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <InputGroupButton
          variant="default"
          size="icon-sm"
          aria-disabled={!canSend}
          onClick={() => canSend && onSend()}
          aria-label={streaming ? "Stop response" : "Send message"}
        >
          {streaming ? <SquareIcon /> : <ArrowUpIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>;
}
