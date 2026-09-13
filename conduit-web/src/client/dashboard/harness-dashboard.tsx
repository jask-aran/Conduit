import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { ArrowRightIcon, FolderIcon, HomeIcon, SearchIcon, XIcon } from "lucide-solid";
import { api } from "../api/client";
import type { ChatSummary, ComputerLocation, HarnessSummary, HarnessThread, HarnessThreadDiscovery, HarnessThreadGroup, ModelOption, ModelState, Project } from "../api/contracts";
import { Composer } from "../chat/composer";
import type { ComposerModels } from "../chat/composer-models";
import { saveChatSort, useChatSort } from "../preferences/chat-sort";
import { HarnessMark, ThreadHarnessMark } from "../harness-brand";
import { isConduitManagedProject } from "../navigation/sidebar-preferences";
import { RuntimeIndicator } from "../navigation/runtime-indicator";
import { createDriveChat } from "../state/drive-chat";
import type { DriveChatStore } from "../state/drive-chat";
import type { RuntimeStore } from "../state/runtime";
import { DashboardControlGroup, DashboardEmpty, DashboardGrid, DashboardIdentity, DashboardLaunch, DashboardQuickActions, DashboardRow, DashboardRowTitle, DashboardScrollRegion, DashboardSearchButton, DashboardSection, DashboardShell } from "./primitives/dashboard";
import "./harness-dashboard.css";

