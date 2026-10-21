import { HarnessMark, Icons, MARKS, NavRow, ThreadHarnessMark } from "@/components/ui";
import { FileTypeIcon, FolderTypeIcon } from "@/components/ui/file-marks";
import { FormTable, form } from "./specs";

/** File counts cover map consumers in src, excluding this catalogue. */
const vocabulary: [keyof typeof Icons, string, number][] = [
  ["Add", "Add an item or open creation options.", 6],
  ["ArrowDown", "Download, move downward or reach recent content.", 4],
  ["ArrowUp", "Move upward or publish changes.", 4],
  ["Attach", "Attach files to a message.", 3],
  ["Back", "Return to the previous view.", 3],
  ["Backspace", "Delete text before the cursor.", 2],
  ["Boxes", "A collection or grouped identity.", 0],
  ["Camera", "Capture a photo attachment.", 2],
  ["Chat", "A chat or its messages.", 6],
  ["Check", "A selected, successful or completed state.", 7],
  ["ChevronDown", "Expand a choice or move to the next match.", 15],
  ["ChevronLeft", "Return to the previous item.", 4],
  ["ChevronRight", "Open a child item or move forward.", 11],
  ["Close", "Close or dismiss the current surface.", 19],
  ["Code", "Run a script or show code.", 2],
  ["CollapseFiles", "Collapse the file navigation.", 3],
  ["Compact", "Compact the chat context.", 1],
  ["Copy", "Copy content to the clipboard.", 10],
  ["Dashboard", "The application dashboard.", 3],
  ["Delete", "Delete the selected item.", 12],
  ["Download", "Download a file or update.", 7],
  ["Edit", "Edit or rename the selected item.", 16],
  ["ExpandFiles", "Expand the file navigation.", 2],
  ["ExternalLink", "Open a destination outside the current view.", 4],
  ["Fetch", "Fetch content from the web.", 2],
  ["File", "A file with no more specific type.", 3],
  ["FileCode", "A source file, file path or source view.", 4],
  ["FileDiff", "File changes or an unstaged diff.", 6],
  ["FileText", "A text file, prompt or document view.", 6],
  ["Focus", "Give keyboard focus to the terminal.", 2],
  ["Folder", "A folder or workspace location.", 13],
  ["GitBranch", "A source-control branch.", 2],
  ["GitCompareArrows", "Review source-control changes.", 5],
  ["Hide", "Hide content from view.", 2],
  ["Home", "The home directory or home view.", 2],
  ["Image", "An image file or attachment.", 2],
  ["InsertText", "Insert or edit text at the cursor.", 2],
  ["Keyboard", "Keyboard input and shortcuts.", 4],
  ["LocalModel", "A model hosted on this machine.", 1],
  ["LogOut", "Sign out of the server.", 3],
  ["Maximize", "Expand a pane or attachment.", 6],
  ["Message", "A message or agent narration.", 3],
  ["Microphone", "Microphone.", 3],
  ["Minimize", "Restore a pane to its smaller size.", 2],
  ["Monitor", "This computer or display appearance.", 4],
  ["More", "Additional actions for this item.", 7],
  ["MoveToFolder", "Move a chat into a folder.", 3],
  ["NewChat", "Start a new chat.", 5],
  ["NewFolder", "Create a folder.", 5],
  ["Notification", "An agent notification.", 1],
  ["Permissions", "Agent permissions and approval policy.", 4],
  ["Pin", "Keep an item in place.", 3],
  ["PinOff", "Release a pinned item.", 3],
  ["Play", "Continue or start an operation.", 3],
  ["Preview", "View content or show a preview.", 5],
  ["Proceed", "Confirm a location or sign in.", 2],
  ["Profile", "A harness profile or grouped profiles.", 3],
  ["QrCode", "Scan or show a pairing code.", 4],
  ["Reasoning", "Reasoning controls or thinking content.", 2],
  ["Refresh", "Refresh, retry, reload or regenerate.", 8],
  ["Reset", "Reset a value or restart an action.", 2],
  ["Runtime", "Runtime activity and status.", 2],
  ["Search", "Find content, commands or items.", 18],
  ["Send", "Send a message.", 3],
  ["Server", "A connected server.", 2],
  ["ServiceLevel", "The model service level.", 1],
  ["Settings", "Application, workspace and terminal settings.", 6],
  ["Share", "Share a chat or its link.", 2],
  ["Shell", "A shell command or terminal tool.", 3],
  ["Sidebar", "Show or hide the left sidebar.", 5],
  ["Split", "Show two panes or comparison columns.", 8],
  ["Stop", "Stop the current operation.", 5],
  ["Swap", "Swap pane or comparison sides.", 3],
  ["Terminal", "A terminal, command or command palette.", 11],
  ["Thinking", "Agent thinking or reasoning.", 2],
  ["Tool", "A tool without a more specific kind.", 2],
  ["Undo", "Undo an edit or discard changes.", 4],
  ["Upload", "Upload a file.", 2],
  ["Warning", "A warning or failed operation.", 3],
  ["Workspace", "Show or hide the workspace panel.", 6],
  ["WorkspaceIdentity", "Edit the workspace identity.", 3],
  ["WrapText", "Toggle line wrapping.", 5],
  ["WriteFile", "A file-writing tool.", 2],
];

export function IconsFoundation() {
  return <>
    <h2>Icon map</h2>
    <p>Each concept has one glyph; the file count shows how many source files use the map entry.</p>
    <FormTable on={["ground"]} rows={vocabulary.map(([key, meaning, files]) => {
      const Icon = Icons[key];
      return form(key, meaning, () => <Icon />, `<Icons.${key} />`, `${files} files`);
    })} />
    <h2>Harness marks</h2>
    <p>Each harness shows its tinted mark, available artwork, and lively form that lights with its row.</p>
    <FormTable on={["ground"]} rows={Object.entries(MARKS).map(([id, mark]) => form(id,
      mark.artwork ? "Tinted · artwork · lively" : "Tinted · lively",
      () => <div class="g-row"><HarnessMark id={id} />{mark.artwork && <HarnessMark id={id} artwork />}<NavRow icon={<ThreadHarnessMark id={id} lively />}>{id}</NavRow></div>))} />
    <h2>File types</h2>
    <p>File names select material icons; folders show their closed and open forms.</p>
    <FormTable on={["ground"]} rows={[
      ...["index.ts", "App.vue", "Page.svelte", "README.md", "package.json", "photo.png", "notes.xyz"].map((name) =>
        form(name, "File type", () => <FileTypeIcon name={name} />)),
      ...["src", "node_modules", "docs"].map((name) =>
        form(name, "Closed · open", () => <div class="g-row"><FolderTypeIcon name={name} expanded={false} /><FolderTypeIcon name={name} expanded /></div>)),
    ]} />
  </>;
}
