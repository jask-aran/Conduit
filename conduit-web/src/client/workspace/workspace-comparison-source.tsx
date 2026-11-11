import { Icons, IconButton } from "@/components/ui";
import { StatusText, StatusPicker } from "@/components/ui/file";
import { ComparisonSource, TurnNavigation } from "@/components/ui/editor";
import { For, Show } from "solid-js";

import { DropdownMenu, MenuContent, MenuRow, MenuRadioGroup, MenuRadioItem, MenuControl } from "@/components/ui/menus";
import { Spinner } from "@/components/ui/controls";
import { createWorkspaceReview, diffScopes, isDiffScope, type DiffScope } from "./workspace-review-source";

export type ReviewOpener = (scope: DiffScope, path?: string, checkpoint?: string | null) => void;
export type WorkspaceReviewController = ReturnType<typeof createWorkspaceReview>;

// Times alone read as out of order once the list crosses midnight.
const turnTime = (value: string) => {
  const moment = new Date(value);
  const time = moment.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return moment.toDateString() === new Date().toDateString() ? time : `${moment.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
};

/** Source Control and Chat review each pass their own review and scopes, so the two never share a selection. */
export function ComparisonSourceControls(props: { source: WorkspaceReviewController; open: ReviewOpener; scopes: typeof diffScopes; chatAvailable: boolean }) {
  const source = () => props.source;
  return <ComparisonSource>
    <DropdownMenu>
      <MenuControl as={StatusPicker} icon={<Icons.ChevronDown />} aria-label="Comparison source">{diffScopes.find((scope) => scope.value === source().scope())?.label}</MenuControl>
      <MenuContent>
        <MenuRadioGroup value={source().scope()} onChange={(value) => { if (isDiffScope(value) && props.scopes.some((scope) => scope.value === value)) props.open(value); }}>
          <For each={props.scopes}>{(scope) => <MenuRadioItem value={scope.value} disabled={(scope.value === "chat" || scope.value === "turn") && !props.chatAvailable}>{scope.label}</MenuRadioItem>}</For>
        </MenuRadioGroup>
      </MenuContent>
    </DropdownMenu>
    <Show when={source().scope() === "chat" || source().scope() === "turn"}>
      <TurnNavigation aria-label="Turn navigation">
        <IconButton kind="file" aria-label="Older turn" title="Older turn" disabled={source().loading() || source().turnIndex() >= source().timeline().length - 1} onClick={() => void source().stepTurn(1, source().turnIndex() + 1)}><Icons.ChevronLeft /></IconButton>
        <DropdownMenu>
          <MenuControl as={StatusPicker} icon={<Icons.ChevronDown />} aria-label="Select turn">{source().timeline().length ? `${source().scope() === "chat" ? "Through turn" : "Turn"} ${source().turnNumber(source().turnIndex())}` : "Latest turn"}</MenuControl>
          <MenuContent><For each={source().timeline()}>{(turn, index) => <MenuRow onSelect={() => void source().stepTurn(1, index())}>{`${source().scope() === "chat" ? "Through turn" : "Turn"} ${source().turnNumber(index())}`} · {turnTime(turn.createdAt)}</MenuRow>}</For></MenuContent>
        </DropdownMenu>
        <IconButton kind="file" aria-label="Newer turn" title="Newer turn" disabled={source().loading() || source().turnIndex() <= 0} onClick={() => void source().stepTurn(-1, source().turnIndex() - 1)}><Icons.ChevronRight /></IconButton>
      </TurnNavigation>
    </Show>
    <StatusText><span title="Comparison endpoints">{source().rangeLabel()}</span></StatusText>
    <Show when={source().loading()}><Spinner /></Show>
    <Show when={source().error()}><IconButton kind="file" wide title={source().error()} onClick={() => props.open(source().scope(), undefined, source().checkpointId())}>Retry</IconButton></Show>
  </ComparisonSource>;
}
