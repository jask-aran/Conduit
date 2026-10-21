import { Icons } from "@/components/ui";

import { FileView, FileViewer, FileHead, FileName, FileGit, FileDirty, FileActions, FileTools, FileButton, FileMore, StatusBar, StatusText, StatusPicker } from "@/components/ui/file";
import { FileSuffix } from "@/components/ui/file";
import { FileImage, FileCard, FileBody, FileDivider, FileSwap, FileEmptySide, FileEmpty, FileChanges, FileMedia, FileScope } from "@/components/ui/viewer";
import { CodeSurface, CodeHost, CodeContent, SearchBar, SearchField, SearchActions, AnnotationPopup, AnnotationInput, AnnotationButton, ComparisonCounts, TurnNavigation, Comparison, ComparisonContent, ComparisonSource, DiffShell, DiffRail, DiffBody, SplitEdge } from "@/components/ui/editor";
import { Button, Input } from "@/components/ui/controls";
import { PaneEmpty } from "@/components/ui/pane";
import { Browser, BrowserLayout, BrowserSidebar, BrowserHeading, BrowserPlaces, BrowserPlace, BrowserMain, BrowserToolbar, BrowserActions, BrowserSearch, BrowserAddress, BrowserCount, BrowserSummary, BrowserSpacer, BrowserColumns, BrowserGrid, BrowserEntry, BrowserMark, BrowserDivider, BrowserEmpty, BrowserLoading, BrowserError } from "@/components/ui/browser";
import { ListIcon } from "lucide-solid";
import type { JSX } from "solid-js";
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

// A comparison's stand-in text: the app mounts CodeMirror's merge view in the CodeHost instead.
const DIFF = ["@@ -1,3 +1,3 @@", " export function greet(name: string) {", "-  return \"Hello, \" + name;", "+  return `Hello, ${name}`;", " }"];
const Diff = () => <pre class="g-file-code">{DIFF.map((line, index) => <span><i>{index + 1}</i>{line}{"\n"}</span>)}</pre>;
const ComparisonSample = (props: { scope?: string }) => <Comparison style={{ height: "calc(15 * var(--u-space))" }}>
  <FileHead><FileName path="src/greet.ts" icon={<Icons.FileCode />} />{props.scope ? <FileScope>{props.scope}</FileScope> : null}<FileTools>
    <FileButton label="Find in comparison"><Icons.Search /></FileButton><FileButton label="Wrap lines"><Icons.WrapText /></FileButton><FileButton label="Show side-by-side diff"><Icons.Split /></FileButton>
  </FileTools></FileHead>
  <ComparisonContent data-layout="unified"><CodeHost comparison><Diff /></CodeHost></ComparisonContent>
  <StatusBar label="Comparison" commands={<ComparisonSource>
    <StatusPicker icon={<Icons.ChevronDown />}>This turn</StatusPicker>
    <TurnNavigation aria-label="Turn navigation"><FileButton label="Older turn"><Icons.ChevronLeft /></FileButton><StatusPicker icon={<Icons.ChevronDown />}>Turn 3</StatusPicker><FileButton label="Newer turn"><Icons.ChevronRight /></FileButton></TurnNavigation>
    <StatusText>a1b2c3d → working copy</StatusText>
  </ComparisonSource>}><ComparisonCounts><span>−1</span><span>+1</span></ComparisonCounts><StatusText>TypeScript · Read-only</StatusText></StatusBar>
</Comparison>;

