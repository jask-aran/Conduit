import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ArrowRightIcon, FolderIcon, HomeIcon, LayersIcon, SearchIcon, XIcon } from "lucide-solid";
import { api } from "../api/client";
import type { ChatSummary, ComputerLocation, HarnessSummary, HarnessThread, HarnessThreadDiscovery, HarnessThreadGroup, ModelOption, ModelState, PermissionMode, PermissionModeState, Project } from "../api/contracts";
import type { ComposerModels } from "../chat/composer-models";
import type { ComposerPermissions } from "../chat/composer-permissions";
import type { FolderOptions } from "../chat/place-picker";
import { saveChatSort, useChatSort } from "../preferences/chat-sort";
import { HarnessMark, harnessStatusLabel, ThreadHarnessMark } from "../harness-brand";
import { isConduitManagedProject } from "../navigation/sidebar-preferences";
import { activityDetail, runtimeActivity, RuntimeIndicator } from "../navigation/runtime-indicator";
import { activityLabel } from "../../activity.js";
import { Segmented } from "../settings/settings-controls";
import { notifyModelFallback } from "../state/model-settings";
import type { RuntimeStore } from "../state/runtime";
import { timestampOf } from "./outside-threads";
import { CHAT_PAGE, CompactHeading, DayGroups, FilterBar, FiltersMenu, groupByDay, ShowMore, sortChoice } from "./primitives/chat-list";
import { SplitDashboard, SplitEmpty, SplitGroup, SplitHeader, SplitRow } from "./primitives/split";
import "./harness-dashboard.css";

// A harness's own page: the threads it ran that Conduit does not keep, beside
// the chats Conduit keeps on it, and the folders it ran them in. It reads as a
// workspace's page does, on the same split layout.

export type HarnessLaunch = { harnessId: string; cwd: string; prompt: string; model: string; thinkingLevel: string; permissionMode: string };
export type HarnessThreadTarget = { harnessId: string; path: string; id: string; title: string };
type Side = "outside" | "conduit";

