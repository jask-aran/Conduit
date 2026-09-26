import { api } from "../api/client";
import type { HarnessSummary, HarnessThread, HarnessThreadDiscovery } from "../api/contracts";

// Threads the machine's harnesses ran that no Conduit chat owns: in one folder
// for a workspace's Not in Conduit, across the machine for the Conduit
// dashboard's Computer side.

export type OutsideThread = HarnessThread & { harnessId: string; at: number; path: string };

// Harnesses report seconds, milliseconds or ISO strings.
export function timestampOf(value: number | string | null | undefined) {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  return Date.parse(value || "") || 0;
}

export async function loadOutsideThreads(path?: string) {
  const { harnesses } = await api<{ harnesses: HarnessSummary[] }>("/v0/harnesses");
  const visible = harnesses.filter((harness) => harness.available && harness.discovery === "machine");
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const found = await Promise.all(visible.map((harness) => api<HarnessThreadDiscovery>(`/v0/harnesses/${encodeURIComponent(harness.id)}/threads${query}`)
    .then((discovery) => discovery.groups.flatMap((group) => group.threads
      .filter((thread) => !thread.tracked)
      .map((thread) => ({ ...thread, harnessId: harness.id as string, path: group.path, at: timestampOf(thread.updatedAt ?? thread.createdAt) }))))
    .catch(() => [] as OutsideThread[])));
  return {
    harnesses: visible.map((harness) => ({ id: harness.id as string, label: harness.label })),
    threads: found.flat().sort((left, right) => right.at - left.at),
  };
}
