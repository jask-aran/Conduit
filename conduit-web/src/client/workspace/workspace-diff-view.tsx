import { FileButton } from "@/components/ui/file";
import { DiffShell, DiffRail, DiffBody, SplitEdge } from "@/components/ui/editor";
import { PaneEmpty } from "@/components/ui/pane";
import { createSignal, lazy, onCleanup, Show, Suspense, type JSX } from "solid-js";
import { PanelLeftOpenIcon, PencilIcon } from "lucide-solid";
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
  const [resizing, setResizing] = createSignal(false);
  let stopResize: (() => void) | undefined;
  const startResize = (event: PointerEvent) => {
    event.preventDefault();
    setResizing(true);
    const startX = event.clientX;
    const startWidth = navigatorWidth();
    const move = (moveEvent: PointerEvent) => saveNavigatorWidth(startWidth + moveEvent.clientX - startX);
    stopResize = () => {
      setResizing(false);
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
  return <DiffShell collapsed={navigatorCollapsed()} width={navigatorWidth()}>
    <Show when={!navigatorCollapsed()} fallback={<DiffRail><FileButton type="button" aria-label="Show changed files" title="Show changed files" onClick={() => setCollapsed(false)}><PanelLeftOpenIcon /></FileButton></DiffRail>}>
      <WorkspaceReviewNavigator
      title={props.title}
      files={props.files}
      selectedPath={props.selectedPath}
      empty={props.error || (props.loading ? "Loading changes…" : props.empty)}
      onSelect={props.onSelect}
      onCollapse={() => setCollapsed(true)}
      />
      <SplitEdge resizing={resizing()} role="separator" aria-label="Resize changed files" aria-orientation="vertical" aria-valuemin={MIN_NAVIGATOR_WIDTH} aria-valuemax={MAX_NAVIGATOR_WIDTH} aria-valuenow={navigatorWidth()} tabIndex={0} onPointerDown={startResize} onKeyDown={(event) => {
        if (event.key === "ArrowLeft") saveNavigatorWidth(navigatorWidth() - 8);
        else if (event.key === "ArrowRight") saveNavigatorWidth(navigatorWidth() + 8);
      }} />
    </Show>
    <DiffBody>
      <Show when={props.comparison} fallback={<PaneEmpty>{props.loading ? "Loading changes…" : props.files.length ? "Select a changed file." : props.error || props.empty}</PaneEmpty>}>
        {(comparison) => <Suspense fallback={<PaneEmpty>Loading comparison…</PaneEmpty>}>
          <WorkspaceComparison
            comparison={comparison()}
            sourceKey={props.sourceKey}
            viewState={props.viewState}
            headerAction={<FileButton type="button" aria-label="Open working file" title="Open working file" onClick={() => props.onOpenWorkingFile(comparison().path)}><PencilIcon /></FileButton>}
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