function shortAge(value: number, currentTime = Date.now()) {
  if (!value) return "";
  const minutes = Math.max(0, Math.floor((currentTime - value) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}

export function HarnessDashboard(props: {
  harnessId: string;
  projects: Project[];
  runtime: RuntimeStore;
  /** The folder the page is scoped to; null for every folder. */
  scope: string | null;
  onScope: (path: string | null) => void;
  /** Where a thread starts when nothing else says: the Computer's home. */
  home: string;
  composer?: (input: { models: ComposerModels; loading: boolean; permissions: ComposerPermissions; folder: FolderOptions; launch: (prompt: string) => Promise<void> }) => JSX.Element;
  onStartThread: (launch: HarnessLaunch) => Promise<void>;
  onOpenThread: (thread: HarnessThreadTarget) => void;
  onOpenChat: (chat: ChatSummary, project: Project) => void;
}) {
  const [harness, setHarness] = createSignal<HarnessSummary | null>(null);
  const [harnessLoaded, setHarnessLoaded] = createSignal(false);
  const [groups, setGroups] = createSignal<HarnessThreadGroup[]>([]);
  const [known, setKnown] = createSignal<HarnessThreadGroup[]>([]);
  const [truncated, setTruncated] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [searching, setSearching] = createSignal(false);
  const [limit, setLimit] = createSignal(CHAT_PAGE);
  const [now, setNow] = createSignal(Date.now());
  const [side, setSide] = createSignal<Side>("outside");
  const [catalogLoading, setCatalogLoading] = createSignal(false);
  const [catalogModels, setCatalogModels] = createSignal<ModelOption[]>([]);
  const [catalogModel, setCatalogModel] = createSignal("");
  const [catalogEffort, setCatalogEffort] = createSignal("");
  const [catalogNotice, setCatalogNotice] = createSignal("");
  const [permissionModes, setPermissionModes] = createSignal<PermissionMode[]>([]);
  const [permissionMode, setPermissionMode] = createSignal("");
  const [picker, setPicker] = createSignal<ComputerLocation | null>(null);
  const [pickerBusy, setPickerBusy] = createSignal(false);
  const chatSort = useChatSort();

  createEffect(() => {
    const id = props.harnessId;
    setHarnessLoaded(false);
    void api<{ harnesses: HarnessSummary[] }>("/v0/harnesses")
      .then((result) => { if (id === props.harnessId) setHarness(result.harnesses.find((item) => item.id === id) || null); })
      .catch(() => setHarness(null))
      .finally(() => setHarnessLoaded(true));
  });
  onMount(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    onCleanup(() => window.clearInterval(clock));
  });

  const label = () => harness()?.label || props.harnessId;
  const discovers = () => harness()?.discovery === "machine";
  const scope = () => props.scope;
  const workspaces = () => props.projects.filter((project) => !isConduitManagedProject(project));

  // Every folder's threads once, for the Folders list; the folder in scope's
  // own as well, since the machine-wide list stops at the newest threads.
  let loadRequest = 0;
  const load = async () => {
    const request = ++loadRequest;
    if (!discovers()) { setGroups([]); setKnown([]); setLoading(false); return; }
    setLoading(true); setError("");
    const target = scope();
    const discover = (path?: string | null) => api<HarnessThreadDiscovery>(`/v0/harnesses/${encodeURIComponent(props.harnessId)}/threads${path ? `?path=${encodeURIComponent(path)}` : ""}`);
    try {
      const [everywhere, here] = await Promise.all([discover(), target ? discover(target) : null]);
      if (request !== loadRequest) return;
      setKnown(everywhere.groups);
      setGroups((here || everywhere).groups);
      setTruncated((here || everywhere).truncated);
    } catch (cause) { if (request === loadRequest) setError(cause instanceof Error ? cause.message : "Threads could not be loaded"); }
    finally { if (request === loadRequest) setLoading(false); }
  };
  createEffect(() => { harness(); scope(); setLimit(CHAT_PAGE); void load(); });

  const folders = createMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{ path: string; label: string; missing?: boolean }> = [];
    const add = (path: string, name: string, missing?: boolean) => { if (!seen.has(path)) { seen.add(path); rows.push({ path, label: name, missing }); } };
    const current = scope();
    if (current) add(current, known().find((group) => group.path === current)?.display || current.split("/").at(-1) || current);
    for (const group of known()) add(group.path, group.display, group.missing);
    for (const project of workspaces()) add(project.workingRoot, project.name);
    return rows.slice(0, 10);
  });
  const launchCwd = () => scope() || known().find((group) => !group.missing)?.path || props.home;

  const sortTime = (value: { createdAt?: number | string | null; updatedAt?: number | string | null }) =>
    timestampOf(chatSort() === "created" ? value.createdAt : value.updatedAt ?? value.createdAt);
  const outside = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    return groups().flatMap((group) => group.threads.filter((thread) => !thread.tracked).map((thread) => ({ group, thread })))
      .filter(({ group, thread }) => !needle || [thread.title, thread.preview, group.display, group.path, group.repository?.branch].some((value) => value?.toLocaleLowerCase().includes(needle)))
      .sort((left, right) => sortTime(right.thread) - sortTime(left.thread));
  });
  // Conduit's own chats on this harness, where they live.
  const kept = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    const at = (chat: ChatSummary) => Date.parse((chatSort() === "created" ? chat.createdAt : chat.lastMessageAt || chat.createdAt) || "") || 0;
    return props.projects
      .filter((project) => !scope() || project.workingRoot === scope())
      .flatMap((project) => project.sessions
        .filter((chat) => chat.status === "active" && (chat.harnessId === props.harnessId || chat.backend?.implementation === props.harnessId))
        .map((chat) => ({ chat, project, at: at(chat) })))
      .filter(({ chat, project }) => !needle || [chat.title, project.name].some((value) => value?.toLocaleLowerCase().includes(needle)))
      .sort((left, right) => right.at - left.at);
  });
  const showOutside = () => discovers() && side() === "outside";
  const running = createMemo(() => kept().filter(({ chat }) => props.runtime.getProcess(chat.id)?.active).length);
  const total = () => showOutside() ? outside().length : kept().length;

  // The harness keeps the catalogue; the dashboard holds the choice until the
  // first message starts a thread with it.
  let catalogRequest = 0;
  const loadModels = async (cwd: string) => {
    const request = ++catalogRequest;
    setCatalogLoading(true); setCatalogModels([]); setCatalogModel(""); setCatalogEffort(""); setCatalogNotice("");
    try {
      const state = await api<ModelState>(`/v0/harnesses/${encodeURIComponent(props.harnessId)}/models?path=${encodeURIComponent(cwd)}`);
      if (request !== catalogRequest) return;
      setCatalogModels(state.models);
      setCatalogModel(state.model || state.models[0]?.spec || "");
      setCatalogEffort(state.thinkingLevel || state.defaultThinkingLevel || "");
      // The model this profile was last on has gone. The composer opens on a
      // stand-in either way; it does not do it quietly.
      if (state.modelFallback?.from && state.modelFallback.to) notifyModelFallback(state.modelFallback);
    } catch (cause) {
      if (request === catalogRequest) setCatalogNotice(cause instanceof Error ? cause.message : "Models could not be loaded");
    } finally {
      if (request === catalogRequest) setCatalogLoading(false);
    }
  };
  let permissionRequest = 0;
  const loadPermissionModes = async (cwd: string) => {
    const request = ++permissionRequest;
    setPermissionModes([]); setPermissionMode("");
    try {
      const state = await api<PermissionModeState>(`/v0/harnesses/${encodeURIComponent(props.harnessId)}/permission-modes?path=${encodeURIComponent(cwd)}`);
      if (request !== permissionRequest) return;
      setPermissionModes(state.modes);
      setPermissionMode(state.selected || state.modes[0]?.id || "");
    } catch {
      // A harness that cannot say costs the selector, not the launch.
      if (request === permissionRequest) setPermissionModes([]);
    }
  };
  createEffect(() => {
    const cwd = launchCwd();
    if (!harness()?.drive) return;
    void loadModels(cwd);
    void loadPermissionModes(cwd);
  });
  const permissions: ComposerPermissions = {
    profiles: permissionModes,
    selected: permissionMode,
    choose: (id) => {
      if (!permissionModes().some((mode) => mode.id === id && mode.allowed)) return false;
      setPermissionMode(id);
      return true;
    },
  };
  // Choosing is the decision and a message may never come, so the choice is
  // remembered for the harness straight away.
  const rememberChoice = (model: string, thinkingLevel: string) => {
    if (!model) return;
    void api(`/v0/harnesses/${encodeURIComponent(props.harnessId)}/models`, {
      method: "PATCH", body: JSON.stringify({ model, thinkingLevel, path: scope() || undefined }),
    }).catch(() => {});
  };
  const catalog: ComposerModels = {
    models: catalogModels,
    model: catalogModel,
    effort: catalogEffort,
    notice: catalogNotice,
    chooseModel: (spec) => {
      const selected = catalogModels().find((item) => item.spec === spec);
      if (!selected) return false;
      const level = selected.defaultThinkingLevel || selected.thinkingLevels[0] || "";
      setCatalogModel(spec);
      setCatalogEffort(level);
      rememberChoice(spec, level);
      return true;
    },
    chooseEffort: (level) => {
      const selected = catalogModels().find((item) => item.spec === catalogModel());
      if (!selected?.thinkingLevels.includes(level)) return false;
      setCatalogEffort(level);
      rememberChoice(catalogModel(), level);
      return true;
    },
  };
  const launch = (prompt: string) => props.onStartThread({
    harnessId: props.harnessId, cwd: launchCwd(), prompt,
    model: catalogModel(), thinkingLevel: catalogEffort(), permissionMode: permissionMode(),
  });

  const browse = async (path?: string) => {
    setPickerBusy(true);
    try { setPicker(await api<ComputerLocation>(`/v0/computer${path ? `?path=${encodeURIComponent(path)}` : ""}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Folder could not be opened"); }
    finally { setPickerBusy(false); }
  };
  const pickerDirectories = () => (picker()?.listing.entries || []).filter((entry) => entry.type === "directory");
  const folder: FolderOptions = {
    get folders() { return folders().filter((row) => !row.missing); },
    get current() { return launchCwd(); },
    onChoose: (path) => props.onScope(path),
    onBrowse: () => void browse(launchCwd()),
  };

  const openThread = (group: HarnessThreadGroup, thread: HarnessThread) =>
    props.onOpenThread({ harnessId: props.harnessId, path: group.path, id: thread.id, title: thread.title });
  const outsideRows = () => <Show when={!loading()} fallback={<SplitEmpty>Looking for threads…</SplitEmpty>}>
    <Show when={outside().length} fallback={<SplitEmpty>{query() ? "No threads match this search." : `No threads outside Conduit ${scope() ? "in this folder" : "yet"}.`}</SplitEmpty>}>
      <DayGroups groups={groupByDay(outside().slice(0, limit()), ({ thread }) => sortTime(thread), now())}>{({ group, thread }) =>
        <SplitRow element="button" disabled={group.missing} title={thread.preview || thread.title} onClick={() => openThread(group, thread)}
          lead={<ThreadHarnessMark id={props.harnessId} lively />} primary={thread.title || "Untitled thread"}
          context={[scope() ? null : group.display, group.repository?.branch, group.missing ? "Folder is gone" : null].filter(Boolean).join(" · ")}
          trailing={shortAge(sortTime(thread), now())} />}
      </DayGroups>
      <Show when={truncated() && outside().length <= limit()}><p class="harness-note">Older threads are not shown.</p></Show>
    </Show>
  </Show>;
  const keptRows = () => <Show when={kept().length} fallback={<SplitEmpty>{query() ? "No chats match this search." : `No Conduit chats on ${label()} ${scope() ? "in this folder" : "yet"}.`}</SplitEmpty>}>
    <DayGroups groups={groupByDay(kept().slice(0, limit()), (row) => row.at, now())}>{({ chat, project }) => {
      const process = () => props.runtime.getProcess(chat.id);
      const live = () => process()?.active ? activityLabel(runtimeActivity(process()) || "working", activityDetail(process())) : "";
      return <SplitRow element="button" onClick={() => props.onOpenChat(chat, project)}
        lead={<RuntimeIndicator process={process()} stale={props.runtime.stale()} unread={chat.unread} fallback={<ThreadHarnessMark id={chat.harnessId} lively />} />}
        primary={chat.title || "Untitled chat"}
        context={[live(), scope() ? null : project.name].filter(Boolean).join(" · ")}
        trailing={shortAge(Date.parse(chat.lastMessageAt || chat.createdAt || "") || 0, now())} />;
    }}</DayGroups>
  </Show>;

  const chooseSide = (value: Side) => { setSide(value); setLimit(CHAT_PAGE); };
  const sideChoice = () => ({ label: "Show", value: side(), onChange: (value: string) => chooseSide(value as Side), options: [
    { value: "outside", label: "Not in Conduit", detail: loading() ? undefined : outside().length },
    { value: "conduit", label: "In Conduit", detail: kept().length },
  ] });
  const search = () => <Show when={searching()} fallback={<button type="button" aria-label="Search threads" title="Search threads" onClick={() => setSearching(true)}><SearchIcon /></button>}>
    <input class="harness-search" type="search" aria-label="Search threads" placeholder="Search" autofocus value={query()} onInput={(event) => setQuery(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); setSearching(false); } }} />
    <button type="button" aria-label="Close search" title="Close search" onClick={() => { setQuery(""); setSearching(false); }}><XIcon /></button>
  </Show>;
  const threadsGroup = () => <SplitGroup id="harness-threads" order="list" busy={loading()}
    heading={<div class="split-heading-switches"><Show when={discovers()} fallback={<h2 id="harness-threads">Chats<small>{kept().length}</small></h2>}>
      <Segmented label="Threads" value={side()} onChange={chooseSide} options={[
        { value: "outside", label: "Not in Conduit", detail: <Show when={!loading()}><small>{outside().length}</small></Show> },
        { value: "conduit", label: "In Conduit", detail: <small>{kept().length}</small> },
      ]} />
    </Show></div>}
    actions={<FilterBar choices={[sortChoice(chatSort(), saveChatSort)]}>{search()}</FilterBar>}
    compactHeading={<CompactHeading label={showOutside() ? "Not in Conduit" : "In Conduit"} count={total()} />}
    compactActions={<><FiltersMenu choices={[discovers() && sideChoice(), sortChoice(chatSort(), saveChatSort)]} />{search()}</>}
    more={<ShowMore total={total()} shown={limit()} onMore={() => setLimit((value) => value + CHAT_PAGE)} />}>
    <Show when={showOutside()} fallback={keptRows()}>{outsideRows()}</Show>
  </SplitGroup>;

  const foldersGroup = () => <SplitGroup id="harness-folders" label="Folders" count={folders().length} actions={<button type="button" onClick={() => void browse(launchCwd())}>Browse</button>}>
    <Show when={folders().length} fallback={<SplitEmpty>{discovers() ? "No folders yet." : `${label()} does not say where it has run.`}</SplitEmpty>}>
      <SplitRow element="button" aria-current={scope() ? undefined : "true"} onClick={() => props.onScope(null)} lead={<LayersIcon />} primary="All folders" />
      <For each={folders()}>{(row) =>
        <SplitRow element="button" aria-current={row.path === scope() ? "true" : undefined} disabled={row.missing} title={row.path} onClick={() => props.onScope(row.path)}
          lead={<FolderIcon />} primary={row.label} context={row.missing ? "Folder is gone" : row.path} />}
      </For>
    </Show>
  </SplitGroup>;

  return <Show when={harness()} fallback={<div class="harness-dashboard-state">{harnessLoaded() ? "This harness is unavailable." : "Loading harness…"}</div>}>{(current) => <>
    <SplitDashboard class="harness-dashboard" page="Harness" label={`${current().label} dashboard`}
      header={<SplitHeader title={current().label} kind="Harness" glyph={<HarnessMark id={current().id} />} context={[
        <span title={scope() || undefined}>{scope() || "All folders"}</span>,
        harnessStatusLabel(current().status),
        current().version ? (/^\d/.test(current().version!) ? `v${current().version}` : current().version) : null,
        running() ? `${running()} running` : null,
      ]} />}
      notice={error() ? <p class="harness-error" role="alert">{error()}</p> : undefined}
      composer={current().drive ? props.composer?.({ models: catalog, get loading() { return catalogLoading(); }, permissions, folder, launch }) : undefined}
      list={threadsGroup()}
      aside={foldersGroup()} />

    <Show when={picker()}>{(location) => <div class="harness-picker-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setPicker(null); }}><div class="harness-picker" role="dialog" aria-label="Select working folder" aria-busy={pickerBusy()}>
      <header><strong>Select working folder</strong><button type="button" aria-label="Cancel" onClick={() => setPicker(null)}><XIcon /></button></header>
      <div class="harness-picker-path"><button type="button" aria-label="Home" onClick={() => void browse(location().home)}><HomeIcon /></button><span title={location().project.workingRoot}>{location().project.workingRoot}</span><Show when={location().project.workingRoot !== location().home}><button type="button" onClick={() => void browse(location().parent)}>Up</button></Show></div>
      <div class="harness-picker-list"><For each={pickerDirectories()}>{(entry) => <button type="button" onClick={() => void browse(`${location().project.workingRoot}/${entry.path}`)}><FolderIcon /><span>{entry.name}</span></button>}</For><Show when={!pickerDirectories().length}><p class="harness-note">No folders here.</p></Show></div>
      <Show when={folders().length}><div class="harness-picker-recent"><For each={folders()}>{(row) => <button type="button" title={row.path} onClick={() => void browse(row.path)}>{row.label}</button>}</For></div></Show>
      <footer><small title={location().project.workingRoot}>{location().project.workingRoot}</small><button type="button" disabled={pickerBusy()} onClick={() => { props.onScope(location().project.workingRoot); setPicker(null); }}>Use folder <ArrowRightIcon /></button></footer>
    </div></div>}</Show>
  </>}</Show>;
}

export default HarnessDashboard;
