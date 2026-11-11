import { Icons, Item, Menu, Row, Section, StatusDot } from "@/components/ui";
import { row, token, type Page } from "../model";

const nav = () => <div data-surface="frame" class="g-nav-frame"><div class="ui-nav-list">
  <Row density="nav" element="button" lead={<Icons.Dashboard />}>At rest</Row>
  <Row density="nav" element="button" lead={<Icons.Chat />} current>Where you are</Row>
  <Row density="nav" element="button" lead={<Icons.Folder />} within>Holds where you are</Row>
  <Row density="nav" element="button" lead={<Icons.Chat />} open>Open beside</Row>
  <Row density="nav" element="button" lead={<Icons.Chat />} selected>Chosen</Row>
  <Row density="nav" element="button" lead={<Icons.Chat />} indent meta="3m">Under its folder</Row>
  <Row density="nav" element="button" lead={<Icons.Terminal />} detail="~/conduit · zsh" end={<StatusDot label="Running" tone="success" />}>A terminal</Row>
  <Row density="nav" element="button" quiet>View all</Row>
</div></div>;

const list = () => <div class="g-aside">
  <Row density="list" element="button" lead={<Icons.Chat />} label="Fix the build" context="Conduit" meta="12m" />
  <Row density="list" element="button" lead={<Icons.Folder />} label="Japan trip" context="3 chats" meta="2h" current />
  <Row density="list" element="button" label="No mark: its room is kept" context="so a column lines up" meta="1d" />
</div>;

const menu = () => <Menu class="g-w16"><Section title="Menu">
  <Item icon={<Icons.Copy />} keys={["Ctrl", "C"]}>Copy</Item>
  <Item icon={<Icons.Edit />} active>Rename</Item>
  <Item icon={<Icons.Delete />} destructive>Delete</Item>
</Section></Menu>;

export const rowPage: Page = {
  title: "Row",
  summary: "Every row is one: a mark, the title (a detail under it), muted context after it, data at its end and a control's room after that. The density sets its height, padding, voice and cursor: nav (the sidebar), list (a page's), menu (Item, a Row with a menu's own parts).",
  preview: () => <div class="g-stack">{nav()}{list()}</div>,
  usage: `import { Icons, Row } from "@/components/ui";

<Row density="nav" element="button" lead={<Icons.Chat />} current onClick={openChat}>Fix the build</Row>
<Row density="list" element="a" href={path} lead={<Icons.Folder />} label="Japan trip" context="3 chats" meta="2h" />`,
  examples: [
    row("nav", "the sidebar's: rest, current (the current weight), within, open beside, chosen, indented, with a detail and an end mark, quiet", nav, { source: "components/ui/row.tsx · styles/nav.css", surfaces: ["ground"], phone: true }),
    row("list", "a page's: the mark's and the context's room always kept, so a column lines up and its data sits at the end; current washes", list, { source: "components/ui/row.tsx · styles/dashboard.css", surfaces: ["ground"], phone: true }),
    row("menu", "Item: a Row in the menu density with a menu's parts (keys, chevron, checks)", menu, { source: "components/ui/popover.tsx · styles/popover.css", surfaces: ["ground"] }),
  ],
  tokens: [{ title: "Row", tokens: [
    token("--row-min", "A row's least height"),
    token("--row-gap", "Mark to title"),
    token("--row-inset", "A nav and list row's side padding"),
    token("--row-pad", "A menu row's padding"),
    token("--text-row", "A row's text"),
    token("--tone-rest", "Its tone at rest"),
  ] }],
  api: ["Row"],
};
