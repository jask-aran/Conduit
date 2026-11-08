import { Icons } from "@/components/ui";

import { FileView, FileViewer, FileName, FileGit, FileDirty, FileMore, StatusBar, StatusText, StatusPicker } from "@/components/ui/file";
import { FileSuffix } from "@/components/ui/file";
import { FileImage, FileCard, FileBody, FileSwap, FileEmptySide, FileChanges, FileMedia, FileScope } from "@/components/ui/viewer";
import { CodeSurface, CodeHost, CodeContent, AnnotationPopup, AnnotationInput, AnnotationButton, TurnNavigation, Comparison, ComparisonContent, ComparisonSource, DiffShell, DiffRail, DiffBody } from "@/components/ui/editor";
import { Button, Input, LeadInput } from "@/components/ui/controls";
import { Browser, BrowserLayout, BrowserSidebar, BrowserPlaces, BrowserPlace, BrowserMain, BrowserToolbar, BrowserAddress, BrowserCount, BrowserSummary, BrowserSpacer, BrowserGrid, BrowserEntry, BrowserMark, BrowserMachine, BrowserShelf } from "@/components/ui/browser";
import { ResizeEdge } from "@/components/ui/pane";
import { FolderShelf, FolderTile, LineCounts } from "@/components/ui/dashboard";
import { HarnessMark, Columns, Empty, Loading, Note, Actions, IconButton, PaneHeader, Heading } from "@/components/ui";
import { CaseSensitiveIcon, ListIcon, RegexIcon, ReplaceAllIcon, ReplaceIcon, WholeWordIcon } from "lucide-solid";
import { FindBar } from "@/components/ui/find";
import type { JSX } from "solid-js";

import { row, token, type Page } from "./model";

/*
 * Files and the editor (components/ui/file.tsx, viewer.tsx, editor.tsx): a file's header, body and status bar, the
 * viewer's two sides, and the code surface's find bar, line comments and comparison. PaneHeader fits the header (it sets
 * data-folded on what does not fit, lowest data-fold first), here as in the app.
 */

const SAMPLE = ["export function greet(name: string) {", "  return `Hello, ${name}`;", "}", "", "greet(\"Conduit\");"];
const Code = () => <pre class="g-file-code">{SAMPLE.map((line, index) => <span><i>{index + 1}</i>{line || " "}{"\n"}</span>)}</pre>;
// A sample fills its cell up to a width of its own.
const box = (units: number) => ({ width: "100%", "max-width": `calc(${units} * var(--u-space))` });