export function HarnessDashboard(props: {
  harness?: HarnessSummary;
  projects: Project[];
  cwd: string;
  runtime?: RuntimeStore;
  scope: string | null;
  onScope: (path: string | null) => void;
  onOpenChat?: (chat: ChatSummary, project: Project, prompt?: string) => void;
  composer?: (cwd: string, models: ComposerModels, loading: boolean) => JSX.Element;
  onDriveChange?: (open: boolean) => void;
  renderDrive?: (input: { current: { cwd: string; title: string; nativeSessionId: string }; harness: HarnessSummary; store: DriveChatStore; onBack: () => void; onTrack: () => void }) => JSX.Element;
}) {
  const relativeTime = (value: number | string | null) => {
    const raw = typeof value === "number" && value < 1_000_000_000_000 ? value * 1_000 : value;
    if (!raw) return "";
    const elapsed = Date.now() - new Date(raw).getTime();
    const minutes = Math.round(elapsed / 60_000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    return days < 7 ? `${days}d` : new Date(raw).toLocaleDateString();
  };

  const scope = () => props.scope;
  const [groups, setGroups] = createSignal<HarnessThreadGroup[]>([]);
  const [known, setKnown] = createSignal<HarnessThreadGroup[]>([]);
  const [truncated, setTruncated] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [sessionQuery, setSessionQuery] = createSignal("");
  const [sessionSearchOpen, setSessionSearchOpen] = createSignal(false);
  const [catalogLoading, setCatalogLoading] = createSignal(false);
  const [catalogModels, setCatalogModels] = createSignal<ModelOption[]>([]);
  const [catalogModel, setCatalogModel] = createSignal("");
  const [catalogEffort, setCatalogEffort] = createSignal("");
  const [catalogNotice, setCatalogNotice] = createSignal("");
  const [picker, setPicker] = createSignal<ComputerLocation | null>(null);
  const [pickerBusy, setPickerBusy] = createSignal(false);
  const [drive, setDrive] = createSignal<{ cwd: string; title: string; nativeSessionId: string } | null>(null);
  const chatSort = useChatSort();
  let liveId = "";
  const driveChat = props.runtime ? createDriveChat({ runtime: props.runtime, onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)) }) : null;

  const discovers = () => props.harness?.discovery === "machine";
  const workspaces = () => props.projects.filter((project) => !isConduitManagedProject(project));
  const projectFor = (path: string) => props.projects.find((project) => project.workingRoot === path);
  let catalogRequest = 0;
  const loadModels = async (implementation: string, cwd: string) => {
    const request = ++catalogRequest;
    setCatalogLoading(true);
    setCatalogModels([]);
    setCatalogModel("");
    setCatalogEffort("");
    setCatalogNotice("");
    try {
      const state = await api<ModelState>(`/v0/harnesses/${encodeURIComponent(implementation)}/models?path=${encodeURIComponent(cwd)}`);
      if (request !== catalogRequest) return;
      setCatalogModels(state.models);
      setCatalogModel(state.model || state.models[0]?.spec || "");
      setCatalogEffort(state.thinkingLevel || state.defaultThinkingLevel || "");
    } catch (cause) {
      if (request === catalogRequest) setCatalogNotice(cause instanceof Error ? cause.message : "Models could not be loaded");
    } finally {
      if (request === catalogRequest) setCatalogLoading(false);
    }
  };
  const catalog: ComposerModels = {
    models: catalogModels,
    model: catalogModel,
    effort: catalogEffort,
    notice: catalogNotice,
    chooseModel: (spec) => {
      const selected = catalogModels().find((item) => item.spec === spec);
      if (!selected) return false;
      setCatalogModel(spec);
      setCatalogEffort(selected.defaultThinkingLevel || selected.thinkingLevels[0] || "");
      return true;
    },
    chooseEffort: (level) => {
      const selected = catalogModels().find((item) => item.spec === catalogModel());
      if (!selected?.thinkingLevels.includes(level)) return false;
      setCatalogEffort(level);
      return true;
    },
  };

  const load = async () => {
    if (!discovers()) { setGroups([]); setKnown([]); return; }
    setLoading(true); setError("");
    try {
      const target = scope();
      const query = target ? `?path=${encodeURIComponent(target)}` : "";
      const result = await api<HarnessThreadDiscovery>(`/v0/harnesses/${props.harness!.id}/threads${query}`);
      setGroups(result.groups); setTruncated(result.truncated);
      if (!target) {
        setKnown(result.groups);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Threads could not be loaded"); }
    finally { setLoading(false); }
  };
  createEffect(() => { props.harness?.id; scope(); void load(); });
  onCleanup(() => { props.onDriveChange?.(false); const current = liveId; if (current) void api(`/v0/live-sessions/${current}/process`, { method: "DELETE" }); });

  const attach = async (live: { id: string; nativeSessionId: string; streamUrl: string }, cwd: string, title: string) => {
    if (!driveChat) return setError("Live sessions are unavailable on this surface");
    liveId = live.id;
    setDrive({ cwd, title, nativeSessionId: live.nativeSessionId });
    props.onDriveChange?.(true);
    try { await driveChat.attach(live, title); }
    catch (cause) { setDrive(null); props.onDriveChange?.(false); setError(cause instanceof Error ? cause.message : "Thread could not be opened"); }
  };

  const openThread = async (group: HarnessThreadGroup, thread: HarnessThread) => {
    setError("");
    if (thread.tracked && thread.chatId) {
      const project = projectFor(group.path);
      const chat = await api<ChatSummary>(`/v0/chats/${thread.chatId}`).catch(() => null);
      if (chat && project) return props.onOpenChat?.(chat, project);
    }
    try {
      const live = await api<{ id: string; nativeSessionId: string; streamUrl: string }>(`/v0/harnesses/${props.harness!.id}/drive`, {
        method: "POST", body: JSON.stringify({ path: group.path, sessionId: thread.id }),
      });
      await attach(live, group.path, thread.title);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Thread could not be opened"); }
  };

  const closeDrive = async () => {
    const current = liveId;
    liveId = "";
    driveChat?.detach();
    setDrive(null);
    props.onDriveChange?.(false);
    if (current) await api(`/v0/live-sessions/${current}/process`, { method: "DELETE" });
    void load();
  };

  const track = async () => {
    const current = drive();
    if (!current) return;
    setError("");
    try {
      let project = projectFor(current.cwd);
      if (!project) project = await api<Project>("/v0/projects", { method: "POST", body: JSON.stringify({ mode: "linked", path: current.cwd }) });
      const chat = await api<ChatSummary>(`/v0/projects/${project.id}/backend-sessions/${current.nativeSessionId}/adopt`, {
        method: "POST", body: JSON.stringify({ liveSessionId: liveId }),
      });
      liveId = "";
      driveChat?.detach();
      setDrive(null);
      props.onDriveChange?.(false);
      props.onOpenChat?.(chat, project);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Thread could not be tracked"); }
  };

  const browsePicker = async (path?: string) => {
    setPickerBusy(true);
    try { setPicker(await api<ComputerLocation>(`/v0/computer${path ? `?path=${encodeURIComponent(path)}` : ""}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Folder could not be opened"); }
    finally { setPickerBusy(false); }
  };
  const pickerDirectories = () => (picker()?.listing.entries || []).filter((entry) => entry.type === "directory");
  const recentFolders = createMemo(() => {
    const seen = new Set<string>();
    const rows: { path: string; display: string }[] = [];
    for (const group of known()) if (!seen.has(group.path)) { seen.add(group.path); rows.push({ path: group.path, display: group.display }); }
    for (const project of workspaces()) if (!seen.has(project.workingRoot)) { seen.add(project.workingRoot); rows.push({ path: project.workingRoot, display: project.name }); }
    return rows.slice(0, 6);
  });
  const launchCwd = () => scope() || groups()[0]?.path || props.cwd;
  const sessionRows = createMemo(() => {
    const query = sessionQuery().trim().toLocaleLowerCase();
    const field = chatSort() === "created" ? "createdAt" : "updatedAt";
    return groups().flatMap((group) => group.threads.map((thread) => ({ group, thread })))
      .filter(({ group, thread }) => !query || [thread.title, thread.preview, group.display, group.path, group.repository?.branch].some((value) => value?.toLocaleLowerCase().includes(query)))
      .sort((left, right) => new Date(right.thread[field] || 0).getTime() - new Date(left.thread[field] || 0).getTime());
  });
  createEffect(() => {
    const implementation = props.harness?.id;
    const cwd = launchCwd();
    if (implementation && props.harness?.drive) void loadModels(implementation, cwd);
  });
  const WorkingFolder = () => <DashboardQuickActions label="Workspace actions" columns={1}>
    <button type="button" title={launchCwd()} onClick={() => void browsePicker(launchCwd())}><FolderIcon /><strong>{recentFolders().find((folder) => folder.path === launchCwd())?.display || launchCwd().split("/").at(-1)}</strong><ArrowRightIcon /></button>
  </DashboardQuickActions>;
  const RecentFolders = () => <DashboardSection title="Recent folders" description={`Reported by ${props.harness?.label || "this harness"}`}>
    <For each={recentFolders()}>{(folder) => <DashboardRow element="button" class={folder.path === launchCwd() ? "is-active" : ""} title={folder.path} onClick={() => props.onScope(folder.path)} leading={<FolderIcon />} content={<><strong>{folder.display}</strong><small>{folder.path}</small></>} trailing={<ArrowRightIcon />} />}</For>
  </DashboardSection>;
  const Sessions = () => <Show when={discovers()} fallback={<DashboardSection><div class="harness-empty-copy"><strong>{props.harness?.label} does not report thread history.</strong><p>Threads you start here run on this page. This harness reports no local thread history.</p></div></DashboardSection>}>
    <DashboardSection scrollable class="harness-sessions" id="harness-recent-sessions" title="Recent sessions" description={scope() ? "Sessions in this folder" : `Sessions reported by ${props.harness?.label}`} busy={loading()} actions={<div class="harness-session-actions">
      <Show when={sessionSearchOpen()} fallback={<>
        <DashboardControlGroup label="Recent session sort"><button type="button" aria-pressed={chatSort() === "latest"} onClick={() => saveChatSort("latest")}>Latest</button><button type="button" aria-pressed={chatSort() === "created"} onClick={() => saveChatSort("created")}>Created</button></DashboardControlGroup>
        <DashboardSearchButton aria-label="Search sessions" title="Search sessions" onClick={() => setSessionSearchOpen(true)}><SearchIcon /></DashboardSearchButton>
      </>}><input type="search" aria-label="Search sessions" placeholder="Search sessions" autofocus value={sessionQuery()} onInput={(event) => setSessionQuery(event.currentTarget.value)} /><DashboardSearchButton aria-label="Close session search" title="Close search" onClick={() => { setSessionQuery(""); setSessionSearchOpen(false); }}><XIcon /></DashboardSearchButton></Show>
    </div>}>
      <Show when={!loading()} fallback={<DashboardEmpty>Finding threads…</DashboardEmpty>}>
        <DashboardScrollRegion>
          <For each={sessionRows()}>{({ group, thread }) => <DashboardRow element="button" class="harness-session-row" disabled={group.missing} onClick={() => void openThread(group, thread)} leading={<RuntimeIndicator process={thread.chatId ? props.runtime?.getProcess(thread.chatId) : null} stale={props.runtime?.stale()} fallback={<ThreadHarnessMark id={props.harness?.id} />} />} content={<><DashboardRowTitle title={thread.title} context={[scope() ? null : group.display, group.repository?.branch, group.missing ? "Folder is gone" : null].filter(Boolean).join(" · ")} /><Show when={thread.preview && thread.preview !== thread.title}><small>{thread.preview}</small></Show></>} meta={<><Show when={thread.tracked}><em class="harness-tracked-badge">Tracked</em></Show><small>{relativeTime(thread.updatedAt)}</small></>} />}</For>
          <Show when={!sessionRows().length}><DashboardEmpty>{sessionQuery() ? "No sessions match this search." : `No threads ${scope() ? "in this folder" : "yet"}.`}</DashboardEmpty></Show>
          <Show when={truncated()}><p class="harness-note">Older threads are not shown.</p></Show>
        </DashboardScrollRegion>
      </Show>
    </DashboardSection>
  </Show>;

  return <Show when={props.harness} fallback={<DashboardEmpty>Harness is unavailable.</DashboardEmpty>}>{(harness) => <>
    <Show when={drive()} fallback={<DashboardShell class="harness-dashboard" label={`${harness().label} dashboard`}>
      <DashboardIdentity title={harness().label} kind={`${harness().label}-CLI Harness`} glyph={<HarnessMark id={harness().id} />} subtitle={<span title={launchCwd()}>{launchCwd()}</span>} />
      <Show when={harness().drive}><DashboardLaunch primary={props.composer?.(launchCwd(), catalog, catalogLoading())} aside={<WorkingFolder />} /></Show>
      <DashboardGrid primary={<Sessions />} rail={<><Show when={!harness().drive}><WorkingFolder /></Show><RecentFolders /></>} />
      <Show when={error()}><p class="harness-error" role="alert">{error()}</p></Show>
    </DashboardShell>}>
      {(current) => driveChat && props.renderDrive
        ? props.renderDrive({ current: current(), harness: harness(), store: driveChat, onBack: () => void closeDrive(), onTrack: () => void track() })
        : <DashboardEmpty>Live sessions are unavailable on this surface.</DashboardEmpty>}
    </Show>

    <Show when={picker()}>{(location) => <div class="harness-picker-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setPicker(null); }}><div class="harness-picker" role="dialog" aria-label="Select working folder" aria-busy={pickerBusy()}>
      <header><strong>Select working folder</strong><button type="button" aria-label="Cancel" onClick={() => setPicker(null)}><XIcon /></button></header>
      <div class="harness-picker-path"><button type="button" aria-label="Home" onClick={() => void browsePicker(location().home)}><HomeIcon /></button><span title={location().project.workingRoot}>{location().project.workingRoot}</span><Show when={location().project.workingRoot !== location().home}><button type="button" onClick={() => void browsePicker(location().parent)}>Up</button></Show></div>
      <div class="harness-picker-list"><For each={pickerDirectories()}>{(entry) => <button type="button" onClick={() => void browsePicker(`${location().project.workingRoot}/${entry.path}`)}><FolderIcon /><span>{entry.name}</span></button>}</For><Show when={!pickerDirectories().length}><p class="harness-note">No folders here.</p></Show></div>
      <Show when={recentFolders().length}><div class="harness-picker-recent"><For each={recentFolders()}>{(folder) => <button type="button" title={folder.path} onClick={() => void browsePicker(folder.path)}>{folder.display}</button>}</For></div></Show>
      <footer><small title={location().project.workingRoot}>{location().project.workingRoot}</small><button type="button" disabled={pickerBusy()} onClick={() => { props.onScope(location().project.workingRoot); setPicker(null); }}>Use folder <ArrowRightIcon /></button></footer>
    </div></div>}</Show>
  </>}</Show>;
}