// The file browser, composed from its pieces with made-up entries (the app's is ComputerExplorer).
type Entry = { name: string; folder?: boolean; size?: string; workspace?: boolean };
const ENTRIES: Entry[] = [{ name: "Conduit", folder: true, workspace: true }, { name: "Documents", folder: true }, { name: "Downloads", folder: true }, { name: "notes.md", size: "2.1 KB" }, { name: "photo.png", size: "840 KB" }];
const Entries = (props: { details?: boolean; entries?: Entry[] }) => <>{(props.entries ?? ENTRIES).map((entry) => <BrowserEntry type="button" title={entry.name}>
  {entry.folder ? <Icons.Folder /> : <Icons.FileText />}<span>{entry.name}</span>
  {entry.workspace ? <BrowserMark title="Conduit workspace"><Icons.Workspace /></BrowserMark> : null}
  {props.details ? <><small>{entry.folder ? "Folder" : "File"}</small><small>{entry.size ?? "—"}</small><small>12 Oct 2026</small><small>20 Oct 2026</small></> : null}
</BrowserEntry>)}</>;
const Grid = (props: { details?: boolean; children?: JSX.Element }) => <BrowserGrid data-view={props.details ? "details" : "tiles"}>
  {props.details ? <BrowserColumns><span>Name</span><span>Type</span><span>Size</span><span>Created</span><span>Modified</span></BrowserColumns> : null}
  {props.children ?? <Entries details={props.details} />}
</BrowserGrid>;
const Toolbar = () => <BrowserToolbar>
  <Button variant="ghost" type="button" aria-label="Home folder"><Icons.Home /></Button>
  <Button variant="ghost" type="button" aria-label="Parent folder"><Icons.ArrowUp /></Button>
  <BrowserAddress aria-label="Folder path" value="/home/jask" />
  <BrowserSearch><Icons.Search /><Input type="search" aria-label="Search this folder" placeholder="Search" /></BrowserSearch>
  <Button variant="ghost" type="button" aria-label="Use details view"><ListIcon /></Button>
  <Button variant="ghost" type="button" aria-label="Refresh folder"><Icons.Refresh /></Button>
  <BrowserCount>{ENTRIES.length} items</BrowserCount>
</BrowserToolbar>;
const Actions = () => <BrowserActions>
  <BrowserSummary title="/home/jask/Conduit"><Icons.GitBranch />Conduit</BrowserSummary>
  <BrowserSpacer />
  <Button variant="ghost" type="button"><Icons.Terminal />Terminal Here</Button>
  <Button variant="ghost" type="button"><Icons.GitBranch />Source Control</Button>
</BrowserActions>;
const Assembled = (props: { compact?: boolean; details?: boolean }) => <div style={{ height: "calc(22 * var(--u-space))", display: "flex" }}><Browser compact={props.compact} sidebarWidth={160}><BrowserLayout>
  <BrowserSidebar>
    <BrowserHeading>Locations</BrowserHeading>
    <BrowserPlace type="button" data-active><Icons.Home /><span>Home</span></BrowserPlace>
    <BrowserHeading>Workspaces</BrowserHeading>
    <BrowserPlaces><BrowserPlace type="button"><Icons.Workspace /><span>Conduit</span></BrowserPlace><BrowserPlace type="button"><Icons.Workspace /><span>Japan</span></BrowserPlace></BrowserPlaces>
  </BrowserSidebar>
  <BrowserDivider role="separator" aria-label="Resize locations sidebar" aria-orientation="vertical" />
  <BrowserMain><Toolbar /><Actions /><Grid details={props.details} /></BrowserMain>
