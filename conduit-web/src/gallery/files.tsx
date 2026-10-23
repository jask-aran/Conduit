import { Icons } from "@/components/ui";

import { FileView, FileViewer, FileHead, FileName, FileGit, FileDirty, FileActions, FileTools, FileButton, FileMore, StatusBar, StatusText, StatusPicker } from "@/components/ui/file";
import { FileSuffix } from "@/components/ui/file";
import { FileImage, FileCard, FileBody, FileDivider, FileSwap, FileEmptySide, FileEmpty, FileChanges, FileMedia, FileScope } from "@/components/ui/viewer";
import { CodeSurface, CodeHost, CodeContent, SearchBar, SearchField, SearchActions, AnnotationPopup, AnnotationInput, AnnotationButton, ComparisonCounts, TurnNavigation, Comparison, ComparisonContent, ComparisonSource, DiffShell, DiffRail, DiffBody, SplitEdge } from "@/components/ui/editor";
import { Button, Input } from "@/components/ui/controls";
import { PaneEmpty } from "@/components/ui/pane";
import { Browser, BrowserLayout, BrowserSidebar, BrowserHeading, BrowserPlaces, BrowserPlace, BrowserMain, BrowserToolbar, BrowserActions, BrowserSearch, BrowserAddress, BrowserCount, BrowserSummary, BrowserSpacer, BrowserColumns, BrowserGrid, BrowserEntry, BrowserMark, BrowserDivider, BrowserEmpty, BrowserLoading, BrowserError, BrowserMachine } from "@/components/ui/browser";
import { ListIcon } from "lucide-solid";
import type { JSX } from "solid-js";

import { row, token, type Page } from "./model";

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

