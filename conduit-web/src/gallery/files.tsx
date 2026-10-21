import { Icons } from "@/components/ui";

import { FileView, FileViewer, FileHead, FileName, FileGit, FileDirty, FileActions, FileTools, FileButton, FileMore, StatusBar, StatusText, StatusPicker } from "@/components/ui/file";
import { FileImage, FileCard, FileBody, FileDivider, FileSwap, FileEmptySide, FileEmpty } from "@/components/ui/viewer";
import { CodeSurface, CodeHost, CodeContent, SearchBar, SearchField, SearchActions, AnnotationPopup, AnnotationInput, AnnotationButton, ComparisonCounts, TurnNavigation } from "@/components/ui/editor";
import { Button } from "@/components/ui/controls";
import { FormTable, form, States } from "./specs";
import { lib, type Family } from "./library";

/*
 * Files and the editor (components/ui/file.tsx, viewer.tsx, editor.tsx): a file's header, body and status bar, the
 * viewer's two sides, and the code surface's find bar, line comments and comparison. The app fits the header (it sets
 * data-folded on what does not fit, lowest data-fold first); here each state is set by hand.
 */

const SAMPLE = ["export function greet(name: string) {", "  return `Hello, ${name}`;", "}", "", "greet(\"Conduit\");"];
const Code = () => <pre class="g-file-code">{SAMPLE.map((line, index) => <span><i>{index + 1}</i>{line || " "}{"\n"}</span>)}</pre>;
// A sample fills its cell up to a width of its own.
const box = (units: number) => ({ width: "100%", "max-width": `calc(${units} * var(--u-space))` });

function Head(props: { folded?: boolean; dirty?: boolean; git?: string }) {
  const fold = (key: string) => props.folded && key !== "close" ? { "data-folded": "" } : {};
  return <FileHead>
    <FileName path="src/greet.ts" icon={<Icons.FileCode />} />
    {props.git ? <FileGit status={props.git} /> : null}
    <FileDirty dirty={Boolean(props.dirty)} />
    <FileActions>
      <FileButton label="Copy contents" data-fold="1" {...fold("copy")}><Icons.Copy /></FileButton>
      <FileButton label="Download" data-fold="2" {...fold("download")}><Icons.Download /></FileButton>
    </FileActions>
    <FileTools>
      <FileButton label="Find or replace" data-fold="3" {...fold("find")}><Icons.Search /></FileButton>
      <FileButton label="Wrap lines" inMenu data-fold="4" {...fold("wrap")}><Icons.WrapText /></FileButton>
    </FileTools>
    <FileMore aria-label="More file actions" />
    <FileButton label="Close file" close><Icons.Close /></FileButton>
  </FileHead>;
}

const Status = (props: { editing?: boolean }) => <StatusBar label="File status" commands={<>
  <StatusPicker strong icon={props.editing ? <Icons.Preview /> : <Icons.Edit />}>{props.editing ? "Preview" : "Edit"}</StatusPicker>
  <StatusPicker icon={<Icons.ChevronDown />}>Spaces: 2</StatusPicker>
  <StatusPicker icon={<Icons.ChevronDown />}>TypeScript</StatusPicker>
</>}><StatusText>Working copy · 112 B</StatusText><StatusText>Ln 1, Col 1</StatusText></StatusBar>;

const File = (props: { focused?: boolean; editing?: boolean }) => <FileView focused={props.focused} style={{ height: "calc(17.5 * var(--u-space))" }}>
  <Head /><FileBody editing={props.editing}><Code /></FileBody><Status editing={props.editing} />
</FileView>;