</BrowserLayout></Browser></div>;
const Pane = (props: { children: JSX.Element }) => <div style={{ ...box(45), position: "relative", display: "flex", "flex-direction": "column", "min-height": "calc(12 * var(--u-space))" }}><BrowserMain>{props.children}</BrowserMain></div>;

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
    { title: "Changes, media and suffix", note: "a file column holding a comparison instead of an editor, audio or video filling a body, and what a host adds to a header", atoms: [
      lib("files-changes", "FileChanges · FileScope · FileMedia · FileSuffix", "both", "files", "components/ui/viewer.tsx · file.tsx", () => <FormTable rows={[
        form("FileChanges · FileScope", "a file's changes in its column: the comparison (Editor › Comparison), its scope quiet beside the name; focused, it takes the wash. The app mounts CodeMirror where the text stands", () => <States states={["Rest", "Focused"] as const}>{(state) => <div style={box(37.5)}><FileChanges focused={state() === "Focused"}><ComparisonSample scope="Changes" /></FileChanges></div>}</States>, "<FileChanges focused><Comparison><FileHead><FileName /><FileScope /></FileHead>…</Comparison></FileChanges>"),
        form("FileMedia", "audio, video or a PDF filling the file's remaining space (here an audio player with no source)", () => <FileView style={{ ...box(30), height: "calc(10 * var(--u-space))" }}><Head /><FileMedia><audio controls preload="none" aria-label="sample.mp3" /></FileMedia></FileView>, "<FileMedia><audio controls /></FileMedia>"),
        form("FileSuffix", "what the host adds to the header, with the actions (here a pane's “Turn 3”)", () => <div style={box(30)}><FileHead><FileName path="src/greet.ts" icon={<Icons.FileCode />} /><FileSuffix><FileScope>Turn 3</FileScope></FileSuffix><FileButton label="Close file" close><Icons.Close /></FileButton></FileHead></div>, "<FileSuffix>{headerSuffix}</FileSuffix>"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
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
    { title: "Comparison", note: "a change shown as a diff: its header, its code (the app mounts CodeMirror's merge view in the CodeHost; here a static stand-in), and a status bar with its source, turn steps and counts. In Source control it sits in DiffShell beside the changed-file navigator", layout: "desktop", atoms: [
      lib("editor-comparison", "Comparison · DiffShell", "desktop", "editor", "components/ui/editor.tsx", () => <FormTable rows={[
        form("Comparison · ComparisonContent · ComparisonSource · TurnNavigation · ComparisonCounts", "a turn's change to one file; the status bar leads with the source picker, older/newer turn and the endpoints. Static text where the app mounts CodeMirror", () => <div style={box(45)}><ComparisonSample /></div>, "<Comparison><FileHead /><ComparisonContent><CodeHost comparison /></ComparisonContent><StatusBar commands={<ComparisonSource />} /></Comparison>"),
        form("DiffShell · SplitEdge · DiffBody", "the navigator open: changed files (stand-in here; Panes › Source control draws the real one), the edge that resizes it, then the comparison", () => <States states={["Rest", "Resizing"] as const}>{(state) => <div style={{ ...box(55), height: "calc(15 * var(--u-space))", display: "flex" }}><DiffShell width={160}><PaneEmpty>Changed files</PaneEmpty><SplitEdge resizing={state() === "Resizing"} aria-label="Resize changed files" /><DiffBody><ComparisonSample /></DiffBody></DiffShell></div>}</States>, "<DiffShell width><navigator /><SplitEdge resizing /><DiffBody /></DiffShell>"),
        form("DiffShell collapsed · DiffRail", "the navigator folded to its rail: one button opens it again", () => <div style={{ ...box(55), height: "calc(15 * var(--u-space))", display: "flex" }}><DiffShell collapsed width={160}><DiffRail><FileButton label="Show changed files"><Icons.ExpandFiles /></FileButton></DiffRail><DiffBody><ComparisonSample /></DiffBody></DiffShell></div>, "<DiffShell collapsed><DiffRail><FileButton /></DiffRail><DiffBody /></DiffShell>"),
        form("DiffBody · nothing chosen", "the comparison column before a file is picked", () => <div style={{ ...box(55), height: "calc(8 * var(--u-space))", display: "flex" }}><DiffShell collapsed width={160}><DiffRail><FileButton label="Show changed files"><Icons.ExpandFiles /></FileButton></DiffRail><DiffBody><PaneEmpty>Select a changed file.</PaneEmpty></DiffBody></DiffShell></div>, "<DiffBody><PaneEmpty /></DiffBody>"),
      ]} on={["desktop"]} stacked />, "row"),
    ] },
  ] },
  { title: "Browser", note: "the file browser (the Computer page and the folder picker): a sidebar of places beside a main column of toolbar, actions and the folder's entries, as tiles or details. Composed here from its pieces with made-up entries", groups: [
    { title: "Assembled", note: "the whole browser; compact is the folder picker's dialog form", layout: "desktop", atoms: [
      lib("browser-layout", "Browser · BrowserLayout · BrowserSidebar · BrowserMain", "desktop", "browser", "components/ui/browser.tsx", () => <FormTable rows={[
        form("Browser · BrowserLayout", "places at the left (BrowserHeading over BrowserPlace rows, workspaces in BrowserPlaces), the divider that resizes them, then the main column", () => <Assembled />, "<Browser sidebarWidth><BrowserLayout><BrowserSidebar /><BrowserDivider /><BrowserMain /></BrowserLayout></Browser>"),
        form("Browser compact", "the folder picker's form, inside a dialog", () => <Assembled compact />, "<Browser compact sidebarWidth>"),
      ]} on={["desktop"]} stacked />, "row"),
    ] },
    { title: "Toolbar", note: "the toolbar's parts and the actions row under it", atoms: [
      lib("browser-toolbar", "BrowserToolbar · BrowserActions", "both", "browser", "components/ui/browser.tsx", () => <FormTable rows={[
        form("BrowserToolbar · BrowserAddress · BrowserSearch · BrowserCount", "home and parent, the folder's path (editable), search in this folder, view and refresh, then how many items", () => <div style={box(45)}><Toolbar /></div>, "<BrowserToolbar><Button /><BrowserAddress /><BrowserSearch><Input /></BrowserSearch><BrowserCount /></BrowserToolbar>"),
        form("BrowserActions · BrowserSummary · BrowserSpacer", "the repository this folder is in, a spacer, then what opens here", () => <div style={box(45)}><Actions /></div>, "<BrowserActions><BrowserSummary /><BrowserSpacer /><Button /></BrowserActions>"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
    ] },
    { title: "Entries", note: "a folder's entries as tiles or as details with columns; a folder that is a workspace wears its mark", atoms: [
      lib("browser-entries", "BrowserGrid · BrowserEntry · BrowserColumns · BrowserMark", "both", "browser", "components/ui/browser.tsx", () => <FormTable rows={[
        form("BrowserGrid tiles · BrowserEntry · BrowserMark", "folders first, then files; Conduit is a workspace (the mark)", () => <Pane><Grid /></Pane>, '<BrowserGrid data-view="tiles"><BrowserEntry><Icon /><span /><BrowserMark /></BrowserEntry></BrowserGrid>'),
        form("BrowserGrid details · BrowserColumns", "the same entries with type, size and dates under column names", () => <Pane><Grid details /></Pane>, '<BrowserGrid data-view="details"><BrowserColumns /><BrowserEntry>…<small /></BrowserEntry></BrowserGrid>'),
      ]} on={["desktop", "phone"]} stacked />, "row"),
    ] },
    { title: "States", note: "an empty folder, a folder loading, and a folder that could not be read", atoms: [
      lib("browser-states", "BrowserEmpty · BrowserLoading · BrowserError", "both", "browser", "components/ui/browser.tsx", () => <FormTable rows={[
        form("BrowserEmpty", "nothing in the folder, or nothing matches the search", () => <Pane><Grid><BrowserEmpty>This folder is empty.</BrowserEmpty></Grid></Pane>, "<BrowserGrid><BrowserEmpty /></BrowserGrid>"),
        form("BrowserLoading", "the listing on its way (the grid is busy under it)", () => <Pane><BrowserGrid data-view="tiles" aria-busy="true" /><BrowserLoading>Loading…</BrowserLoading></Pane>, "<BrowserLoading />"),
        form("BrowserError", "the folder could not be listed; above the entries", () => <Pane><BrowserError>Permission denied: /root</BrowserError><Grid><BrowserEmpty>This folder is empty.</BrowserEmpty></Grid></Pane>, "<BrowserError />"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
    ] },
  ] },
];
