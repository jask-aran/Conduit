import { createSignal } from "solid-js";
import type { SheetCellsOp } from "@/components/sheet";
import { api } from "../api/client";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl } from "../api/transport";
import { ARTIFACT_KINDS } from "./artifact-kinds";

/*
 * What the client knows of artifacts (docs/plans/markup-and-conduit-documents.md): each project's list, read from the
 * hub once it is asked for and again whenever the hub says that project's artifacts changed. Each is a file in its
 * project's folder (`path`), whose name is the file's: a paper (`<name>.paper`, blocks the hub holds live) or a site
 * (`<name>.site.html`, one HTML file an agent writes, shown in a frame that can reach nothing of Conduit's) or a Markdown file (`<name>.md`,
 * held live as a paper is; which `.md` files are artifacts is the hub's to say) or a sheet (`<name>.csv`, its cells held live, formulas kept beside it).
 */
export type ArtifactKind = "paper" | "site" | "markdown" | "sheet";
/**
 * `trouble`: why what is shown may not be what the file holds (it cannot be read, or its device is away); `edited`: a
 * paper's, false until anyone has changed it since it was made. Only `artifactAbout` says these.
 * `open`: how many comments on it the person has not settled; `working`: its mated thread has a turn running. Only a list says these.
 */
export interface Artifact { id: string; kind: ArtifactKind; name: string; path: string; project: string; trouble?: string | null; edited?: boolean; open?: number; working?: boolean }
/** What a kind is called; a kind this client does not know is an artifact. */
export const artifactLabel = (kind: ArtifactKind) => ARTIFACT_KINDS[kind]?.label ?? "Artifact";
/** Whether a paper says how many blocks and words it has, at its foot: this browser's choice, for every paper. */
const COUNT_KEY = "conduit.paper.count";
const [counted, setCounted] = createSignal((() => { try { return localStorage.getItem(COUNT_KEY) === "on"; } catch { return false; } })());
export const paperCounted = counted;
export const countPapers = (on: boolean) => { setCounted(on); try { localStorage.setItem(COUNT_KEY, on ? "on" : "off"); } catch { /* this session only */ } };
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
/** The artifact a file is, of those the client has been told of: a file that may be one only when asked (artifact-kinds `opens`) is looked for here, never asked of the hub, which answers 404 for the many that are not. */
export const artifactFor = (project: string, path: string) => Object.values(lists()).flat().find((item) => item.project === project && item.path === path);
/** The artifact a file is, asked of the hub (one pressed in the file tree). `adopt`: a file of a kind that is one only when asked (artifact-kinds `opens`) becomes one. */
export const artifactAt = (project: string, path: string, adopt?: boolean) => send(`/v0/projects/${encodeURIComponent(project)}/artifacts`, "POST", { path, ...(adopt ? { adopt: true } : {}) });
export const renameArtifact = (id: string, name: string) => send(`/v0/document/${encodeURIComponent(id)}`, "PATCH", { name });
export const deleteArtifact = (id: string) => api<void>(`/v0/document/${encodeURIComponent(id)}`, { method: "DELETE" });
/** A site's HTML as its file holds it now. `have`: the revision already shown; the hub then sends the HTML only when the file has changed since. */
export const siteContent = (id: string, have?: string) => api<{ revision: string; html?: string }>(`/v0/document/${encodeURIComponent(id)}?as=site${have ? `&have=${encodeURIComponent(have)}` : ""}`);
/** What only the hub does to a sheet: rows and columns inserted or deleted, and a fill whose formulas move per cell. */
export const sheetCells = (id: string, op: SheetCellsOp) => api<unknown>(`/v0/document/${encodeURIComponent(id)}/cells`, { method: "POST", body: JSON.stringify(op) });
/** Where its Markdown is read from, for Export. */
export const artifactMarkdownPath = (id: string) => `/v0/document/${encodeURIComponent(id)}?as=markdown`;
const markdownOf = async (id: string) => {
  const response = await authorizedFetch(httpUrl(artifactMarkdownPath(id)));
  if (!response.ok) throw new Error(String((await response.json().catch(() => ({})) as { error?: string }).error || "Its Markdown could not be read"));
  return response.blob();
};
/** Puts a paper's Markdown on the clipboard. */
export const copyArtifactMarkdown = async (artifact: Pick<Artifact, "id">) => navigator.clipboard.writeText(await (await markdownOf(artifact.id)).text());
/** Saves its Markdown as `<name>.md`, as the file viewer saves a file. */
export const exportArtifactMarkdown = async (artifact: Pick<Artifact, "id" | "name">) => {
  const url = URL.createObjectURL(await markdownOf(artifact.id));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${artifact.name}.md`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url));
};