export const filesFamilies = (): Family[] => [
  { title: "Files", note: "a file in a pane or the dock: its header (name, git letter, unsaved dot, actions and tools, the ⋯ they fold into, close), its body, and the status bar at its foot. Two files side by side share a viewer with a divider and a swap. The app measures the header and folds actions into the ⋯ lowest data-fold first; the tab row (Panes) replaces the name when a pane holds tabs", groups: [
    { title: "Header and status bar", note: "each state set by hand", layout: "desktop", atoms: [
      lib("files-head", "FileHead · fitting", "both", "files", "components/ui/file.tsx", () => <FormTable rows={[
        form("FileHead · FileName · FileGit · FileDirty", "a modified file with unsaved changes: the git letter, then the dot", () => <div style={box(30)}><Head git="M" dirty /></div>, "<FileHead><FileName path icon /><FileGit status /><FileDirty dirty />…</FileHead>"),
        form("FileActions · FileTools · FileButton", "everything fits: copy and download, then find and wrap; close last", () => <div style={box(30)}><Head /></div>, '<FileButton label data-fold="1" />', "--control-tool buttons · --icon-sm"),
        form("FileMore · data-folded", "too narrow: every action folds into the ⋯ (shown by the viewer once anything folds)", () => <FileViewer style={{ ...box(18.75), height: "auto" }}><FileView><Head folded /></FileView></FileViewer>, "data-folded on each folded button"),
        form("StatusBar · StatusPicker · StatusText", "the mode picker leads with its mark (Edit, or Preview while editing); pickers end with a chevron; details at the right", () => <States states={["Viewing", "Editing"] as const}>{(state) => <div style={box(37.5)}><Status editing={state() === "Editing"} /></div>}</States>, "<StatusBar commands={<StatusPicker strong icon />}><StatusText /></StatusBar>", "--text-caption"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
    ] },
    { title: "Bodies", atoms: [
      lib("files-bodies", "FileBody · FileImage · FileCard", "both", "files", "components/ui/viewer.tsx", () => <FormTable rows={[
        form("FileView · FileBody", "a text file; focused, its header takes the wash", () => <States states={["Rest", "Focused"] as const}>{(state) => <div style={box(30)}><File focused={state() === "Focused"} /></div>}</States>, "<FileView focused><FileHead /><FileBody /><StatusBar /></FileView>"),
        form("FileImage", "an image on its checker ground, contained", () => <div style={{ ...box(22), height: "calc(12.5 * var(--u-space))", display: "flex" }}><FileImage><Icons.Image style={{ width: "calc(6 * var(--u-space))", height: "calc(6 * var(--u-space))" }} /></FileImage></div>, "<FileImage><img /></FileImage>"),
        form("FileCard", "a file the viewer cannot show: its kind, its size, and an action", () => <div style={{ ...box(22), display: "flex" }}><FileCard><Icons.FileText /><strong>archive.zip</strong><span>2.4 MB · application/zip</span><Button size="sm" variant="secondary"><Icons.Download />Download</Button></FileCard></div>, "<FileCard><strong /><span /><Button /></FileCard>"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
    ] },
    { title: "Two sides", atoms: [
      lib("files-sides", "FileViewer · two sides", "desktop", "files", "components/ui/file.tsx · viewer.tsx", () => <FormTable rows={[
        form("FileViewer · FileDivider · FileSwap", "two files beside each other: the divider between them (it drags, --side-a and --side-b), the swap over it", () => <FileViewer style={{ ...box(50), height: "calc(15 * var(--u-space))", position: "relative", display: "flex", "--side-a": "1", "--side-b": "1" }}>
          <File focused /><FileDivider role="separator" aria-label="Resize the sides" style={{ left: "50%" }} /><FileSwap aria-label="Swap the sides" style={{ left: "calc(50% - var(--control-xs) / 2)" }}><Icons.Swap /></FileSwap><File />
        </FileViewer>, "<FileViewer><FileView /><FileDivider /><FileSwap /><FileView /></FileViewer>"),
        form("FileEmptySide · FileEmpty", "a side opened empty, waiting for a file", () => <FileViewer style={{ ...box(25), height: "calc(10 * var(--u-space))", display: "flex" }}><FileEmptySide><FileHead><strong class="g-file-none">No file open</strong></FileHead><FileEmpty role="status">Open a file from Files to show it here.</FileEmpty></FileEmptySide></FileViewer>, "<FileEmptySide><FileHead /><FileEmpty /></FileEmptySide>"),
      ]} on={["desktop"]} stacked />, "row"),
    ] },
  ] },
  { title: "Editor", note: "the code surface a file's body holds (CodeMirror draws inside it): framed while editable, its find bar above, a line comment's popup over it, and a comparison's counts and turn steps in the status bar. The review's navigator (DiffShell) is the Panes family's Source control", groups: [
    { title: "Surface", layout: "desktop", atoms: [
      lib("editor-surface", "CodeSurface · SearchBar · AnnotationPopup", "both", "editor", "components/ui/editor.tsx", () => <FormTable rows={[
        form("CodeSurface · CodeHost", "read-only, then editable: the hairline ring says you can type", () => <States states={["Read-only", "Editable"] as const}>{(state) => <div style={{ ...box(30), height: "calc(9 * var(--u-space))", display: "flex" }}><CodeSurface editable={state() === "Editable"}><CodeContent><CodeHost><Code /></CodeHost></CodeContent></CodeSurface></div>}</States>, "<CodeSurface editable><CodeContent><CodeHost /></CodeContent></CodeSurface>"),
        form("SearchBar · SearchField · SearchActions", "find and replace over the code: two fields, then previous, next and close", () => <div style={box(37.5)}><SearchBar><SearchField placeholder="Find" value="greet" /><SearchField placeholder="Replace" /><SearchActions><FileButton label="Previous match"><Icons.ArrowUp /></FileButton><FileButton label="Next match"><Icons.ArrowDown /></FileButton><FileButton label="Close find"><Icons.Close /></FileButton></SearchActions></SearchBar></div>, "<SearchBar><SearchField /><SearchActions /></SearchBar>"),
        form("AnnotationPopup · AnnotationInput · AnnotationButton", "a comment on the selected lines, before it goes to the chat", () => <div style={{ ...box(30), height: "calc(7 * var(--u-space))", position: "relative" }}><AnnotationPopup style={{ left: "var(--space-md)", top: "var(--space-md)" }}><AnnotationInput placeholder="Comment on lines 1–2" rows={2} /><AnnotationButton>Add</AnnotationButton></AnnotationPopup></div>, "<AnnotationPopup><AnnotationInput /><AnnotationButton /></AnnotationPopup>"),
        form("ComparisonCounts · TurnNavigation", "a comparison's removed and added lines, and the turn it compares", () => <div style={box(37.5)}><StatusBar label="Comparison" commands={<TurnNavigation><StatusPicker icon={<Icons.ChevronDown />}>Turn 3</StatusPicker></TurnNavigation>}><ComparisonCounts><span>−4</span><span>+12</span></ComparisonCounts></StatusBar></div>, "<ComparisonCounts><span /><span /></ComparisonCounts>"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
    ] },
  ] },
];
