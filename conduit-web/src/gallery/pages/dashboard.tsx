import { HarnessMark } from "@/components/ui";
import { createUniqueId } from "solid-js";
import { GroupCompactHeading } from "@/components/ui";
import { Icons } from "@/components/ui";
import { Segmented } from "@/components/ui";
import { NavGroup as GNavGroup, NavRow as GNavRow } from "@/components/ui";
import { Dashboard, DashHeader, QuickActions, QuickAction, QuickMore, DashIconButton, GroupHeading, GroupToggle, GroupSwitches, Group, GroupAction, DashDay, DashMore, DashRow, ChangeRow, Counts, DashEmpty, DashNote, DashPath, FolderShelf, FolderTile } from "@/components/ui/dashboard";
import { row, token, type Page } from "../model";

const dashboardScene = () => {
  const id = createUniqueId();
  return <div style={{ width: "1100px", height: "640px", display: "flex" }}><Dashboard label="Conduit"
        head={<DashHeader title="Conduit" context={["Nothing running"]} />}
        actions={<QuickActions><QuickAction icon={<Icons.Terminal />} label="Terminal" onClick={() => {}} /><QuickMore keep><DashIconButton aria-label="More" /></QuickMore></QuickActions>}
        composer={<div class="g-slot">Composer</div>}
        list={<Group id={`${id}-g-page-chats`} labelled section="chats" order="list" heading={<GroupSwitches><span id={`${id}-g-page-chats`}><Segmented label="Show" value="all" onChange={() => {}} options={[{ value: "all", label: "All", count: 6 }, { value: "unread", label: "Unread", count: 0 }]} /></span></GroupSwitches>} actions={<GroupAction>Filters</GroupAction>}>
          <DashDay>Today</DashDay>
          <DashRow element="button" lead={<Icons.Chat />} primary="Plan the trip" context="Japan" trailing="2d" />
          <DashRow element="button" lead={<Icons.Chat />} primary="Fix the build" context="Conduit" trailing="3d" />
          <DashRow element="button" lead={<Icons.Chat />} primary="Review the changes" context="Website" trailing="4d" />
          <DashDay>Earlier</DashDay>
          <DashRow element="button" lead={<Icons.Chat />} primary="Choose a route" context="Japan" trailing="5d" />
          <DashRow element="button" lead={<Icons.Chat />} primary="Update the guide" context="Conduit" trailing="6d" />
          <DashRow element="button" lead={<Icons.Chat />} primary="Collect ideas" context="Notes" trailing="7d" />
          <DashMore count={12} onClick={() => {}}>Show more</DashMore>
        </Group>}
        aside={<><Group id={`${id}-g-page-projects`} labelled section="projects" heading={<GroupHeading id={`${id}-g-page-projects`} count={4}>Projects</GroupHeading>}><FolderShelf all><FolderTile name="Conduit" meta="3 chats" live /><FolderTile name="Japan" meta="2 chats" /><FolderTile name="Website" meta="1 chat" /><FolderTile name="Notes" meta="No chats" /><FolderTile name="New project" icon={<Icons.NewFolder />} /></FolderShelf></Group>
          <Group id={`${id}-g-page-workspaces`} labelled section="workspaces" heading={<GroupHeading id={`${id}-g-page-workspaces`} count={2}>Workspaces</GroupHeading>}><DashRow element="button" lead={<Icons.Folder />} primary="Main" context="Conduit" trailing="2d" /><DashRow element="button" lead={<Icons.Folder />} primary="Travel" context="Japan" trailing="3d" /></Group></>}
      /></div>;
};

