import { Icons } from "@/components/ui";
import { FileButton, StatusText, StatusPicker } from "@/components/ui/file";
import { ComparisonSource, TurnNavigation } from "@/components/ui/editor";
import { For, Show } from "solid-js";

import { DropdownMenu, MenuContent, MenuRow, MenuRadioGroup, MenuRadioItem, MenuControl } from "@/components/menus";
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

/**
 * What a review compares, above its diff: the scope, the turn when the scope
 * is a chat's, and the endpoints. Source Control and Chat review each pass
 * their own review and scopes, so the two never share a selection.
 */
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
        <FileButton aria-label="Older turn" title="Older turn" disabled={source().loading() || source().turnIndex() >= source().timeline().length - 1} onClick={() => void source().stepTurn(1, source().turnIndex() + 1)}><Icons.ChevronLeft /></FileButton>
        <DropdownMenu>
          <MenuControl as={StatusPicker} icon={<Icons.ChevronDown />} aria-label="Select turn">{source().timeline().length ? `${source().scope() === "chat" ? "Through turn" : "Turn"} ${source().turnNumber(source().turnIndex())}` : "Latest turn"}</MenuControl>
          <MenuContent><For each={source().timeline()}>{(turn, index) => <MenuRow onSelect={() => void source().stepTurn(1, index())}>{`${source().scope() === "chat" ? "Through turn" : "Turn"} ${source().turnNumber(index())}`} · {turnTime(turn.createdAt)}</MenuRow>}</For></MenuContent>
        </DropdownMenu>
        <FileButton aria-label="Newer turn" title="Newer turn" disabled={source().loading() || source().turnIndex() <= 0} onClick={() => void source().stepTurn(-1, source().turnIndex() - 1)}><Icons.ChevronRight /></FileButton>
      </TurnNavigation>
    </Show>
    <StatusText><span title="Comparison endpoints">{source().rangeLabel()}</span></StatusText>
    <Show when={source().loading()}><Spinner /></Show>
    <Show when={source().error()}><FileButton wide title={source().error()} onClick={() => props.open(source().scope(), undefined, source().checkpointId())}>Retry</FileButton></Show>
  </ComparisonSource>;
}