export const filesPage: Page = { title: "Files", summary: "A file in a pane or the dock: its header (name, git letter, unsaved dot, actions and tools, the ⋯ they fold into, close), its body, and the status bar at its foot. Two files side by side share a viewer with a divider and a swap. The app measures the header and folds actions into the ⋯ lowest data-fold first; the tab row (Panes) replaces the name when a pane holds tabs.", rail: "Blocks",
  preview: () => <div style={box(30)}><File /></div>,
  usage: `import { FileViewer, FileView, FileHead, FileName, FileGit, FileDirty, FileActions, FileButton, StatusBar, StatusPicker, StatusText } from "@/components/ui/file";
import { FileBody } from "@/components/ui/viewer";
import { Icons } from "@/components/ui";

<FileViewer><FileView focused>
  <FileHead>
    <FileName path="src/main.tsx" icon={<Icons.FileCode />} />
    <FileGit status="M" /><FileDirty dirty={dirty()} />
    <FileActions><FileButton label="Copy contents" onClick={copyFile}><Icons.Copy /></FileButton></FileActions>
    <FileButton label="Close file" close onClick={closeFile}><Icons.Close /></FileButton>
  </FileHead>
  <FileBody editing>{editor()}</FileBody>
  <StatusBar commands={<StatusPicker strong>Edit</StatusPicker>}><StatusText>TypeScript</StatusText></StatusBar>
</FileView></FileViewer>`,
  anatomy: { scene: () => <div style={box(30)}><File /></div>, parts: [
    { selector: ".ui-file-head", name: "Header", does: "holds the file name, actions and tools", from: "FileHead" },
    { selector: ".ui-file-body", name: "Body", does: "holds the file content", from: "FileBody" },
    { selector: ".ui-status-bar", name: "Status", does: "shows the file mode and details", from: "StatusBar" }
  ] },
  examples: [
    row("FileHead · FileName · FileGit · FileDirty", "a modified file with unsaved changes: the git letter, then the dot", () => <div style={box(30)}><Head git="M" dirty /></div>, { surfaces: ["ground"], phone: true, code: "<FileHead><FileName path icon /><FileGit status /><FileDirty dirty />…</FileHead>" }),
    row("FileActions · FileTools · FileButton", "everything fits: copy and download, then find and wrap; close last; --control-tool buttons · --icon-sm", () => <div style={box(30)}><Head /></div>, { surfaces: ["ground"], phone: true, code: '<FileButton label data-fold="1" />' }),
    row("FileMore · data-folded", "too narrow: every action folds into the ⋯ (shown by the viewer once anything folds)", () => <FileViewer style={{ ...box(18.75), height: "auto" }}><FileView><Head folded /></FileView></FileViewer>, { surfaces: ["ground"], phone: true, code: "data-folded on each folded button" }),
    row("StatusBar · StatusPicker · StatusText · Viewing", "the mode picker leads with its mark (Edit, or Preview while editing); pickers end with a chevron; details at the right; --text-caption", () => <div style={box(37.5)}><Status editing={false} /></div>, { surfaces: ["ground"], phone: true, code: "<StatusBar commands={<StatusPicker strong icon />}><StatusText /></StatusBar>" }),
    row("StatusBar · StatusPicker · StatusText · Editing", "the mode picker leads with its mark (Edit, or Preview while editing); pickers end with a chevron; details at the right; --text-caption", () => <div style={box(37.5)}><Status editing={true} /></div>, { surfaces: ["ground"], phone: true, code: "<StatusBar commands={<StatusPicker strong icon />}><StatusText /></StatusBar>" }),
    row("FileView · FileBody · Rest", "a text file; focused, its header takes the wash", () => <div style={box(30)}><File focused={false} /></div>, { surfaces: ["ground"], phone: true, code: "<FileView focused><FileHead /><FileBody /><StatusBar /></FileView>" }),
    row("FileView · FileBody · Focused", "a text file; focused, its header takes the wash", () => <div style={box(30)}><File focused={true} /></div>, { surfaces: ["ground"], phone: true, code: "<FileView focused><FileHead /><FileBody /><StatusBar /></FileView>" }),
    row("FileImage", "an image on its checker ground, contained", () => <div style={{ ...box(22), height: "calc(12.5 * var(--u-space))", display: "flex" }}><FileImage><Icons.Image style={{ width: "calc(6 * var(--u-space))", height: "calc(6 * var(--u-space))" }} /></FileImage></div>, { surfaces: ["ground"], phone: true, code: "<FileImage><img /></FileImage>" }),
    row("FileCard", "a file the viewer cannot show: its kind, its size, and an action", () => <div style={{ ...box(22), display: "flex" }}><FileCard><Icons.FileText /><strong>archive.zip</strong><span>2.4 MB · application/zip</span><Button size="sm" variant="secondary"><Icons.Download />Download</Button></FileCard></div>, { surfaces: ["ground"], phone: true, code: "<FileCard><strong /><span /><Button /></FileCard>" }),
    row("FileViewer · FileDivider · FileSwap", "two files beside each other: the divider between them (it drags, --side-a and --side-b), the swap over it", () => <FileViewer style={{ ...box(50), height: "calc(15 * var(--u-space))", position: "relative", display: "flex", "--side-a": "1", "--side-b": "1" }}>
          <File focused /><FileDivider role="separator" aria-label="Resize the sides" style={{ left: "50%" }} /><FileSwap aria-label="Swap the sides" style={{ left: "calc(50% - var(--control-xs) / 2)" }}><Icons.Swap /></FileSwap><File />
        </FileViewer>, { surfaces: ["ground"], code: "<FileViewer><FileView /><FileDivider /><FileSwap /><FileView /></FileViewer>" }),
    row("FileEmptySide · FileEmpty", "a side opened empty, waiting for a file", () => <FileViewer style={{ ...box(25), height: "calc(10 * var(--u-space))", display: "flex" }}><FileEmptySide><FileHead><strong class="g-file-none">No file open</strong></FileHead><FileEmpty role="status">Open a file from Files to show it here.</FileEmpty></FileEmptySide></FileViewer>, { surfaces: ["ground"], code: "<FileEmptySide><FileHead /><FileEmpty /></FileEmptySide>" }),
    row("FileChanges · FileScope · Rest", "a file's changes in its column: the comparison (Editor › Comparison), its scope quiet beside the name; focused, it takes the wash. The app mounts CodeMirror where the text stands", () => <div style={box(37.5)}><FileChanges focused={false}><ComparisonSample scope="Changes" /></FileChanges></div>, { surfaces: ["ground"], phone: true, code: "<FileChanges focused><Comparison><FileHead><FileName /><FileScope /></FileHead>…</Comparison></FileChanges>" }),
    row("FileChanges · FileScope · Focused", "a file's changes in its column: the comparison (Editor › Comparison), its scope quiet beside the name; focused, it takes the wash. The app mounts CodeMirror where the text stands", () => <div style={box(37.5)}><FileChanges focused={true}><ComparisonSample scope="Changes" /></FileChanges></div>, { surfaces: ["ground"], phone: true, code: "<FileChanges focused><Comparison><FileHead><FileName /><FileScope /></FileHead>…</Comparison></FileChanges>" }),
    row("FileMedia", "audio, video or a PDF filling the file's remaining space (here an audio player with no source)", () => <FileView style={{ ...box(30), height: "calc(10 * var(--u-space))" }}><Head /><FileMedia><audio controls preload="none" aria-label="sample.mp3" /></FileMedia></FileView>, { surfaces: ["ground"], phone: true, code: "<FileMedia><audio controls /></FileMedia>" }),
    row("FileSuffix", "what the host adds to the header, with the actions (here a pane's “Turn 3”)", () => <div style={box(30)}><FileHead><FileName path="src/greet.ts" icon={<Icons.FileCode />} /><FileSuffix><FileScope>Turn 3</FileScope></FileSuffix><FileButton label="Close file" close><Icons.Close /></FileButton></FileHead></div>, { surfaces: ["ground"], phone: true, code: "<FileSuffix>{headerSuffix}</FileSuffix>" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--space-sm", "small spacing"),
    token("--space-xs", "small gaps"),
    token("--tint", "surface wash and lines"),
    token("--icon-sm", "small icons"),
    token("--foreground", "text and icons"),
    token("--muted-foreground", "secondary text")
  ] }],
  api: ["FileViewer", "FileView", "FileHead", "FileName", "FileGit", "FileDirty", "FileActions", "FileButton", "FileTools", "FileMore", "FileSuffix", "FileScope", "FileBody", "FileImage", "FileCard", "Button", "FileMedia", "StatusBar", "StatusPicker", "StatusText", "FileDivider", "FileSwap", "FileEmptySide", "FileEmpty", "FileChanges", "Comparison", "ComparisonContent", "CodeHost", "ComparisonSource", "TurnNavigation", "ComparisonCounts"],
};