export const dashboardPage: Page = {
  title: "Dashboard", rail: "Blocks",
  summary: "A place's page: a header, quick actions and composer, with chats beside projects and workspaces.",
  preview: dashboardScene,
  usage: `import { Dashboard, DashHeader, QuickActions, QuickAction, Group, GroupHeading, DashDay, DashRow, FolderShelf, FolderTile } from "@/components/ui/dashboard";
import { Icons } from "@/components/ui";

<Dashboard label="Conduit"
  head={<DashHeader title="Conduit" context={["Nothing running"]} />}
  actions={<QuickActions><QuickAction icon={<Icons.Terminal />} label="Terminal" onClick={openTerminal} /></QuickActions>}
  composer={composer()}
  list={<Group id="chats" heading={<GroupHeading>Chats</GroupHeading>}>
    <DashDay>Today</DashDay>
    <DashRow element="button" primary="Fix the build" context="Conduit" onClick={openChat} />
  </Group>}
  aside={<FolderShelf><FolderTile name="Conduit" meta="3 chats" /></FolderShelf>}
/>`,
  anatomy: { scene: dashboardScene, parts: [
    {selector: ".ui-dash-head",name: "Header",does: "names the place and holds quick actions",from: "DashHeader · QuickActions"},
    {selector: ".ui-dash-composer",name: "Composer",does: "holds the message composer",from: "Dashboard composer"},
    {selector: ".ui-dash-main > .ui-dash-group",name: "Chats",does: "lists chats by day",from: "Group · DashDay · DashRow"},
    {selector: ".ui-dash-aside",name: "Places",does: "holds projects and workspaces",from: "Dashboard aside"},
  ] },
  examples: [
    row("GroupCompactHeading", "label, count and where", () => <GroupCompactHeading label="Unread" count={3} where="in Japan" />, { source: "components/ui/dashboard.tsx · dashboard/primitives/chat-list.tsx", phone: "only", code: "<GroupCompactHeading label count where />" }),
    row("GroupCompactHeading · label only", "no count, no place", () => <GroupCompactHeading label="All chats" />, { phone: "only", code: "<GroupCompactHeading label />" }),
    row("GroupHeading · the two section roles", "the strong one for dashboards and big lists; the quiet one for menus, Settings and the sidebar (Paper Mono capitals on both layouts, at each one's unit)", () => <div class="g-row g-top"><GroupHeading count={4}>Projects</GroupHeading><GNavGroup label="Projects"><GNavRow icon={<Icons.Folder />}>Japan</GNavRow></GNavGroup></div>, { phone: true, code: "<GroupHeading count> · <NavGroup label>" }),
    row("GroupToggle · Open", "open and shut", () => <GroupToggle open={true} count={4} onClick={() => {}}>Projects</GroupToggle>, { phone: true, code: "<GroupToggle open count onClick>" }),
    row("GroupToggle · Shut", "open and shut", () => <GroupToggle open={false} count={4} onClick={() => {}}>Projects</GroupToggle>, { phone: true, code: "<GroupToggle open count onClick>" }),
    row("Group", "switches and actions above chats, with a day and more below", () => {
  const id = createUniqueId();
  return <Group id={`${id}-g-chats`} labelled section="chats" heading={<GroupSwitches><span id={`${id}-g-chats`}><Segmented label="Show" value="all" onChange={() => {}} options={[{ value: "all", label: "All", count: 3 }, { value: "unread", label: "Unread", count: 0 }]} /></span></GroupSwitches>} actions={<GroupAction>Filters</GroupAction>}>
          <DashDay>Today</DashDay>
          <DashRow element="button" lead={<Icons.Chat />} primary="Plan the trip" context="Japan" trailing="2d" />
          <DashRow element="button" lead={<Icons.Chat />} primary="Fix the build" context="Conduit" trailing="3d" />
          <DashRow element="button" lead={<Icons.Chat />} primary="Review the changes" context="Website" trailing="4d" />
          <DashMore count={12} onClick={() => {}}>Show more</DashMore>
        </Group>;
}, { phone: true, code: "<Group labelled section heading actions> · <DashDay> · <DashRow> · <DashMore count>" }),
    row("DashRow · ChangeRow · Counts", "modified and added files with line counts", () => <div><ChangeRow icon={<Icons.FileCode />} name="dashboard.tsx" directory="components/ui" added={24} removed={8} status="M" /><ChangeRow icon={<Icons.FileText />} name="notes.md" directory="docs" added={12} removed={0} status="A" /><Counts added={36} removed={8} /></div>, { phone: true, code: "<ChangeRow icon name directory added removed status> · <Counts added removed>" }),
    row("DashPath · Rest", "a place's working path in its header's context: a tap copies it, and it says Copied for a moment; --font-data --text-caption · brightens on hover or focus", () => <DashPath path="~/Conduit" copied={false} onCopy={() => {}} />, { phone: true, code: "<DashPath path copied onCopy />" }),
    row("DashPath · Copied", "a place's working path in its header's context: a tap copies it, and it says Copied for a moment; --font-data --text-caption · brightens on hover or focus", () => <DashPath path="~/Conduit" copied={true} onCopy={() => {}} />, { phone: true, code: "<DashPath path copied onCopy />" }),
    row("DashEmpty · DashNote", "an empty list, a note and an error", () => <div><DashEmpty>No chats</DashEmpty><DashNote>Choose a project to start.</DashNote><DashNote error>Could not load projects.</DashNote></div>, { phone: true, code: "<DashEmpty> · <DashNote error>" }),
    row("FolderTile · mark", "a thing's own mark in its colours in place of the folder: the hub's harnesses", () => <FolderShelf all><FolderTile name="Codex" meta="Ready" mark={<HarnessMark id="codex" artwork />} /><FolderTile name="Claude Code" meta="Ready" mark={<HarnessMark id="claude-code" artwork />} /><FolderTile name="ChatGPT Web" meta="Sign-in required" mark={<HarnessMark id="chatgpt-web" artwork />} /></FolderShelf>, { code: '<FolderTile name="Codex" meta="Ready" mark={<HarnessMark id="codex" artwork />} />' }),
    row("FolderShelf · FolderTile", "four projects, one live, and a new project action", () => <FolderShelf all><FolderTile name="Conduit" meta="3 chats" live /><FolderTile name="Japan" meta="2 chats" /><FolderTile name="Website" meta="1 chat" /><FolderTile name="Notes" meta="No chats" /><FolderTile name="New project" icon={<Icons.NewFolder />} /></FolderShelf>, { phone: true, code: "<FolderShelf all> · <FolderTile name meta live icon>" }),
    row("Dashboard · a page", "dashboard/primitives/split.tsx", dashboardScene, { source: "dashboard/primitives/split.tsx", surfaces: ["ground"] }),
  ],
  tokens: [{ title: "Its surface", tokens: [
    token("--dash-gap", "Space between columns"),
    token("--row-inset", "Row padding"),
    token("--muted-foreground", "Context text"),
    token("--border", "Section rules")
  ] }],
  api: ["Dashboard", "DashHeader", "DashPath", "QuickActions", "QuickAction", "QuickMore", "DashIconButton", "Group", "GroupHeading", "GroupCompactHeading", "GroupToggle", "GroupSwitches", "Segmented", "GroupAction", "DashDay", "DashRow", "ChangeRow", "Counts", "DashMore", "DashEmpty", "DashNote", "FolderShelf", "FolderTile", "NavGroup", "NavRow"],
};
