import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, setSearchQuery } from "@codemirror/search";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { CaseSensitiveIcon, ChevronDownIcon, ChevronUpIcon, RegexIcon, ReplaceAllIcon, ReplaceIcon, WholeWordIcon, XIcon } from "lucide-solid";
import { createSignal, Show, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { Button, Input } from "@/components/primitives";

function nextQuery(query: SearchQuery, change: Partial<Pick<SearchQuery, "search" | "replace" | "caseSensitive" | "regexp" | "wholeWord">>) {
  return new SearchQuery({
    search: change.search ?? query.search,
    replace: change.replace ?? query.replace,
    caseSensitive: change.caseSensitive ?? query.caseSensitive,
    regexp: change.regexp ?? query.regexp,
    wholeWord: change.wholeWord ?? query.wholeWord,
    literal: query.literal,
  });
}

function WorkspaceSearchControls(props: {
  view: EditorView;
  query: Accessor<SearchQuery>;
  editable: Accessor<boolean>;
}) {
  const updateQuery = (change: Partial<Pick<SearchQuery, "search" | "replace" | "caseSensitive" | "regexp" | "wholeWord">>) => {
    props.view.dispatch({ effects: setSearchQuery.of(nextQuery(props.query(), change)) });
  };
  const run = (command: (view: EditorView) => boolean) => command(props.view);

  return <div class="workspace-search-controls" onKeyDown={(event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    run(closeSearchPanel);
    props.view.focus();
  }}>
    <Input
      ref={(element) => element.setAttribute("main-field", "true")}
      class="workspace-search-field"
      aria-label="Find"
      placeholder="Find"
      value={props.query().search}
      onInput={(event) => updateQuery({ search: event.currentTarget.value })}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          run(event.shiftKey ? findPrevious : findNext);
        }
      }}
    />
    <Show when={props.editable()}>
      <Input
        class="workspace-search-field workspace-replace-field"
        aria-label="Replace"
        placeholder="Replace"
        value={props.query().replace}
        onInput={(event) => updateQuery({ replace: event.currentTarget.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            run(replaceNext);
          }
        }}
      />
    </Show>
    <div class="workspace-search-actions">
      <Button variant="ghost" size="icon-sm" aria-label="Previous match" title="Previous match (Shift+Enter)" onClick={() => run(findPrevious)}><ChevronUpIcon /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Next match" title="Next match (Enter)" onClick={() => run(findNext)}><ChevronDownIcon /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Match case" title="Match case" aria-pressed={props.query().caseSensitive} onClick={() => updateQuery({ caseSensitive: !props.query().caseSensitive })}><CaseSensitiveIcon /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Use regular expression" title="Use regular expression" aria-pressed={props.query().regexp} onClick={() => updateQuery({ regexp: !props.query().regexp })}><RegexIcon /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Match whole word" title="Match whole word" aria-pressed={props.query().wholeWord} onClick={() => updateQuery({ wholeWord: !props.query().wholeWord })}><WholeWordIcon /></Button>
      <Show when={props.editable()}>
        <Button variant="ghost" size="icon-sm" aria-label="Replace next match" title="Replace next match" onClick={() => run(replaceNext)}><ReplaceIcon /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Replace all matches" title="Replace all matches" onClick={() => run(replaceAll)}><ReplaceAllIcon /></Button>
      </Show>
      <Button variant="ghost" size="icon-sm" aria-label="Close search" title="Close search (Escape)" onClick={() => run(closeSearchPanel)}><XIcon /></Button>
    </div>
  </div>;
}

export function createWorkspaceSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "workspace-search-panel";
  const [query, setQuery] = createSignal(getSearchQuery(view.state));
  const [editable, setEditable] = createSignal(!view.state.readOnly);
  const dispose = render(() => <WorkspaceSearchControls view={view} query={query} editable={editable} />, dom);
  return {
    dom,
    top: false,
    update(update: ViewUpdate) {
      const value = getSearchQuery(update.state);
      if (!value.eq(query())) setQuery(value);
      setEditable(!update.state.readOnly);
    },
    destroy: dispose,
  };
}
