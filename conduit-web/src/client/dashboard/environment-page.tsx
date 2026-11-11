import { createEffect, createSignal, on, onCleanup, type JSX } from "solid-js";
import { api } from "../api/client";
import type { ComputerLocation, Project } from "../api/contracts";
import { createLatest } from "../state/latest";
import { deviceLabel, deviceStates } from "../state/runtime";
import { ComputerDashboard } from "./computer-dashboard";

export function EnvironmentPage(props: {
  nodeId: string;
  header: (title: string) => JSX.Element;
  projects: Project[];
  onOpenWorkspace: (project: Project) => void;
  onMount: (path: string) => void;
  onOpenTerminal: () => void;
}) {
  const [location, setLocation] = createSignal<ComputerLocation | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const state = () => deviceStates().get(props.nodeId);
  const request = createLatest();
  const browse = async (path?: string) => {
    const current = request.next();
    setLoading(true);
    setError("");
    try {
      const next = await api<ComputerLocation>(`/v0/nodes/${encodeURIComponent(props.nodeId)}/computer${path ? `?path=${encodeURIComponent(path)}` : ""}`);
      if (current()) setLocation(next);
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : "This environment's folder could not be read");
    } finally {
      if (current()) setLoading(false);
    }
  };
  createEffect(on(() => props.nodeId, () => { setLocation(null); void browse(); }));
  // Back from away: where it was is read again.
  const back = (event: Event) => { if ((event as CustomEvent<string>).detail === props.nodeId) void browse(location()?.project.workingRoot); };
  window.addEventListener("conduit:device-online", back);
  onCleanup(() => window.removeEventListener("conduit:device-online", back));
  const mine = () => props.projects.filter((project) => project.nodeId === props.nodeId);
  return <>
    {props.header(state() ? deviceLabel(state()!) : "Environment")}
    <ComputerDashboard device projects={mine()} location={location()} loading={loading()} error={error() || (state() && !state()!.online ? `${deviceLabel(state()!)} is offline` : "")}
      onBrowse={(path) => void browse(path)} onPrefetch={() => {}} onMakeWorkspace={() => { const here = location(); if (here) props.onMount(here.project.workingRoot); }}
      onCreateWorkspace={props.onMount} onOpenWorkspace={props.onOpenWorkspace} onManageWorkspace={() => {}} onStartWorkspaceAction={() => {}}
      onOpenView={() => {}} onOpenFile={() => {}} onOpenTerminalView={props.onOpenTerminal} selectOnly />
  </>;
}
