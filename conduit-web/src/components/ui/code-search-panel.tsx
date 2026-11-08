import { searchPanelClass } from "./editor";
import { FindBar } from "./find";
import { LeadInput } from "./controls";
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, setSearchQuery } from "@codemirror/search";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { CaseSensitiveIcon, RegexIcon, ReplaceAllIcon, ReplaceIcon, WholeWordIcon } from "lucide-solid";
import { createSignal, Show, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { IconButton } from "./actions";

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

  const close = () => { run(closeSearchPanel); props.view.focus(); };

  return <FindBar plain label="Find" query={props.query().search} inputRef={(element) => element.setAttribute("main-field", "true")}
    onQuery={(search) => updateQuery({ search })} onNext={() => run(findNext)} onPrevious={() => run(findPrevious)} onEscape={close} onClose={close}>
    <Show when={props.editable()}>
      <LeadInput kind="tool" lead={<ReplaceIcon />} aria-label="Replace" placeholder="Replace" value={props.query().replace}
        onInput={(event) => updateQuery({ replace: event.currentTarget.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); run(replaceNext); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        }} />
    </Show>
    <IconButton kind="tool" label="Match case" aria-pressed={props.query().caseSensitive} onClick={() => updateQuery({ caseSensitive: !props.query().caseSensitive })}><CaseSensitiveIcon /></IconButton>
    <IconButton kind="tool" label="Use regular expression" aria-pressed={props.query().regexp} onClick={() => updateQuery({ regexp: !props.query().regexp })}><RegexIcon /></IconButton>
    <IconButton kind="tool" label="Match whole word" aria-pressed={props.query().wholeWord} onClick={() => updateQuery({ wholeWord: !props.query().wholeWord })}><WholeWordIcon /></IconButton>
    <Show when={props.editable()}>
      <IconButton kind="tool" label="Replace next match" onClick={() => run(replaceNext)}><ReplaceIcon /></IconButton>
      <IconButton kind="tool" label="Replace all matches" onClick={() => run(replaceAll)}><ReplaceAllIcon /></IconButton>
    </Show>
  </FindBar>;
}

export function createCodeSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = searchPanelClass;
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
