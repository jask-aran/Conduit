import { Icons, Empty, IconButton } from "@/components/ui";
import { DiffShell, DiffRail, DiffBody } from "@/components/ui/editor";
import { ResizeEdge, type EdgeDrag } from "@/components/ui/pane";
import { createSignal, lazy, Show, Suspense, type JSX } from "solid-js";

import type { ComparisonPayload, ComparisonViewState } from "./workspace-comparison";
import { WorkspaceReviewNavigator, type WorkspaceReviewFile } from "./workspace-review";
import { readSetting, WORKSPACE_PANEL_GLOBAL_SCOPE, writeSetting } from "./workspace-panel-storage";
import { addReviewComment, reviewComments } from "../chat/review-comments";
import type { AnnotationSelection } from "./workspace-annotate";
import type { ReviewNavigationRequest } from "../chat/review-navigation";

const WorkspaceComparison = lazy(() => import("./workspace-comparison"));
const MIN_NAVIGATOR_WIDTH = 128;
const MAX_NAVIGATOR_WIDTH = 320;

export interface WorkspaceDiffViewProps {
  title: string;
  files: WorkspaceReviewFile[];
  selectedPath: string | null;
  comparison: ComparisonPayload | null;
  sourceKey: string;
  viewState: ComparisonViewState;
  loading: boolean;
  error: string;
  empty: string;
  comparisonSource?: JSX.Element;
  annotationChatId?: string | null;
  reveal?: ReviewNavigationRequest | null;
  onSelect: (path: string) => void;
  onOpenWorkingFile: (path: string) => void;
  onViewStateChange: (state: ComparisonViewState) => void;
}

export function WorkspaceDiffView(props: WorkspaceDiffViewProps) {
  const storedWidth = Number(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "diff-navigator-width"));
  const [navigatorWidth, setNavigatorWidth] = createSignal(Math.max(MIN_NAVIGATOR_WIDTH, Math.min(MAX_NAVIGATOR_WIDTH, storedWidth || 224)));
  const [navigatorCollapsed, setNavigatorCollapsed] = createSignal(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "diff-navigator-collapsed") === "true");
  const saveNavigatorWidth = (value: number) => {
    const width = Math.max(MIN_NAVIGATOR_WIDTH, Math.min(MAX_NAVIGATOR_WIDTH, value));
    setNavigatorWidth(width);
    writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "diff-navigator-width", String(width));
  };
  const setCollapsed = (collapsed: boolean) => {
    setNavigatorCollapsed(collapsed);
    writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "diff-navigator-collapsed", String(collapsed));
  };
  const addAnnotation = (selection: AnnotationSelection, note: string) => {
    const chatId = props.annotationChatId;
    const comparison = props.comparison;
    if (!chatId || !comparison) return false;
    return addReviewComment({
      id: `rc_${crypto.randomUUID()}`,
      chatId,
      path: comparison.path,
      side: selection.side,
      scope: comparison.scope,
      from: selection.from,
      to: selection.to,
      startColumn: selection.startColumn,
      endColumn: selection.endColumn,
      excerpt: selection.excerpt,
      counterpart: selection.counterpart,
      note,
    });
  };
  const startResize = (): EdgeDrag => {
    const startWidth = navigatorWidth();
    return { move: (dx) => saveNavigatorWidth(startWidth + dx) };
  };
  return <DiffShell collapsed={navigatorCollapsed()} width={navigatorWidth()}>
    <Show when={!navigatorCollapsed()} fallback={<DiffRail><IconButton kind="file" type="button" aria-label="Show changed files" title="Show changed files" onClick={() => setCollapsed(false)}><Icons.ExpandFiles /></IconButton></DiffRail>}>
      <WorkspaceReviewNavigator
      title={props.title}
      files={props.files}
      selectedPath={props.selectedPath}
      empty={props.error || (props.loading ? "Loading changes…" : props.empty)}
      onSelect={props.onSelect}
      onCollapse={() => setCollapsed(true)}
      />
      <ResizeEdge kind="split" aria-label="Resize changed files" aria-valuemin={MIN_NAVIGATOR_WIDTH} aria-valuemax={MAX_NAVIGATOR_WIDTH} aria-valuenow={navigatorWidth()} startDrag={startResize} onStep={(direction) => saveNavigatorWidth(navigatorWidth() + 8 * direction)} />
    </Show>
    <DiffBody>
      <Show when={props.comparison} fallback={<Empty>{props.loading ? "Loading changes…" : props.files.length ? "Select a changed file." : props.error || props.empty}</Empty>}>
        {(comparison) => <Suspense fallback={<Empty>Loading comparison…</Empty>}>
          <WorkspaceComparison
            comparison={comparison()}
            sourceKey={props.sourceKey}
            viewState={props.viewState}
            headerAction={<IconButton kind="file" type="button" aria-label="Open working file" title="Open working file" onClick={() => props.onOpenWorkingFile(comparison().path)}><Icons.Edit /></IconButton>}
            comparisonSource={props.comparisonSource}
            commentHighlights={reviewComments(props.annotationChatId ?? "")
              .filter((comment) => comment.path === comparison().path && comment.scope === comparison().scope)
              // A comment written across a change is marked on both of its sides.
              .flatMap((comment) => comment.counterpart?.selected ? [comment, { ...comment.counterpart, note: comment.note }] : [comment])}
            reveal={props.reveal}
            onAnnotate={props.annotationChatId ? addAnnotation : undefined}
            onViewStateChange={props.onViewStateChange}
          />
        </Suspense>}
      </Show>
    </DiffBody>
  </DiffShell>;
}
