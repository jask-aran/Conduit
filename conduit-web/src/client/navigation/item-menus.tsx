import { Icons } from "@/components/ui";
import { Show, type JSX } from "solid-js";
import { LoaderCircleIcon } from "lucide-solid";
import { MenuRow, MenuSection } from "@/components/menus";
import type { ChatSummary, Project } from "../api/contracts";
import { isWorkspace } from "../chat/place-picker";
import { COMMAND_IDS, commandLabel } from "../commands/command-registry";
import { isConduitManagedProject } from "./sidebar-preferences";

/*
 * The menus a chat and a place (a project or a workspace) open, wherever their rows are (the sidebar, the
 * dashboards): the same rows in the same order, the caller binding what each does.
 */

/** Pin to the sidebar, or unpin. */
const PinRow = (props: { pinned: boolean; onToggle: () => void }) =>
  <MenuRow icon={props.pinned ? <Icons.PinOff /> : <Icons.Pin />} onSelect={props.onToggle}>{props.pinned ? "Unpin" : "Pin to sidebar"}</MenuRow>;

/** A chat's menu. pin: absent where a chat cannot be pinned; openBeside, stop: absent where they do not apply. */
export function ChatMenuItems(props: {
  project: Project;
  onRename: () => void; onCopy: () => void; onOpenBeside?: () => void; onOpenTerminal: () => void;
  onStop?: () => void; pin?: { pinned: boolean; onToggle: () => void }; onDelete: () => void;
}) {
  return <>
    <MenuSection>
      <MenuRow icon={<Icons.Edit />} onSelect={props.onRename}>{commandLabel(COMMAND_IDS.renameChat)}</MenuRow>
      <MenuRow icon={<Icons.Copy />} onSelect={props.onCopy}>{commandLabel(COMMAND_IDS.copyTranscript)}</MenuRow>
      <Show when={props.onOpenBeside}><MenuRow icon={<Icons.Split />} onSelect={() => props.onOpenBeside?.()}>Open beside</MenuRow></Show>
      <MenuRow icon={<Icons.Terminal />} onSelect={props.onOpenTerminal}>Open terminal</MenuRow>
      <Show when={props.onStop}><MenuRow icon={<Icons.Stop />} onSelect={() => props.onStop?.()}>Stop process</MenuRow></Show>
      <Show when={props.pin}>{(pin) => <PinRow pinned={pin().pinned} onToggle={pin().onToggle} />}</Show>
    </MenuSection>
    <MenuSection>
      <MenuRow destructive icon={<Icons.Delete />} onSelect={props.onDelete}>{commandLabel(COMMAND_IDS.deleteChat)}</MenuRow>
    </MenuSection>
  </>;
}

/** What removing a place does, by what it is. */
export const deletePlaceLabel = (project: Project) => project.deletesFilesOnRemove === false ? "Unlink workspace"
  : isWorkspace(project) ? "Delete workspace" : "Delete folder";

/** A place's menu: a project's or a workspace's. While a clone is under way it says so and offers nothing. */
export function PlaceMenuItems(props: {
  project: Project;
  onNewChat: () => void; onOpenMaximized?: () => void; onRename: () => void; pin?: { pinned: boolean; onToggle: () => void };
  onIdentity: () => void; onSettings: () => void; onDelete: () => void;
}): JSX.Element {
  const workspace = () => isWorkspace(props.project);
  return <Show when={props.project.state !== "cloning"} fallback={<MenuSection><MenuRow disabled icon={<LoaderCircleIcon />}>Clone in progress</MenuRow></MenuSection>}>
    <MenuSection>
      <MenuRow icon={<Icons.NewChat />} onSelect={props.onNewChat}>{commandLabel(COMMAND_IDS.newChat)}</MenuRow>
      <Show when={workspace() && props.onOpenMaximized}><MenuRow icon={<Icons.Maximize />} onSelect={() => props.onOpenMaximized?.()}>Open maximized Workspace</MenuRow></Show>
      <MenuRow icon={<Icons.Edit />} onSelect={props.onRename}>Rename {workspace() ? "workspace" : "folder"}</MenuRow>
      <Show when={props.pin}>{(pin) => <PinRow pinned={pin().pinned} onToggle={pin().onToggle} />}</Show>
      <Show when={workspace()}><MenuRow icon={<Icons.WorkspaceIdentity />} onSelect={props.onIdentity}>Identity</MenuRow></Show>
      <MenuRow icon={<Icons.Settings />} onSelect={props.onSettings}>{workspace() ? "Workspace settings" : "Folder settings"}</MenuRow>
    </MenuSection>
    <MenuSection>
      <MenuRow destructive icon={<Icons.Delete />} onSelect={props.onDelete}>{deletePlaceLabel(props.project)}</MenuRow>
    </MenuSection>
  </Show>;
}

/** What a chat's and a place's menu do, for a host that hands every row the same (the dashboards). pinned: undefined where it cannot be pinned. */
export type ItemActions = {
  renameChat: (chat: ChatSummary, project: Project) => void;
  copyChat: (chat: ChatSummary) => void;
  openBeside?: (chat: ChatSummary, project: Project) => void;
  openTerminal: (chat: ChatSummary, project: Project) => void;
  running: (chat: ChatSummary) => boolean;
  stop: (chat: ChatSummary) => void;
  pinned: (type: "chat" | "project", id: string) => boolean;
  togglePin: (type: "chat" | "project", id: string) => void;
  deleteChat: (chat: ChatSummary, project: Project) => void;
  newChat: (project: Project) => void;
  openMaximized: (project: Project) => void;
  renamePlace: (project: Project) => void;
  identity: (project: Project) => void;
  settings: (project: Project) => void;
  deletePlace: (project: Project) => void;
};

export const ChatMenuFor = (props: { chat: ChatSummary; project: Project; actions: ItemActions }) => <ChatMenuItems project={props.project}
  onRename={() => props.actions.renameChat(props.chat, props.project)}
  onCopy={() => props.actions.copyChat(props.chat)}
  onOpenBeside={props.actions.openBeside ? () => props.actions.openBeside?.(props.chat, props.project) : undefined}
  onOpenTerminal={() => props.actions.openTerminal(props.chat, props.project)}
  onStop={props.actions.running(props.chat) ? () => props.actions.stop(props.chat) : undefined}
  pin={isConduitManagedProject(props.project) ? { pinned: props.actions.pinned("chat", props.chat.id), onToggle: () => props.actions.togglePin("chat", props.chat.id) } : undefined}
  onDelete={() => props.actions.deleteChat(props.chat, props.project)} />;

export const PlaceMenuFor = (props: { project: Project; actions: ItemActions }) => <PlaceMenuItems project={props.project}
  onNewChat={() => props.actions.newChat(props.project)}
  onOpenMaximized={() => props.actions.openMaximized(props.project)}
  onRename={() => props.actions.renamePlace(props.project)}
  pin={isConduitManagedProject(props.project) ? { pinned: props.actions.pinned("project", props.project.id), onToggle: () => props.actions.togglePin("project", props.project.id) } : undefined}
  onIdentity={() => props.actions.identity(props.project)}
  onSettings={() => props.actions.settings(props.project)}
  onDelete={() => props.actions.deletePlace(props.project)} />;
