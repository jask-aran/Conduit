import { lazy, Show, Suspense, type JSX } from "solid-js";
import { PencilIcon } from "lucide-solid";
import type { ComparisonPayload, ComparisonViewState } from "./workspace-comparison";
import { WorkspaceReviewNavigator, type WorkspaceReviewFile } from "./workspace-review";
import { WorkbenchButton } from "./workspace-workbench";

const WorkspaceComparison = lazy(() => import("./workspace-comparison"));

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
  comparisonLabel?: JSX.Element;
  onSelect: (path: string) => void;
  onOpenWorkingFile: (path: string) => void;
  onViewStateChange: (state: ComparisonViewState) => void;
}

export function WorkspaceDiffView(props: WorkspaceDiffViewProps) {
  return <div class="workspace-artifact-review">
    <WorkspaceReviewNavigator
      title={props.title}
      files={props.files}
      selectedPath={props.selectedPath}
      empty={props.error || (props.loading ? "Loading changes…" : props.empty)}
      onSelect={props.onSelect}
    />
    <div class="workspace-review-comparison">
      <Show when={props.comparison} fallback={<div class="workspace-panel-empty">{props.loading ? "Loading changes…" : "Select a changed file."}</div>}>
        {(comparison) => <Suspense fallback={<div class="workspace-panel-empty">Loading comparison…</div>}>
          <WorkspaceComparison
            comparison={comparison()}
            sourceKey={props.sourceKey}
            viewState={props.viewState}
            headerAction={<WorkbenchButton type="button" aria-label="Open working file" title="Open working file" onClick={() => props.onOpenWorkingFile(comparison().path)}><PencilIcon /><span>Open working file</span></WorkbenchButton>}
            comparisonSource={props.comparisonSource}
            comparisonLabel={props.comparisonLabel}
            onViewStateChange={props.onViewStateChange}
          />
        </Suspense>}
      </Show>
    </div>
  </div>;
}