export const editorPage: Page = { title: "Editor", summary: "The code surface a file's body holds (CodeMirror draws inside it): framed while editable, its find bar above, a line comment's popup over it, and a comparison's counts and turn steps in the status bar. The review's navigator (DiffShell) is the Panes family's Source control.", rail: "Blocks",
  preview: () => <div style={box(45)}><ComparisonSample /></div>,
  usage: `import { CodeSurface, SearchBar, SearchField, SearchActions, CodeContent, CodeHost } from "@/components/ui/editor";
import { FileButton } from "@/components/ui/file";
import { Icons } from "@/components/ui";

<CodeSurface editable>
  <SearchBar>
    <SearchField placeholder="Find" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
    <SearchActions><FileButton label="Close find" onClick={closeFind}><Icons.Close /></FileButton></SearchActions>
  </SearchBar>
  <CodeContent><CodeHost ref={mountEditor} /></CodeContent>
</CodeSurface>`,
  anatomy: { scene: () => <div style={box(45)}><ComparisonSample /></div>, parts: [
    { selector: ".ui-file-head", name: "Header", does: "names the compared file", from: "FileHead" },
    { selector: ".ui-comparison-content", name: "Content", does: "holds the comparison", from: "ComparisonContent" },
    { selector: ".ui-status-bar", name: "Status", does: "holds the source, turns and line counts", from: "StatusBar" }
  ] },
  examples: [
    row("CodeSurface · CodeHost · Read-only", "read-only, then editable: the hairline ring says you can type", () => <div style={{ ...box(30), height: "calc(9 * var(--u-space))", display: "flex" }}><CodeSurface editable={false}><CodeContent><CodeHost><Code /></CodeHost></CodeContent></CodeSurface></div>, { surfaces: ["ground"], phone: true, code: "<CodeSurface editable><CodeContent><CodeHost /></CodeContent></CodeSurface>" }),
    row("CodeSurface · CodeHost · Editable", "read-only, then editable: the hairline ring says you can type", () => <div style={{ ...box(30), height: "calc(9 * var(--u-space))", display: "flex" }}><CodeSurface editable={true}><CodeContent><CodeHost><Code /></CodeHost></CodeContent></CodeSurface></div>, { surfaces: ["ground"], phone: true, code: "<CodeSurface editable><CodeContent><CodeHost /></CodeContent></CodeSurface>" }),
    row("SearchBar · SearchField · SearchActions", "find and replace over the code: two fields, then previous, next and close", () => <div style={box(37.5)}><SearchBar><SearchField placeholder="Find" value="greet" /><SearchField placeholder="Replace" /><SearchActions><FileButton label="Previous match"><Icons.ArrowUp /></FileButton><FileButton label="Next match"><Icons.ArrowDown /></FileButton><FileButton label="Close find"><Icons.Close /></FileButton></SearchActions></SearchBar></div>, { surfaces: ["ground"], phone: true, code: "<SearchBar><SearchField /><SearchActions /></SearchBar>" }),
    row("AnnotationPopup · AnnotationInput · AnnotationButton", "a comment on the selected lines, before it goes to the chat", () => <div style={{ ...box(30), height: "calc(7 * var(--u-space))", position: "relative" }}><AnnotationPopup style={{ left: "var(--space-md)", top: "var(--space-md)" }}><AnnotationInput placeholder="Comment on lines 1–2" rows={2} /><AnnotationButton>Add</AnnotationButton></AnnotationPopup></div>, { surfaces: ["ground"], phone: true, code: "<AnnotationPopup><AnnotationInput /><AnnotationButton /></AnnotationPopup>" }),
    row("ComparisonCounts · TurnNavigation", "a comparison's removed and added lines, and the turn it compares", () => <div style={box(37.5)}><StatusBar label="Comparison" commands={<TurnNavigation><StatusPicker icon={<Icons.ChevronDown />}>Turn 3</StatusPicker></TurnNavigation>}><ComparisonCounts><span>−4</span><span>+12</span></ComparisonCounts></StatusBar></div>, { surfaces: ["ground"], phone: true, code: "<ComparisonCounts><span /><span /></ComparisonCounts>" }),
    row("Comparison · ComparisonContent · ComparisonSource · TurnNavigation · ComparisonCounts", "a turn's change to one file; the status bar leads with the source picker, older/newer turn and the endpoints. Static text where the app mounts CodeMirror", () => <div style={box(45)}><ComparisonSample /></div>, { surfaces: ["ground"], code: "<Comparison><FileHead /><ComparisonContent><CodeHost comparison /></ComparisonContent><StatusBar commands={<ComparisonSource />} /></Comparison>" }),
    row("DiffShell · SplitEdge · DiffBody · Rest", "the navigator open: changed files (stand-in here; Panes › Source control draws the real one), the edge that resizes it, then the comparison", () => <div style={{ ...box(55), height: "calc(15 * var(--u-space))", display: "flex" }}><DiffShell width={160}><PaneEmpty>Changed files</PaneEmpty><SplitEdge resizing={false} aria-label="Resize changed files" /><DiffBody><ComparisonSample /></DiffBody></DiffShell></div>, { surfaces: ["ground"], code: "<DiffShell width><navigator /><SplitEdge resizing /><DiffBody /></DiffShell>" }),
    row("DiffShell · SplitEdge · DiffBody · Resizing", "the navigator open: changed files (stand-in here; Panes › Source control draws the real one), the edge that resizes it, then the comparison", () => <div style={{ ...box(55), height: "calc(15 * var(--u-space))", display: "flex" }}><DiffShell width={160}><PaneEmpty>Changed files</PaneEmpty><SplitEdge resizing={true} aria-label="Resize changed files" /><DiffBody><ComparisonSample /></DiffBody></DiffShell></div>, { surfaces: ["ground"], code: "<DiffShell width><navigator /><SplitEdge resizing /><DiffBody /></DiffShell>" }),
    row("DiffShell collapsed · DiffRail", "the navigator folded to its rail: one button opens it again", () => <div style={{ ...box(55), height: "calc(15 * var(--u-space))", display: "flex" }}><DiffShell collapsed width={160}><DiffRail><FileButton label="Show changed files"><Icons.ExpandFiles /></FileButton></DiffRail><DiffBody><ComparisonSample /></DiffBody></DiffShell></div>, { surfaces: ["ground"], code: "<DiffShell collapsed><DiffRail><FileButton /></DiffRail><DiffBody /></DiffShell>" }),
    row("DiffBody · nothing chosen", "the comparison column before a file is picked", () => <div style={{ ...box(55), height: "calc(8 * var(--u-space))", display: "flex" }}><DiffShell collapsed width={160}><DiffRail><FileButton label="Show changed files"><Icons.ExpandFiles /></FileButton></DiffRail><DiffBody><PaneEmpty>Select a changed file.</PaneEmpty></DiffBody></DiffShell></div>, { surfaces: ["ground"], code: "<DiffBody><PaneEmpty /></DiffBody>" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--border", "boundary lines"),
    token("--space-md", "medium spacing"),
    token("--hairline", "spacing and size"),
    token("--radius-control", "control corners"),
    token("--space-xs", "small gaps"),
    token("--space-2xs", "smallest gaps")
  ] }],
  api: ["CodeSurface", "SearchBar", "SearchField", "SearchActions", "FileButton", "CodeContent", "CodeHost", "AnnotationPopup", "AnnotationInput", "AnnotationButton", "DiffShell", "SplitEdge", "DiffRail", "DiffBody", "PaneEmpty", "Comparison", "FileHead", "FileName", "FileScope", "FileTools", "ComparisonContent", "StatusBar", "ComparisonSource", "StatusPicker", "TurnNavigation", "StatusText", "ComparisonCounts", "CodeExcerpt"],
};

