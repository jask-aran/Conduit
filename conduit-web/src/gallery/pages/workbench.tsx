import { createSignal } from "solid-js";
import { Button, FileButton, Icons, StatusText, TextEditorActions, TextEditorTitle, Workbench, WorkbenchFact, WorkbenchNote, WorkbenchSplit, WorkbenchTitle, Row, Group } from "@/components/ui";
import { Select } from "@/components/menus";
import { TextEditor } from "@/components/ui/text-editor";
import { row, token, type Page } from "../model";
import { documentChain } from "./network";

const TEXT = "# {{assistant.name}}\n\nYou are {{person.name}}'s assistant. Your persona is in `<soul>` below.\n\n## Where you speak\n\n- **The home thread** never ends.\n- **Side threads** are for one project.\n";

/** Settings › Prompts: the document as the title, its chain beside the chosen block's pane. */
function PromptsBench() {
  const [doc, setDoc] = createSignal("assistant");
  return <div class="g-workbench"><Workbench label="Prompts">
    <WorkbenchTitle meta="Profile · starts each of its chats"
      title={<Select look="title" search="Search documents" aria-label="Document" value={doc()} onChange={(event) => setDoc(event.currentTarget.value)}><option value="assistant">Assistant</option><option value="agent">jbot</option><option value="heartbeat">Heartbeat</option></Select>}
      actions={<Button variant="ghost" size="icon-sm" aria-label="Reset to its default blocks" disabled><Icons.Reset /></Button>} />
    <WorkbenchSplit side={documentChain()} main={<TextEditor fill readOnly label="Assistant text" value={TEXT}
      head={<><TextEditorTitle>Assistant</TextEditorTitle><TextEditorActions>
        <FileButton label="Edit"><Icons.Edit /></FileButton><FileButton label="Move up" disabled><Icons.ArrowUp /></FileButton><FileButton label="Move down"><Icons.ArrowDown /></FileButton>
        <Select look="icon" icon={<Icons.Swap />} search="Search blocks" aria-label="Swap for another block" title="Swap for another block" value=""><option value="">Swap</option><option value="naming">Chat naming</option></Select>
        <FileButton label="Remove"><Icons.Close /></FileButton></TextEditorActions></>}
      status={<StatusText>40 tok</StatusText>} />} />
  </Workbench></div>;
}
/** Settings › Blocks: the block as the title, its facts beside its editable pane. */
function BlocksBench() {
  const [text, setText] = createSignal(TEXT);
  return <div class="g-workbench"><Workbench label="Blocks">
    <WorkbenchTitle meta="jbot's file · changed"
      title={<Select look="title" search="Search blocks" aria-label="Block" value="run"><option value="run">Run rules</option><option value="base">Shared base</option></Select>}
      actions={<Button variant="ghost" size="icon-sm" aria-label="New block"><Icons.Add /></Button>} />
    <WorkbenchSplit side={<>
      <Group kind="workbench" title="Used in"><Row density="nav" element="button" lead={<Icons.Clock />} end={<Icons.ChevronRight />}>Heartbeat</Row><Row density="nav" element="button" lead={<Icons.Clock />} end={<Icons.ChevronRight />}>Morning brief</Row></Group>
      <Group kind="workbench" title="Slots it can use"><WorkbenchFact code name="{{person.name}}" value="Jask" /><WorkbenchFact code name="{{timezone}}" value="Australia/Sydney" /></Group>
      <Group kind="workbench" title="Conduit then adds"><WorkbenchNote>The run's routine, then what woke it.</WorkbenchNote></Group>
    </>} main={<TextEditor fill label="Run rules text" value={text()} onChange={setText}
      head={<><TextEditorTitle>Text</TextEditorTitle><TextEditorActions><Button variant="primary" size="sm">Save</Button><FileButton label="Reset"><Icons.Reset /></FileButton></TextEditorActions></>}
      status={<><StatusText>{`${Math.round(text().length / 4)} tok`}</StatusText><StatusText>jbot's file: jbot can change it too</StatusText></>} />} />
  </Workbench></div>;
}

export const workbenchPage: Page = {
  title: "Workbench",
  summary: "A page that works on one thing at a time: its title is the thing (pressing it chooses another), the split below fills the page's height -- a side column that scrolls on its own, and one pane filling the main column with its actions in its bar and its facts in its foot -- so the page never scrolls.",
  preview: () => <BlocksBench />,
  usage: `import { Workbench, WorkbenchTitle, WorkbenchSplit, Group, WorkbenchFact, WorkbenchNote, TextEditorTitle, TextEditorActions } from "@/components/ui";
import { TextEditor } from "@/components/ui/text-editor"; // CodeMirror: imported on its own, never from the barrel

<Workbench label="Blocks">
  <WorkbenchTitle title={<Select look="title" …/>} actions={…} meta="shipped" />
  <WorkbenchSplit side={<Group kind="workbench" title="Used in">…</Group>}
    main={<TextEditor fill head={…} status={…} … />} />
</Workbench>`,
  examples: [
    row("prompts", "Settings › Prompts: the document as the title, its chain in the side column, the chosen block read-only in the pane with its actions in the pane's bar", () => <PromptsBench />, { surfaces: ["frost"] }),
    row("blocks", "Settings › Blocks: the block as the title, where it is used and the slots it can use beside it, its text edited in the pane (Save in the bar, Mod-S), tokens and source in the foot", () => <BlocksBench />, { surfaces: ["frost"] }),
  ],
  tokens: [{ title: "Workbench", tokens: [
    token("--measure-md", "The side column's basis (between --measure-sm and --measure-lg)"),
    token("--measure-xl", "The main column's basis; it takes the rest"),
    token("--space-xl", "Between the columns"),
    token("--text-heading", "The title select's size"),
  ] }],
  api: ["Workbench", "WorkbenchTitle", "WorkbenchSplit", "Group", "WorkbenchFact"],
};
