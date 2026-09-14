import { createSignal, lazy, onCleanup, Show, Suspense, type JSX } from "solid-js";
import { PanelLeftOpenIcon, PencilIcon } from "lucide-solid";
import type { ComparisonPayload, ComparisonViewState } from "./workspace-comparison";
import { WorkspaceReviewNavigator, type WorkspaceReviewFile } from "./workspace-review";
import { WorkbenchButton } from "./workspace-workbench";
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
  let stopResize: (() => void) | undefined;
  const startResize = (event: PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = navigatorWidth();
    const move = (moveEvent: PointerEvent) => saveNavigatorWidth(startWidth + moveEvent.clientX - startX);
    stopResize = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stopResize!);
      window.removeEventListener("pointercancel", stopResize!);
      document.body.classList.remove("workspace-tree-resizing");
    };
    document.body.classList.add("workspace-tree-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
  };
  onCleanup(() => stopResize?.());
  return <div class="workspace-diff-shell" data-navigator-collapsed={navigatorCollapsed()} style={{ "--workspace-diff-navigator-width": `${navigatorWidth()}px` }}>
    <Show when={!navigatorCollapsed()} fallback={<div class="workspace-diff-navigator-rail"><WorkbenchButton type="button" aria-label="Show changed files" title="Show changed files" onClick={() => setCollapsed(false)}><PanelLeftOpenIcon /></WorkbenchButton></div>}>
      <WorkspaceReviewNavigator
      title={props.title}
      files={props.files}
      selectedPath={props.selectedPath}
      empty={props.error || (props.loading ? "Loading changes…" : props.empty)}
      onSelect={props.onSelect}
      onCollapse={() => setCollapsed(true)}
      />
      <div class="workspace-diff-navigator-resize" role="separator" aria-label="Resize changed files" aria-orientation="vertical" aria-valuemin={MIN_NAVIGATOR_WIDTH} aria-valuemax={MAX_NAVIGATOR_WIDTH} aria-valuenow={navigatorWidth()} tabIndex={0} onPointerDown={startResize} onKeyDown={(event) => {
        if (event.key === "ArrowLeft") saveNavigatorWidth(navigatorWidth() - 8);
        else if (event.key === "ArrowRight") saveNavigatorWidth(navigatorWidth() + 8);
      }} />
    </Show>
    <div class="workspace-review-comparison">
      <Show when={props.comparison} fallback={<div class="workspace-panel-empty">{props.loading ? "Loading changes…" : props.files.length ? "Select a changed file." : props.error || props.empty}</div>}>
        {(comparison) => <Suspense fallback={<div class="workspace-panel-empty">Loading comparison…</div>}>
          <WorkspaceComparison
            comparison={comparison()}
            sourceKey={props.sourceKey}
            viewState={props.viewState}
            headerAction={<WorkbenchButton type="button" aria-label="Open working file" title="Open working file" onClick={() => props.onOpenWorkingFile(comparison().path)}><PencilIcon /></WorkbenchButton>}
            comparisonSource={props.comparisonSource}
            commentHighlights={reviewComments(props.annotationChatId ?? "").filter((comment) => comment.path === comparison().path && comment.scope === comparison().scope)}
            reveal={props.reveal}
            onAnnotate={props.annotationChatId ? addAnnotation : undefined}
            onViewStateChange={props.onViewStateChange}
          />
        </Suspense>}
      </Show>
    </div>
  </div>;
}