export const browserPage: Page = { title: "Browser", summary: "The file browser (the Computer page and the folder picker): a sidebar of places beside a main column of toolbar, actions and the folder's entries, as tiles or details. Composed here from its pieces with made-up entries.", rail: "Blocks",
  preview: () => <Assembled />,
  usage: `import { Browser, BrowserLayout, BrowserSidebar, BrowserHeading, BrowserPlace, BrowserDivider, BrowserMain, BrowserToolbar, BrowserAddress, BrowserGrid, BrowserEntry } from "@/components/ui/browser";
import { Icons } from "@/components/ui";

<Browser sidebarWidth={sidebarWidth()}>
  <BrowserLayout>
    <BrowserSidebar><BrowserHeading>Locations</BrowserHeading><BrowserPlace onClick={goHome}><Icons.Home />Home</BrowserPlace></BrowserSidebar>
    <BrowserDivider role="separator" aria-label="Resize locations sidebar" onPointerDown={resizeSidebar} />
    <BrowserMain>
      <BrowserToolbar><BrowserAddress value={path()} onChange={changePath} /></BrowserToolbar>
      <BrowserGrid data-view="tiles"><BrowserEntry onDblClick={openFolder}><Icons.Folder /><span>Conduit</span></BrowserEntry></BrowserGrid>
    </BrowserMain>
  </BrowserLayout>
</Browser>`,
  anatomy: { scene: () => <Assembled />, parts: [
    { selector: ".ui-browser-sidebar", name: "Places", does: "lists locations and workspaces", from: "BrowserSidebar" },
    { selector: ".ui-browser-divider", name: "Divider", does: "resizes the sidebar", from: "BrowserDivider" },
    { selector: ".ui-browser-main", name: "Main", does: "holds the toolbar, actions and entries", from: "BrowserMain" }
  ] },
  examples: [
    row("Browser · BrowserLayout", "places at the left (BrowserHeading over BrowserPlace rows, workspaces in BrowserPlaces), the divider that resizes them, then the main column", () => <Assembled />, { surfaces: ["ground"], code: "<Browser sidebarWidth><BrowserLayout><BrowserSidebar /><BrowserDivider /><BrowserMain /></BrowserLayout></Browser>" }),
    row("Browser compact", "the folder picker's form, inside a dialog", () => <Assembled compact />, { surfaces: ["ground"], code: "<Browser compact sidebarWidth>" }),
    row("BrowserToolbar · BrowserAddress · BrowserSearch · BrowserCount", "home and parent, the folder's path (editable), search in this folder, view and refresh, then how many items", () => <div style={box(45)}><Toolbar /></div>, { phone: true, code: "<BrowserToolbar><Button /><BrowserAddress /><BrowserSearch><Input /></BrowserSearch><BrowserCount /></BrowserToolbar>" }),
    row("BrowserMachine", "leads the toolbar when there is more than one machine to browse: which one, opening the menu of them", () => <div style={box(45)}><BrowserToolbar>
      <BrowserMachine type="button" aria-label="Machine"><Icons.Monitor /><span>Laptop · Windows</span><Icons.ChevronDown /></BrowserMachine>
      <Button variant="ghost" type="button" aria-label="Home folder"><Icons.Home /></Button>
      <Button variant="ghost" type="button" aria-label="Parent folder"><Icons.ArrowUp /></Button>
      <BrowserAddress aria-label="Folder path" value="C:\\Users\\jask\\Projects" />
    </BrowserToolbar></div>, { phone: true, code: "<BrowserToolbar><DropdownMenu.Trigger as={BrowserMachine}><Icon /><span /><Icons.ChevronDown /></DropdownMenu.Trigger>…</BrowserToolbar>" }),
    row("BrowserActions · BrowserSummary · BrowserSpacer", "the repository this folder is in, a spacer, then what opens here", () => <div style={box(45)}><Actions /></div>, { phone: true, code: "<BrowserActions><BrowserSummary /><BrowserSpacer /><Button /></BrowserActions>" }),
    row("BrowserGrid tiles · BrowserEntry · BrowserMark", "folders first, then files; Conduit is a workspace (the mark)", () => <Pane><Grid /></Pane>, { surfaces: ["ground"], phone: true, code: '<BrowserGrid data-view="tiles"><BrowserEntry><Icon /><span /><BrowserMark /></BrowserEntry></BrowserGrid>' }),
    row("BrowserGrid details · BrowserColumns", "the same entries with type, size and dates under column names", () => <Pane><Grid details /></Pane>, { surfaces: ["ground"], phone: true, code: '<BrowserGrid data-view="details"><BrowserColumns /><BrowserEntry>…<small /></BrowserEntry></BrowserGrid>' }),
    row("BrowserEmpty", "nothing in the folder, or nothing matches the search", () => <Pane><Grid><BrowserEmpty>This folder is empty.</BrowserEmpty></Grid></Pane>, { surfaces: ["ground"], phone: true, code: "<BrowserGrid><BrowserEmpty /></BrowserGrid>" }),
    row("BrowserLoading", "the listing on its way (the grid is busy under it)", () => <Pane><BrowserGrid data-view="tiles" aria-busy="true" /><BrowserLoading>Loading…</BrowserLoading></Pane>, { surfaces: ["ground"], phone: true, code: "<BrowserLoading />" }),
    row("BrowserError", "the folder could not be listed; above the entries", () => <Pane><BrowserError>Permission denied: /root</BrowserError><Grid><BrowserEmpty>This folder is empty.</BrowserEmpty></Grid></Pane>, { surfaces: ["ground"], phone: true, code: "<BrowserError />" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--space-xs", "small gaps"),
    token("--space-sm", "small spacing"),
    token("--icon", "icon size"),
    token("--muted-foreground", "secondary text"),
    token("--text-caption", "caption text size"),
    token("--measure-xs", "spacing and size")
  ] }],
  api: ["Browser", "BrowserLayout", "BrowserSidebar", "BrowserHeading", "BrowserPlace", "BrowserPlaces", "BrowserDivider", "BrowserMain", "BrowserToolbar", "BrowserMachine", "Button", "BrowserAddress", "BrowserSearch", "Input", "BrowserCount", "BrowserActions", "BrowserSummary", "BrowserSpacer", "BrowserGrid", "BrowserColumns", "BrowserEntry", "BrowserMark", "BrowserEmpty", "BrowserLoading", "BrowserError"],
};

export const filesPages = (): Page[] => [filesPage, editorPage, browserPage];