function Head(props: { dirty?: boolean; git?: string }) {
  return <PaneHeader kind="file">
    <FileName path="src/greet.ts" icon={<Icons.FileCode />} />
    {props.git ? <FileGit status={props.git} /> : null}
    <FileDirty dirty={Boolean(props.dirty)} />
    <Actions kind="file">
      <IconButton kind="file" label="Copy contents" data-fold="1"><Icons.Copy /></IconButton>
      <IconButton kind="file" label="Download" data-fold="2"><Icons.Download /></IconButton>
    </Actions>
    <Actions kind="tools">
      <IconButton kind="file" label="Find or replace" data-fold="3"><Icons.Search /></IconButton>
      <IconButton kind="file" label="Wrap lines" inMenu data-fold="4"><Icons.WrapText /></IconButton>
    </Actions>
    <FileMore aria-label="More file actions" />
    <IconButton kind="file" label="Close file" close><Icons.Close /></IconButton>
  </PaneHeader>;
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
  <PaneHeader kind="file"><FileName path="src/greet.ts" icon={<Icons.FileCode />} />{props.scope ? <FileScope>{props.scope}</FileScope> : null}<Actions kind="tools">
    <IconButton kind="file" label="Find in comparison"><Icons.Search /></IconButton><IconButton kind="file" label="Wrap lines"><Icons.WrapText /></IconButton><IconButton kind="file" label="Show side-by-side diff"><Icons.Split /></IconButton>
  </Actions></PaneHeader>
  <ComparisonContent data-layout="unified"><CodeHost comparison><Diff /></CodeHost></ComparisonContent>
  <StatusBar label="Comparison" commands={<ComparisonSource>
    <StatusPicker icon={<Icons.ChevronDown />}>This turn</StatusPicker>
    <TurnNavigation aria-label="Turn navigation"><IconButton kind="file" label="Older turn"><Icons.ChevronLeft /></IconButton><StatusPicker icon={<Icons.ChevronDown />}>Turn 3</StatusPicker><IconButton kind="file" label="Newer turn"><Icons.ChevronRight /></IconButton></TurnNavigation>
    <StatusText>a1b2c3d → working copy</StatusText>
  </ComparisonSource>}><LineCounts kind="bar" removed={1} added={1} /><StatusText>TypeScript · Read-only</StatusText></StatusBar>
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
  {props.details ? <Columns kind="browser"><span>Name</span><span>Type</span><span>Size</span><span>Created</span><span>Modified</span></Columns> : null}
  {props.children ?? <Entries details={props.details} />}
</BrowserGrid>;
const Toolbar = () => <BrowserToolbar>
  <Button variant="ghost" type="button" aria-label="Home folder"><Icons.Home /></Button>
  <Button variant="ghost" type="button" aria-label="Parent folder"><Icons.ArrowUp /></Button>
  <BrowserAddress aria-label="Folder path" value="/home/jask" />
  <LeadInput kind="browser" aria-label="Search this folder" placeholder="Search" />
  <Button variant="ghost" type="button" aria-label="Use details view"><ListIcon /></Button>
  <Button variant="ghost" type="button" aria-label="Refresh folder"><Icons.Refresh /></Button>
  <BrowserCount>{ENTRIES.length} items</BrowserCount>
</BrowserToolbar>;
const FolderActions = () => <Actions kind="browser">
  <BrowserSummary title="/home/jask/Conduit"><Icons.GitBranch />Conduit</BrowserSummary>
  <BrowserSpacer />
  <Button variant="ghost" type="button"><Icons.Terminal />Terminal Here</Button>
  <Button variant="ghost" type="button"><Icons.GitBranch />Source Control</Button>
</Actions>;
const Assembled = (props: { compact?: boolean; details?: boolean }) => <div style={{ height: "calc(22 * var(--u-space))", display: "flex" }}><Browser compact={props.compact} sidebarWidth={160}><BrowserLayout>
  <BrowserSidebar>
    <Heading kind="browser">Locations</Heading>
    <BrowserPlace type="button" data-active><Icons.Home /><span>Home</span></BrowserPlace>
    <Heading kind="browser">Workspaces</Heading>
    <BrowserPlaces><BrowserPlace type="button"><Icons.Workspace /><span>Conduit</span></BrowserPlace><BrowserPlace type="button"><Icons.Workspace /><span>Japan</span></BrowserPlace></BrowserPlaces>
  </BrowserSidebar>
  <ResizeEdge kind="browser" aria-label="Resize locations sidebar" />
  <BrowserMain><Toolbar /><FolderActions /><Grid details={props.details} /></BrowserMain>
</BrowserLayout></Browser></div>;
const Pane = (props: { children: JSX.Element }) => <div style={{ ...box(45), position: "relative", display: "flex", "flex-direction": "column", "min-height": "calc(12 * var(--u-space))" }}><BrowserMain>{props.children}</BrowserMain></div>;

export const filesPage: Page = { title: "Files", summary: "A file in a pane or the dock: its header (name, git letter, unsaved dot, actions and tools, the ⋯ they fold into, close), its body, and the status bar at its foot. Two files side by side share a viewer with a divider and a swap. The app measures the header and folds actions into the ⋯ lowest data-fold first; the tab row (Panes) replaces the name when a pane holds tabs.", rail: "Blocks",
  preview: () => <div style={box(30)}><File /></div>,
  usage: `import { FileViewer, FileView, PaneHeader, FileName, FileGit, FileDirty, Actions, IconButton, StatusBar, StatusPicker, StatusText } from "@/components/ui/file";
import { FileBody } from "@/components/ui/viewer";
import { Icons } from "@/components/ui";

<FileViewer><FileView focused>
  <PaneHeader>
    <FileName path="src/main.tsx" icon={<Icons.FileCode />} />
    <FileGit status="M" /><FileDirty dirty={dirty()} />
    <Actions><IconButton label="Copy contents" onClick={copyFile}><Icons.Copy /></IconButton></Actions>
    <IconButton label="Close file" close onClick={closeFile}><Icons.Close /></IconButton>
  </PaneHeader>
  <FileBody editing>{editor()}</FileBody>
  <StatusBar commands={<StatusPicker strong>Edit</StatusPicker>}><StatusText>TypeScript</StatusText></StatusBar>
</FileView></FileViewer>`,
  anatomy: { scene: () => <div style={box(30)}><File /></div>, parts: [
    { selector: ".ui-pane-header[data-header=file]", name: "Header", does: "holds the file name, actions and tools", from: "PaneHeader" },
    { selector: ".ui-file-body", name: "Body", does: "holds the file content", from: "FileBody" },
    { selector: ".ui-status-bar", name: "Status", does: "shows the file mode and details", from: "StatusBar" }
  ] },
  examples: [
    row("PaneHeader · FileName · FileGit · FileDirty", "a modified file with unsaved changes: the git letter, then the dot", () => <div style={box(30)}><Head git="M" dirty /></div>, { surfaces: ["ground"], phone: true, code: "<PaneHeader><FileName path icon /><FileGit status /><FileDirty dirty />…</PaneHeader>" }),
    row("Actions · Actions · IconButton", "everything fits: copy and download, then find and wrap; close last; --control-tool buttons · --icon-sm", () => <div style={box(30)}><Head /></div>, { surfaces: ["ground"], phone: true, code: '<IconButton label data-fold="1" />' }),
    row("FileMore · data-folded", "too narrow: the actions fold into the ⋯, lowest data-fold first (shown by the viewer once anything folds)", () => <FileViewer style={{ ...box(14), height: "auto" }}><FileView><Head /></FileView></FileViewer>, { surfaces: ["ground"], phone: true, code: "PaneHeader kind=\"file\" sets data-folded on each folded button" }),
    row("StatusBar · StatusPicker · StatusText · Viewing", "the mode picker leads with its mark (Edit, or Preview while editing); pickers end with a chevron; details at the right; --text-caption", () => <div style={box(37.5)}><Status editing={false} /></div>, { surfaces: ["ground"], phone: true, code: "<StatusBar commands={<StatusPicker strong icon />}><StatusText /></StatusBar>" }),
    row("StatusBar · StatusPicker · StatusText · Editing", "the mode picker leads with its mark (Edit, or Preview while editing); pickers end with a chevron; details at the right; --text-caption", () => <div style={box(37.5)}><Status editing={true} /></div>, { surfaces: ["ground"], phone: true, code: "<StatusBar commands={<StatusPicker strong icon />}><StatusText /></StatusBar>" }),
    row("FileView · FileBody · Rest", "a text file; focused, its header takes the wash", () => <div style={box(30)}><File focused={false} /></div>, { surfaces: ["ground"], phone: true, code: "<FileView focused><PaneHeader /><FileBody /><StatusBar /></FileView>" }),
    row("FileView · FileBody · Focused", "a text file; focused, its header takes the wash", () => <div style={box(30)}><File focused={true} /></div>, { surfaces: ["ground"], phone: true, code: "<FileView focused><PaneHeader /><FileBody /><StatusBar /></FileView>" }),
    row("FileImage", "an image on its checker ground, contained", () => <div style={{ ...box(22), height: "calc(12.5 * var(--u-space))", display: "flex" }}><FileImage><Icons.Image style={{ width: "calc(6 * var(--u-space))", height: "calc(6 * var(--u-space))" }} /></FileImage></div>, { surfaces: ["ground"], phone: true, code: "<FileImage><img /></FileImage>" }),
    row("FileCard", "a file the viewer cannot show: its kind, its size, and an action", () => <div style={{ ...box(22), display: "flex" }}><FileCard><Icons.FileText /><strong>archive.zip</strong><span>2.4 MB · application/zip</span><Button size="sm" variant="secondary"><Icons.Download />Download</Button></FileCard></div>, { surfaces: ["ground"], phone: true, code: "<FileCard><strong /><span /><Button /></FileCard>" }),
    row("FileViewer · ResizeEdge · FileSwap", "two files beside each other: the divider between them (it drags, --side-a and --side-b), the swap over it", () => <FileViewer style={{ ...box(50), height: "calc(15 * var(--u-space))", position: "relative", display: "flex", "--side-a": "1", "--side-b": "1" }}>
          <File focused /><ResizeEdge kind="sides" aria-label="Resize the sides" style={{ left: "50%" }} /><FileSwap aria-label="Swap the sides" style={{ left: "calc(50% - var(--control-xs) / 2)" }}><Icons.Swap /></FileSwap><File />
        </FileViewer>, { surfaces: ["ground"], code: "<FileViewer><FileView /><ResizeEdge kind=\"sides\" /><FileSwap /><FileView /></FileViewer>" }),
    row("FileEmptySide · Empty", "a side opened empty, waiting for a file", () => <FileViewer style={{ ...box(25), height: "calc(10 * var(--u-space))", display: "flex" }}><FileEmptySide><PaneHeader kind="file"><strong class="g-file-none">No file open</strong></PaneHeader><Empty kind="file" role="status">Open a file from Files to show it here.</Empty></FileEmptySide></FileViewer>, { surfaces: ["ground"], code: "<FileEmptySide><PaneHeader /><Empty /></FileEmptySide>" }),
    row("FileChanges · FileScope · Rest", "a file's changes in its column: the comparison (Editor › Comparison), its scope quiet beside the name; focused, it takes the wash. The app mounts CodeMirror where the text stands", () => <div style={box(37.5)}><FileChanges focused={false}><ComparisonSample scope="Changes" /></FileChanges></div>, { surfaces: ["ground"], phone: true, code: "<FileChanges focused><Comparison><PaneHeader><FileName /><FileScope /></PaneHeader>…</Comparison></FileChanges>" }),
    row("FileChanges · FileScope · Focused", "a file's changes in its column: the comparison (Editor › Comparison), its scope quiet beside the name; focused, it takes the wash. The app mounts CodeMirror where the text stands", () => <div style={box(37.5)}><FileChanges focused={true}><ComparisonSample scope="Changes" /></FileChanges></div>, { surfaces: ["ground"], phone: true, code: "<FileChanges focused><Comparison><PaneHeader><FileName /><FileScope /></PaneHeader>…</Comparison></FileChanges>" }),
    row("FileMedia", "audio, video or a PDF filling the file's remaining space (here an audio player with no source)", () => <FileView style={{ ...box(30), height: "calc(10 * var(--u-space))" }}><Head /><FileMedia><audio controls preload="none" aria-label="sample.mp3" /></FileMedia></FileView>, { surfaces: ["ground"], phone: true, code: "<FileMedia><audio controls /></FileMedia>" }),
    row("FileSuffix", "what the host adds to the header, with the actions (here a pane's “Turn 3”)", () => <div style={box(30)}><PaneHeader kind="file"><FileName path="src/greet.ts" icon={<Icons.FileCode />} /><FileSuffix><FileScope>Turn 3</FileScope></FileSuffix><IconButton kind="file" label="Close file" close><Icons.Close /></IconButton></PaneHeader></div>, { surfaces: ["ground"], phone: true, code: "<FileSuffix>{headerSuffix}</FileSuffix>" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--space-sm", "small spacing"),
    token("--space-xs", "small gaps"),
    token("--tint", "surface wash and lines"),
    token("--icon-sm", "small icons"),
    token("--foreground", "text and icons"),
    token("--muted-foreground", "secondary text")
  ] }],
  api: ["FileViewer", "FileView", "PaneHeader", "FileName", "FileGit", "FileDirty", "Actions", "IconButton", "FileMore", "FileSuffix", "FileScope", "FileBody", "FileImage", "FileCard", "Button", "FileMedia", "StatusBar", "StatusPicker", "StatusText", "FileDivider", "FileSwap", "FileEmptySide", "Empty", "FileChanges", "Comparison", "ComparisonContent", "CodeHost", "ComparisonSource", "TurnNavigation", "LineCounts"],
};

export const editorPage: Page = { title: "Editor", summary: "The code surface a file's body holds (CodeMirror draws inside it): framed while editable, its find bar above, a line comment's popup over it, and a comparison's counts and turn steps in the status bar. The review's navigator (DiffShell) is the Panes family's Source control.", rail: "Blocks",
  preview: () => <div style={box(45)}><ComparisonSample /></div>,
  usage: `import { CodeSurface, CodeContent, CodeHost } from "@/components/ui/editor";
import { FindBar } from "@/components/ui/find";

<CodeSurface editable>
  <FindBar plain label="Find" query={query()} onQuery={setQuery} onNext={next} onPrevious={previous} onEscape={closeFind} onClose={closeFind} />
  <CodeContent><CodeHost ref={mountEditor} /></CodeContent>
</CodeSurface>`,
  anatomy: { scene: () => <div style={box(45)}><ComparisonSample /></div>, parts: [
    { selector: ".ui-pane-header[data-header=file]", name: "Header", does: "names the compared file", from: "PaneHeader" },
    { selector: ".ui-comparison-content", name: "Content", does: "holds the comparison", from: "ComparisonContent" },
    { selector: ".ui-status-bar", name: "Status", does: "holds the source, turns and line counts", from: "StatusBar" }
  ] },
  examples: [
    row("CodeSurface · CodeHost · Read-only", "read-only, then editable: the hairline ring says you can type", () => <div style={{ ...box(30), height: "calc(9 * var(--u-space))", display: "flex" }}><CodeSurface editable={false}><CodeContent><CodeHost><Code /></CodeHost></CodeContent></CodeSurface></div>, { surfaces: ["ground"], phone: true, code: "<CodeSurface editable><CodeContent><CodeHost /></CodeContent></CodeSurface>" }),
    row("CodeSurface · CodeHost · Editable", "read-only, then editable: the hairline ring says you can type", () => <div style={{ ...box(30), height: "calc(9 * var(--u-space))", display: "flex" }}><CodeSurface editable={true}><CodeContent><CodeHost><Code /></CodeHost></CodeContent></CodeSurface></div>, { surfaces: ["ground"], phone: true, code: "<CodeSurface editable><CodeContent><CodeHost /></CodeContent></CodeSurface>" }),
    row("FindBar · plain", "find and replace over the code: the find field, replace, the toggles, then previous, next and close", () => <div style={box(46.875)}><FindBar plain label="Find" query="greet" onQuery={() => {}} onNext={() => {}} onPrevious={() => {}} onEscape={() => {}} onClose={() => {}}><LeadInput kind="tool" lead={<ReplaceIcon />} placeholder="Replace" /><IconButton kind="tool" label="Match case" aria-pressed={false}><CaseSensitiveIcon /></IconButton><IconButton kind="tool" label="Use regular expression" aria-pressed={false}><RegexIcon /></IconButton><IconButton kind="tool" label="Match whole word" aria-pressed={false}><WholeWordIcon /></IconButton><IconButton kind="tool" label="Replace next match"><ReplaceIcon /></IconButton><IconButton kind="tool" label="Replace all matches"><ReplaceAllIcon /></IconButton></FindBar></div>, { surfaces: ["ground"], phone: true, code: "<FindBar plain><LeadInput /><IconButton /></FindBar>" }),
    row("AnnotationPopup · AnnotationInput · AnnotationButton", "a comment on the selected lines, before it goes to the chat", () => <div style={{ ...box(30), height: "calc(7 * var(--u-space))", position: "relative" }}><AnnotationPopup style={{ left: "var(--space-md)", top: "var(--space-md)" }}><AnnotationInput placeholder="Comment on lines 1–2" rows={2} /><AnnotationButton>Add</AnnotationButton></AnnotationPopup></div>, { surfaces: ["ground"], phone: true, code: "<AnnotationPopup><AnnotationInput /><AnnotationButton /></AnnotationPopup>" }),
    row("LineCounts · TurnNavigation", "a comparison's removed and added lines, and the turn it compares", () => <div style={box(37.5)}><StatusBar label="Comparison" commands={<TurnNavigation><StatusPicker icon={<Icons.ChevronDown />}>Turn 3</StatusPicker></TurnNavigation>}><LineCounts kind="bar" removed={4} added={12} /></StatusBar></div>, { surfaces: ["ground"], phone: true, code: "<LineCounts><span /><span /></LineCounts>" }),
    row("Comparison · ComparisonContent · ComparisonSource · TurnNavigation · LineCounts", "a turn's change to one file; the status bar leads with the source picker, older/newer turn and the endpoints. Static text where the app mounts CodeMirror", () => <div style={box(45)}><ComparisonSample /></div>, { surfaces: ["ground"], code: "<Comparison><PaneHeader /><ComparisonContent><CodeHost comparison /></ComparisonContent><StatusBar commands={<ComparisonSource />} /></Comparison>" }),
    row("DiffShell · ResizeEdge · DiffBody · Rest", "the navigator open: changed files (stand-in here; Panes › Source control draws the real one), the edge that resizes it, then the comparison", () => <div style={{ ...box(55), height: "calc(15 * var(--u-space))", display: "flex" }}><DiffShell width={160}><Empty>Changed files</Empty><ResizeEdge kind="split" aria-label="Resize changed files" /><DiffBody><ComparisonSample /></DiffBody></DiffShell></div>, { surfaces: ["ground"], code: "<DiffShell width><navigator /><ResizeEdge kind=\"split\" startDrag /><DiffBody /></DiffShell>" }),
    row("DiffShell · ResizeEdge · DiffBody · Resizing", "the navigator open: changed files (stand-in here; Panes › Source control draws the real one), the edge that resizes it, then the comparison", () => <div style={{ ...box(55), height: "calc(15 * var(--u-space))", display: "flex" }}><DiffShell width={160}><Empty>Changed files</Empty><ResizeEdge kind="split" data-resizing="" aria-label="Resize changed files" /><DiffBody><ComparisonSample /></DiffBody></DiffShell></div>, { surfaces: ["ground"], code: "<DiffShell width><navigator /><ResizeEdge kind=\"split\" startDrag /><DiffBody /></DiffShell>" }),
    row("DiffShell collapsed · DiffRail", "the navigator folded to its rail: one button opens it again", () => <div style={{ ...box(55), height: "calc(15 * var(--u-space))", display: "flex" }}><DiffShell collapsed width={160}><DiffRail><IconButton kind="file" label="Show changed files"><Icons.ExpandFiles /></IconButton></DiffRail><DiffBody><ComparisonSample /></DiffBody></DiffShell></div>, { surfaces: ["ground"], code: "<DiffShell collapsed><DiffRail><IconButton /></DiffRail><DiffBody /></DiffShell>" }),
    row("DiffBody · nothing chosen", "the comparison column before a file is picked", () => <div style={{ ...box(55), height: "calc(8 * var(--u-space))", display: "flex" }}><DiffShell collapsed width={160}><DiffRail><IconButton kind="file" label="Show changed files"><Icons.ExpandFiles /></IconButton></DiffRail><DiffBody><Empty>Select a changed file.</Empty></DiffBody></DiffShell></div>, { surfaces: ["ground"], code: "<DiffBody><Empty /></DiffBody>" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--border", "boundary lines"),
    token("--space-md", "medium spacing"),
    token("--hairline", "spacing and size"),
    token("--radius-control", "control corners"),
    token("--space-xs", "small gaps"),
    token("--space-2xs", "smallest gaps")
  ] }],
  api: ["CodeSurface", "FindBar", "LeadInput", "IconButton", "CodeContent", "CodeHost", "AnnotationPopup", "AnnotationInput", "AnnotationButton", "DiffShell", "ResizeEdge", "DiffRail", "DiffBody", "Empty", "Comparison", "PaneHeader", "FileName", "FileScope", "Actions", "ComparisonContent", "StatusBar", "ComparisonSource", "StatusPicker", "TurnNavigation", "StatusText", "LineCounts", "CodeExcerpt"],
};

export const browserPage: Page = { title: "Browser", summary: "The file browser (the Computer page and the folder picker): a sidebar of places beside a main column of toolbar, actions and the folder's entries, as tiles or details. Composed here from its pieces with made-up entries.", rail: "Blocks",
  preview: () => <Assembled />,
  usage: `import { Browser, BrowserLayout, BrowserSidebar, Heading, BrowserPlace, ResizeEdge, BrowserMain, BrowserToolbar, BrowserAddress, BrowserGrid, BrowserEntry } from "@/components/ui/browser";
import { Icons } from "@/components/ui";

<Browser sidebarWidth={sidebarWidth()}>
  <BrowserLayout>
    <BrowserSidebar><Heading>Locations</Heading><BrowserPlace onClick={goHome}><Icons.Home />Home</BrowserPlace></BrowserSidebar>
    <ResizeEdge kind="browser" aria-label="Resize locations sidebar" startDrag={resizeSidebar} />
    <BrowserMain>
      <BrowserToolbar><BrowserAddress value={path()} onChange={changePath} /></BrowserToolbar>
      <BrowserGrid data-view="tiles"><BrowserEntry onDblClick={openFolder}><Icons.Folder /><span>Conduit</span></BrowserEntry></BrowserGrid>
    </BrowserMain>
  </BrowserLayout>
</Browser>`,
  anatomy: { scene: () => <Assembled />, parts: [
    { selector: ".ui-browser-sidebar", name: "Places", does: "lists locations and workspaces", from: "BrowserSidebar" },
    { selector: ".ui-resize-edge", name: "Edge", does: "resizes the sidebar", from: "ResizeEdge" },
    { selector: ".ui-browser-main", name: "Main", does: "holds the toolbar, actions and entries", from: "BrowserMain" }
  ] },
  examples: [
    row("Browser · BrowserLayout", "places at the left (Heading over BrowserPlace rows, workspaces in BrowserPlaces), the divider that resizes them, then the main column", () => <Assembled />, { surfaces: ["ground"], code: "<Browser sidebarWidth><BrowserLayout><BrowserSidebar /><BrowserDivider /><BrowserMain /></BrowserLayout></Browser>" }),
    row("Browser compact", "the folder picker's form, inside a dialog", () => <Assembled compact />, { surfaces: ["ground"], code: "<Browser compact sidebarWidth>" }),
    row("BrowserToolbar · BrowserAddress · LeadInput · BrowserCount", "home and parent, the folder's path (editable), search in this folder, view and refresh, then how many items", () => <div style={box(45)}><Toolbar /></div>, { phone: true, code: "<BrowserToolbar><Button /><BrowserAddress /><LeadInput><Input /></LeadInput><BrowserCount /></BrowserToolbar>" }),
    row("BrowserShelf", "above the browser on the hub's page: its harnesses, each opening its own page", () => <div style={box(45)}><BrowserShelf label="Harnesses"><FolderShelf all><FolderTile name="Codex" meta="Ready" mark={<HarnessMark id="codex" artwork />} /><FolderTile name="OpenCode" meta="Unavailable" mark={<HarnessMark id="opencode" artwork />} /></FolderShelf></BrowserShelf></div>, { phone: true, code: '<BrowserShelf label="Harnesses"><FolderShelf all><FolderTile mark /></FolderShelf></BrowserShelf>' }),
    row("BrowserMachine", "leads the toolbar when there is more than one machine to browse: which one, opening the menu of them", () => <div style={box(45)}><BrowserToolbar>
      <BrowserMachine type="button" aria-label="Machine"><Icons.Monitor /><span>Laptop · Windows</span><Icons.ChevronDown /></BrowserMachine>
      <Button variant="ghost" type="button" aria-label="Home folder"><Icons.Home /></Button>
      <Button variant="ghost" type="button" aria-label="Parent folder"><Icons.ArrowUp /></Button>
      <BrowserAddress aria-label="Folder path" value="C:\\Users\\jask\\Projects" />
    </BrowserToolbar></div>, { phone: true, code: "<BrowserToolbar><DropdownMenu.Trigger as={BrowserMachine}><Icon /><span /><Icons.ChevronDown /></DropdownMenu.Trigger>…</BrowserToolbar>" }),
    row("Actions · BrowserSummary · BrowserSpacer", "the repository this folder is in, a spacer, then what opens here", () => <div style={box(45)}><FolderActions /></div>, { phone: true, code: "<Actions><BrowserSummary /><BrowserSpacer /><Button /></Actions>" }),
    row("BrowserGrid tiles · BrowserEntry · BrowserMark", "folders first, then files; Conduit is a workspace (the mark)", () => <Pane><Grid /></Pane>, { surfaces: ["ground"], phone: true, code: '<BrowserGrid data-view="tiles"><BrowserEntry><Icon /><span /><BrowserMark /></BrowserEntry></BrowserGrid>' }),
    row("BrowserGrid details · Columns", "the same entries with type, size and dates under column names", () => <Pane><Grid details /></Pane>, { surfaces: ["ground"], phone: true, code: '<BrowserGrid data-view="details"><Columns /><BrowserEntry>…<small /></BrowserEntry></BrowserGrid>' }),
    row("Empty", "nothing in the folder, or nothing matches the search", () => <Pane><Grid><Empty kind="browser">This folder is empty.</Empty></Grid></Pane>, { surfaces: ["ground"], phone: true, code: "<BrowserGrid><Empty /></BrowserGrid>" }),
    row("Loading", "the listing on its way (the grid is busy under it)", () => <Pane><BrowserGrid data-view="tiles" aria-busy="true" /><Loading kind="browser">Loading…</Loading></Pane>, { surfaces: ["ground"], phone: true, code: "<Loading />" }),
    row("Note", "the folder could not be listed; above the entries", () => <Pane><Note kind="browser">Permission denied: /root</Note><Grid><Empty kind="browser">This folder is empty.</Empty></Grid></Pane>, { surfaces: ["ground"], phone: true, code: "<Note />" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--space-xs", "small gaps"),
    token("--space-sm", "small spacing"),
    token("--icon", "icon size"),
    token("--muted-foreground", "secondary text"),
    token("--text-caption", "caption text size"),
    token("--measure-xs", "spacing and size")
  ] }],
  api: ["Browser", "BrowserLayout", "BrowserSidebar", "Heading", "BrowserPlace", "BrowserPlaces", "ResizeEdge", "BrowserMain", "BrowserShelf", "BrowserToolbar", "BrowserMachine", "Button", "BrowserAddress", "LeadInput", "Input", "BrowserCount", "Actions", "BrowserSummary", "BrowserSpacer", "BrowserGrid", "Columns", "BrowserEntry", "BrowserMark", "Empty", "Loading", "Note"],
};

export const filesPages = (): Page[] => [filesPage, editorPage, browserPage];
