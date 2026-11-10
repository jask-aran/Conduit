import { createSignal } from "solid-js";
import { Button, Icons, StatusText, Switch, Workbench, WorkbenchFact, WorkbenchPick, WorkbenchSplit, WorkbenchTitle, Row, Group, Actions, IconButton, Heading } from "@/components/ui";
import { Select } from "@/components/ui/menus";
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
      head={<><Heading kind="editor">Assistant</Heading><Actions kind="editor">
        <IconButton kind="file" label="Edit"><Icons.Edit /></IconButton><IconButton kind="file" label="Move up" disabled><Icons.ArrowUp /></IconButton><IconButton kind="file" label="Move down"><Icons.ArrowDown /></IconButton>
        <Select look="icon" icon={<Icons.Swap />} search="Search blocks" aria-label="Swap for another block" title="Swap for another block" value=""><option value="">Swap</option><option value="naming">Chat naming</option></Select>
        <IconButton kind="file" label="Remove"><Icons.Close /></IconButton></Actions></>}
      status={<StatusText>40 tok</StatusText>} />} />
  </Workbench></div>;
}
/** Settings › Blocks and Skills: every thing of the kind in the side column, the chosen one's name the title, its
 *  facts under the list and its pane alone in the main column. */
const THINGS = [{ id: "run", name: "Run rules", context: "0.6k tok · changed", group: "jbot's files" }, { id: "base", name: "Shared base", context: "0.5k tok", group: "Shipped" }, { id: "assistant", name: "Assistant", context: "26 tok", group: "Shipped" }];
function BlocksBench() {
  const [text, setText] = createSignal(TEXT);
  const [chosen, setChosen] = createSignal("run");
  const [on, setOn] = createSignal(true);
  return <div class="g-workbench"><Workbench label="Blocks">
    <WorkbenchTitle title={THINGS.find((item) => item.id === chosen())!.name} meta="changed"
      actions={<Button variant="ghost" size="icon-sm" aria-label="New block"><Icons.Add /></Button>} />
    <WorkbenchSplit
      side={<>
        <Group kind="workbench" title="jbot's files">{THINGS.filter((item) => item.group !== "Shipped").map((item) => <WorkbenchPick name={item.name} context={item.context} current={chosen() === item.id} onSelect={() => setChosen(item.id)}><Switch label={`${item.name} on`} checked={on()} onChange={setOn} /></WorkbenchPick>)}</Group>
        <Group kind="workbench" title="Shipped">{THINGS.filter((item) => item.group === "Shipped").map((item) => <WorkbenchPick name={item.name} context={item.context} current={chosen() === item.id} onSelect={() => setChosen(item.id)} />)}</Group>
      </>}
      facts={<>
        <Group kind="workbench" title="Used in"><Row density="nav" element="button" lead={<Icons.Clock />} end={<Icons.ChevronRight />}>Heartbeat</Row><Row density="nav" element="button" lead={<Icons.Clock />} end={<Icons.ChevronRight />}>Morning brief</Row></Group>
        <Group kind="workbench" title="Slots it can use"><WorkbenchFact code name="{{person.name}}" value="Jask" /><WorkbenchFact code name="{{timezone}}" value="Australia/Sydney" /></Group>
      </>}
      main={<TextEditor fill label="Run rules text" value={text()} onChange={setText}
        head={<><Heading kind="editor">Text</Heading><Actions kind="editor"><Button variant="primary" size="sm">Save</Button><IconButton kind="file" label="Reset"><Icons.Reset /></IconButton></Actions></>}
        status={<><StatusText>{`${Math.round(text().length / 4)} tok`}</StatusText><StatusText>jbot's file: jbot can change it too</StatusText></>} />} />
  </Workbench></div>;
}

export const workbenchPage: Page = {
  title: "Workbench",
  summary: "A page that works on one thing at a time: its title is the thing, the split below fills the page's height -- a side column that scrolls on its own, and one pane filling the main column with its actions in its bar and its facts in its foot -- so the page never scrolls. A page of many things of one kind (Blocks, Skills) lists them all in the side column as picks, the chosen one's facts under them; a page on one thing made of parts (Prompts) chooses the thing from its title.",
  preview: () => <BlocksBench />,
  usage: `import { Workbench, WorkbenchTitle, WorkbenchSplit, Group, WorkbenchFact, Note, Heading, Actions } from "@/components/ui";
import { TextEditor } from "@/components/ui/text-editor"; // CodeMirror: imported on its own, never from the barrel

<Workbench label="Blocks">
  <WorkbenchTitle title={chosen.name} actions={…} meta="changed" />
  <WorkbenchSplit
    side={<Group kind="workbench" title="Shipped"><WorkbenchPick name="Shared base" context="0.5k tok" current onSelect={…}>{/* its switch */}</WorkbenchPick>…</Group>}
    facts={<Group kind="workbench" title="Used in">…</Group>}
    main={<TextEditor fill head={…} status={…} … />} />
</Workbench>`,
  examples: [
    row("prompts", "Settings › Prompts: the document as the title, its chain in the side column, the chosen block read-only in the pane with its actions in the pane's bar", () => <PromptsBench />, { surfaces: ["frost"] }),
    row("blocks", "Settings › Blocks and Skills: every one in the side column as a WorkbenchPick (a click chooses it; its switch beside it, never inside), the chosen one's name the title, where it is used and the slots it can use under the list (WorkbenchSplit facts), its text edited in the pane (Save in the bar, Mod-S)", () => <BlocksBench />, { surfaces: ["frost"] }),
  ],
  tokens: [{ title: "Workbench", tokens: [
    token("--measure-md", "The side column's basis (between --measure-sm and --measure-lg)"),
    token("--measure-xl", "The main column's basis; it takes the rest"),
    token("--space-xl", "Between the columns"),
    token("--text-heading", "The title select's size"),
  ] }],
  api: ["Workbench", "WorkbenchTitle", "WorkbenchSplit", "WorkbenchPick", "WorkbenchPair", "Group", "WorkbenchFact"],
};
