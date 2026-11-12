import { createSignal } from "solid-js";
import { api } from "../api/client";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl } from "../api/transport";

/*
 * What the client knows of artifacts (docs/plans/markup-and-conduit-documents.md): each project's list, read from the
 * hub once it is asked for and again whenever the hub says that project's artifacts changed. Each is a file in its
 * project's folder (`path`), whose name is the file's: a paper (`<name>.paper`, blocks the hub holds live) or a site
 * (`<name>.site.html`, one HTML file an agent writes, shown in a frame that can reach nothing of Conduit's).
 */
export type ArtifactKind = "paper" | "site";
/** `trouble`: why what is shown may not be what the file holds (it cannot be read, or its device is away); only `artifactAbout` says it. */
export interface Artifact { id: string; kind: ArtifactKind; name: string; path: string; project: string; trouble?: string | null }
/** The kinds the artifact creator offers, and what each is called where it is named (a tab with no name yet, the pane's switch). */
export const ARTIFACT_KINDS = [
  { kind: "paper", label: "Paper", says: "Blocks of text you and agents write together, with comments in the margin." },
  { kind: "site", label: "Site", says: "A page an agent builds as one HTML file. You mark it up, and the agent changes the file." },
] as const satisfies readonly { kind: ArtifactKind; label: string; says: string }[];
/** The file names that are artifacts, by their ending. */
export const artifactFile = (path: string): ArtifactKind | null => path.endsWith(".paper") ? "paper" : path.endsWith(".site.html") ? "site" : null;
export const artifactView = (id: string) => `artifact:${id}` as const;

const [lists, setLists] = createSignal<Record<string, Artifact[]>>({});
const asked = new Set<string>();
const read = (project: string) => api<{ artifacts: Artifact[] }>(`/v0/projects/${encodeURIComponent(project)}/artifacts`)
  .then(({ artifacts }) => setLists((current) => ({ ...current, [project]: artifacts })), () => setLists((current) => ({ ...current, [project]: current[project] ?? [] })));
window.addEventListener("conduit:artifacts-changed", (event) => { const project = (event as CustomEvent<string>).detail; if (asked.has(project)) void read(project); });

/** A project's artifacts, by name; empty until the hub has answered. */
export const artifactsOf = (project: string): Artifact[] => {
  if (!asked.has(project)) { asked.add(project); void read(project); }
  return lists()[project] ?? [];
};
/** Whether the hub has answered for a project: until then an empty list says nothing. */
export const artifactsRead = (project: string) => project in lists();
/** One the client has already been told of, in any project. */
export const artifactKnown = (id: string) => Object.values(lists()).flat().find((item) => item.id === id);
/** One by its id, asked of the hub: it need not be in a list the client has read. */
export const artifactAbout = (id: string) => api<Artifact>(`/v0/document/${encodeURIComponent(id)}?as=about`);
const send = (path: string, method: string, body?: unknown) => api<Artifact>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
/** A new one, in a folder of the project (unsaid: its root). The hub refuses a name already there. */
export const makeArtifact = (project: string, made: { kind: Artifact["kind"]; name: string; folder?: string }) => send(`/v0/projects/${encodeURIComponent(project)}/artifacts`, "POST", made);
/** The artifact a file of the project is (one pressed in the file tree). */
export const artifactAt = (project: string, path: string) => send(`/v0/projects/${encodeURIComponent(project)}/artifacts`, "POST", { path });
export const renameArtifact = (id: string, name: string) => send(`/v0/document/${encodeURIComponent(id)}`, "PATCH", { name });
export const deleteArtifact = (id: string) => api<void>(`/v0/document/${encodeURIComponent(id)}`, { method: "DELETE" });
/** A site's HTML as its file holds it now. `have`: the revision already shown; the hub then sends the HTML only when the file has changed since. */
export const siteContent = (id: string, have?: string) => api<{ revision: string; html?: string }>(`/v0/document/${encodeURIComponent(id)}?as=site${have ? `&have=${encodeURIComponent(have)}` : ""}`);
/** Where its Markdown is read from, for Export. */
export const artifactMarkdownPath = (id: string) => `/v0/document/${encodeURIComponent(id)}?as=markdown`;
/** Saves its Markdown as `<name>.md`, as the file viewer saves a file. */
export const exportArtifactMarkdown = async (artifact: Artifact) => {
  const response = await authorizedFetch(httpUrl(artifactMarkdownPath(artifact.id)));
  if (!response.ok) throw new Error(String((await response.json().catch(() => ({})) as { error?: string }).error || "Export failed"));
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `${artifact.name}.md`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url));
};
