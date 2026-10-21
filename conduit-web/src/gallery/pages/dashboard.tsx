import { GroupCompactHeading } from "@/components/ui";
import { Icons } from "@/components/ui";
import { Segmented } from "@/components/ui";
import { FormTable, form, States } from "../specs";
import { NavGroup as GNavGroup, NavRow as GNavRow } from "@/components/ui";
import { Dashboard, DashHeader, QuickActions, QuickAction, QuickMore, DashIconButton, GroupHeading, GroupToggle, GroupSwitches, Group, GroupAction, DashDay, DashMore, DashRow, ChangeRow, Counts, DashEmpty, DashNote, DashPath, FolderShelf, FolderTile } from "@/components/ui/dashboard";
import { type Family, lib } from "../model";

export const dashboardFamily: Family = { title: "Dashboard", note: "a place's page: a header, quick actions and composer, with chats beside projects and workspaces", rail: "Blocks",
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
  api: ["Dashboard", "DashHeader", "DashPath", "QuickActions", "QuickAction", "QuickMore", "DashIconButton", "Group", "GroupHeading", "GroupCompactHeading", "GroupToggle", "GroupSwitches", "Segmented", "GroupAction", "DashDay", "DashRow", "ChangeRow", "Counts", "DashMore", "DashEmpty", "DashNote", "FolderShelf", "FolderTile", "NavGroup", "NavRow"],
  groups: [
    { title: "Compact heading", note: "GroupCompactHeading: the chats list's heading on a phone -- the choice it shows, its count, and where", layout: "phone", atoms: [
      lib("dash-compact-heading", "GroupCompactHeading", "phone", "dashboard", "components/ui/dashboard.tsx · dashboard/primitives/chat-list.tsx", () => <FormTable rows={[
        form("GroupCompactHeading", "label, count and where", () => <GroupCompactHeading label="Unread" count={3} where="in Japan" />, "<GroupCompactHeading label count where />"),
        form("GroupCompactHeading · label only", "no count, no place", () => <GroupCompactHeading label="All chats" />, "<GroupCompactHeading label />"),
      ]} on={["phone"]} stacked />, "row"),
    ] },
    { title: "Forms", note: "each piece and state at each density", layout: "desktop", atoms: [
      lib("dash-forms", "Dashboard · forms", "both", "dashboard", "components/ui/dashboard.tsx", () => <FormTable rows={[
        form("GroupHeading · the two section roles", "the strong one for dashboards and big lists; the quiet one for menus, Settings and the sidebar (Paper Mono capitals on both layouts, at each one's unit)", () => <div class="g-row g-top"><GroupHeading count={4}>Projects</GroupHeading><GNavGroup label="Projects"><GNavRow icon={<Icons.Folder />}>Japan</GNavRow></GNavGroup></div>, "<GroupHeading count> · <NavGroup label>"),
        form("GroupToggle", "open and shut", () => <States states={["Open", "Shut"] as const}>{(state) => <GroupToggle open={state() === "Open"} count={4} onClick={() => {}}>Projects</GroupToggle>}</States>, "<GroupToggle open count onClick>"),
        form("Group", "switches and actions above chats, with a day and more below", () => <Group id="g-chats" labelled section="chats" heading={<GroupSwitches><span id="g-chats"><Segmented label="Show" value="all" onChange={() => {}} options={[{ value: "all", label: "All", count: 3 }, { value: "unread", label: "Unread", count: 0 }]} /></span></GroupSwitches>} actions={<GroupAction>Filters</GroupAction>}>
          <DashDay>Today</DashDay>
          <DashRow element="button" lead={<Icons.Chat />} primary="Plan the trip" context="Japan" trailing="2d" />
          <DashRow element="button" lead={<Icons.Chat />} primary="Fix the build" context="Conduit" trailing="3d" />
          <DashRow element="button" lead={<Icons.Chat />} primary="Review the changes" context="Website" trailing="4d" />
          <DashMore count={12} onClick={() => {}}>Show more</DashMore>
        </Group>, "<Group labelled section heading actions> · <DashDay> · <DashRow> · <DashMore count>"),
        form("DashRow · ChangeRow · Counts", "modified and added files with line counts", () => <div><ChangeRow icon={<Icons.FileCode />} name="dashboard.tsx" directory="components/ui" added={24} removed={8} status="M" /><ChangeRow icon={<Icons.FileText />} name="notes.md" directory="docs" added={12} removed={0} status="A" /><Counts added={36} removed={8} /></div>, "<ChangeRow icon name directory added removed status> · <Counts added removed>"),
        form("DashPath", "a place's working path in its header's context: a tap copies it, and it says Copied for a moment", () => <States states={["Rest", "Copied"] as const}>{(state) => <DashPath path="~/Conduit" copied={state() === "Copied"} onCopy={() => {}} />}</States>, "<DashPath path copied onCopy />", "--font-data --text-caption · brightens on hover or focus"),
        form("DashEmpty · DashNote", "an empty list, a note and an error", () => <div><DashEmpty>No chats</DashEmpty><DashNote>Choose a project to start.</DashNote><DashNote error>Could not load projects.</DashNote></div>, "<DashEmpty> · <DashNote error>"),
        form("FolderShelf · FolderTile", "four projects, one live, and a new project action", () => <FolderShelf all><FolderTile name="Conduit" meta="3 chats" live /><FolderTile name="Japan" meta="2 chats" /><FolderTile name="Website" meta="1 chat" /><FolderTile name="Notes" meta="No chats" /><FolderTile name="New project" icon={<Icons.NewFolder />} /></FolderShelf>, "<FolderShelf all> · <FolderTile name meta live icon>"),
      ]} on={["desktop", "phone"]} />, "row"),
    ] },
    { title: "Assembled", note: "a page with chats beside projects and workspaces", layout: "desktop", atoms: [
      lib("dash-page", "Dashboard · a page", "desktop", "dashboard", "dashboard/primitives/split.tsx", () => <div style={{ width: "1100px", height: "640px", display: "flex" }}><Dashboard label="Conduit"
        head={<DashHeader title="Conduit" context={["Nothing running"]} />}
        actions={<QuickActions><QuickAction icon={<Icons.Terminal />} label="Terminal" onClick={() => {}} /><QuickMore keep><DashIconButton aria-label="More" /></QuickMore></QuickActions>}
        composer={<div class="g-slot">Composer</div>}
        list={<Group id="g-page-chats" labelled section="chats" order="list" heading={<GroupSwitches><span id="g-page-chats"><Segmented label="Show" value="all" onChange={() => {}} options={[{ value: "all", label: "All", count: 6 }, { value: "unread", label: "Unread", count: 0 }]} /></span></GroupSwitches>} actions={<GroupAction>Filters</GroupAction>}>
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
        aside={<><Group id="g-page-projects" labelled section="projects" heading={<GroupHeading id="g-page-projects" count={4}>Projects</GroupHeading>}><FolderShelf all><FolderTile name="Conduit" meta="3 chats" live /><FolderTile name="Japan" meta="2 chats" /><FolderTile name="Website" meta="1 chat" /><FolderTile name="Notes" meta="No chats" /><FolderTile name="New project" icon={<Icons.NewFolder />} /></FolderShelf></Group>
          <Group id="g-page-workspaces" labelled section="workspaces" heading={<GroupHeading id="g-page-workspaces" count={2}>Workspaces</GroupHeading>}><DashRow element="button" lead={<Icons.Folder />} primary="Main" context="Conduit" trailing="2d" /><DashRow element="button" lead={<Icons.Folder />} primary="Travel" context="Japan" trailing="3d" /></Group></>}
      /></div>, true),
    ] },
  ] };
