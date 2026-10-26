import { FileTypeIcon } from "@/components/ui/file-marks";
import { Icons } from "@/components/ui";
import { FileView, FileHead, FileName, FileGit, FileDirty, FileActions, FileSuffix, FileButton, FileMore, StatusBar, StatusText } from "@/components/ui/file";
import { FileImage, FileMedia, FileCard, FileBody } from "@/components/ui/viewer";
import { PaneEmpty, ToolNotice } from "@/components/ui/pane";
import { Spinner } from "@/components/ui";
import { Button } from "@/components/ui/controls";
import { Rule } from "@/components/ui/popover";
import { batch, createEffect, createSignal, lazy, on, onCleanup, Show, Suspense, type JSX } from "solid-js";
import { SaveIcon } from "lucide-solid";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/menus";
import { api } from "../api/client";
import { httpUrl } from "../api/transport";

import { isInstalledClient } from "../platform/installed-client.ts";
import { directAvailable, workspaceFileJson, workspaceFileResponse } from "./direct-files";
import type { WorkspaceEditorHandle } from "./workspace-editor";
import { addReviewComment, reviewComments } from "../chat/review-comments";
import type { ReviewNavigationRequest } from "../chat/review-navigation";

let workspaceEditorPromise: Promise<typeof import("./workspace-editor")> | undefined;
export const preloadWorkspaceEditor = () => {
  workspaceEditorPromise ??= import("./workspace-editor").catch((cause: unknown) => {
    workspaceEditorPromise = undefined;
    throw cause;
  });
  return workspaceEditorPromise;
};
const loadWorkspaceEditor = preloadWorkspaceEditor;
const WorkspaceEditor = lazy(loadWorkspaceEditor);

// Rendered through an <img> on a blob URL: that carries the Bearer header the
// native builds need, and never executes script inside an SVG.
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"]);
const IMAGE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
};
const MAX_INLINE_IMAGE_BYTES = 100 * 1024 * 1024;

export type FileKind = "text" | "image" | "pdf" | "audio" | "video" | "binary";

function imageExtension(path: string): string | null {
  const extension = path.split(".").at(-1)?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(extension) ? extension : null;
}

function fallbackKind(path: string): FileKind {
  if (imageExtension(path)) return "image";
  const extension = path.split(".").at(-1)?.toLowerCase() || "";
  if (extension === "pdf") return "pdf";
  if (["mp3", "m4a", "wav", "ogg", "oga", "flac", "aac", "opus", "mid", "midi"].includes(extension)) return "audio";
  if (["mp4", "m4v", "webm", "mov", "avi", "mkv", "ogv"].includes(extension)) return "video";
  if (["exe", "dll", "bin", "zip", "7z", "gz", "tar", "rar", "pkg", "epub", "woff", "woff2", "ttf"].includes(extension)) return "binary";
  return "text";
}

function fallbackMime(path: string, kind: FileKind): string {
  if (kind === "image") return IMAGE_MIME[imageExtension(path) || ""] || "image/*";
  if (kind === "pdf") return "application/pdf";
  if (kind === "audio") return "audio/*";
  if (kind === "video") return "video/*";
  if (kind === "binary") return "application/octet-stream";
  return "text/plain";
}

function formatKind(kind: Exclude<FileKind, "text">): string {
  return kind === "binary" ? "Binary file" : `${kind.charAt(0).toUpperCase()}${kind.slice(1)} file`;
}

function metadataFromError(path: string, cause: unknown): FileMetadata | null {
  if (!cause || typeof cause !== "object") return null;
  const value = cause as Record<string, unknown>;
  if (typeof value.size !== "number" || typeof value.modifiedAt !== "number") return null;
  const kind = typeof value.kind === "string" && ["text", "image", "pdf", "audio", "video", "binary"].includes(value.kind)
    ? value.kind as FileKind
    : undefined;
  return {
    path,
    size: value.size,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : null,
    modifiedAt: value.modifiedAt,
    revision: typeof value.revision === "string" ? value.revision : undefined,
    kind,
    mime: typeof value.mime === "string" ? value.mime : undefined,
    head: typeof value.head === "string" ? value.head : undefined,
  };
}

function formatHexHead(head = ""): string {
  return head.match(/.{1,2}/g)?.join(" ") || "No content prefix available";
}

export interface FilePreview {
  path: string;
  size: number;
  createdAt?: number | null;
  modifiedAt: number;
  revision: string;
  kind: "text";
  mime: string;
  content: string;
  truncated?: boolean;
  readOnly?: boolean;
}
export interface FileSummary { path: string; size: number; kind?: FileKind; mime?: string; }
interface FileMetadata { path: string; size: number; createdAt?: number | null; modifiedAt: number; revision?: string; kind?: FileKind; mime?: string; head?: string; }
interface FileAsset extends FileMetadata { kind: Exclude<FileKind, "text">; mime: string; url: string; oversize: boolean; }
interface FileWriteResult { path: string; size: number; createdAt?: number | null; modifiedAt: number; revision: string; }

// The parent owns which paths are open; a slot owns everything about the file at
// its own path, so two slots never share load, document, or save state.
export interface FileSlotHandle {
  path: () => string | null;
  hasUnsavedChanges: () => boolean;
  reload: () => Promise<void>;
  edit: () => void;
  save: () => Promise<void>;
  discardChanges: () => void;
}

function formatFileSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

function formatFileTime(value?: number | null) {
  if (!value || !Number.isFinite(value)) return null;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function fileTimeMetadata(file: { createdAt?: number | null; modifiedAt: number }) {
  const modified = formatFileTime(file.modifiedAt);
  const created = formatFileTime(file.createdAt);
  return [modified && `Modified ${modified}`, created && `Created ${created}`].filter(Boolean).join(" · ");
}

function errorCode(cause: unknown): string {
  return cause && typeof cause === "object" && "error" in cause && typeof cause.error === "string" ? cause.error : "";
}

export default function WorkspaceFileSlot(props: {
  projectId: string;
  path: string | null;
  slot: "primary" | "secondary";
  focused: boolean;
  closable: boolean;
  busy: boolean;
  wrap: boolean;
  headerPrefix?: JSX.Element;
  /** Before the close button: the file viewer's split. */
  headerSuffix?: JSX.Element;
  /** A file viewer's tabs for this side (6c): they name the file, and close it. */
  headerTabs?: JSX.Element;
  /** At the header's end: the pane's own actions, on a viewer's last side. */
  headerEnd?: JSX.Element;
  /** The suffix's actions again, for the header's overflow menu when it is too narrow for them. */
  /** More items for the header's ⋯, given which folded actions it lists. */
  headerMenuItems?: (folded: (action: string) => boolean) => JSX.Element;
  empty?: string;
  onToggleWrap: () => void;
  annotationChatId?: string | null;
  reveal?: ReviewNavigationRequest | null;
  onFocus: () => void;
  onClose: () => void;
  onError: (message: string) => void;
  // announce: the file vanished while it was on screen, which is worth saying.
  // A stale stored path that simply does not exist here clears in silence.
  onRemoved: (path: string, announce: boolean) => void;
  /** Absent where the file cannot be replaced from here (a pane's file viewer; the navigator can). */
  onReplace?: (path: string) => void;
  onDelete: (path: string) => void;
  onLoaded?: (file: FileSummary | null) => void;
  onSaved?: () => void;
  gitFile?: { status: string; stagedCounts?: { added: number; removed: number } | null; workingCounts?: { added: number; removed: number } | null };
  onShowDiff?: (staged: boolean, beside?: boolean) => void;
  onDispose?: () => void;
  ref?: (handle: FileSlotHandle) => void;
}) {
  const [preview, setPreview] = createSignal<FilePreview | null>(null);
  const [asset, setAsset] = createSignal<FileAsset | null>(null);
  const [imageDimensions, setImageDimensions] = createSignal<{ width: number; height: number } | null>(null);
  const [editorDirty, setEditorDirty] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const hasUnsavedChanges = () => Boolean(preview() && !preview()!.readOnly && !preview()!.truncated && editorDirty());
  const label = props.slot === "primary" ? "File preview" : "Second file preview";
  const closeLabel = props.slot === "primary" ? "Close file" : "Close second file";

  let controller: AbortController | null = null;
  let editor: WorkspaceEditorHandle | undefined;
  let loadToken = 0;
  const releaseAsset = () => {
    const current = asset();
    if (current?.url.startsWith("blob:")) URL.revokeObjectURL(current.url);
  };
  const clear = () => {
    releaseAsset();
    batch(() => {
      setPreview(null);
      setAsset(null);
      setEditorDirty(false);
      setEditing(false);
      setImageDimensions(null);
    });
    props.onLoaded?.(null);
  };

  const normalizeMetadata = (path: string, metadata: FileMetadata): FileMetadata & { kind: FileKind; mime: string } => {
    const kind = metadata.kind || fallbackKind(path);
    return { ...metadata, kind, mime: metadata.mime || fallbackMime(path, kind) };
  };

  const loadMedia = async (metadata: FileMetadata & { kind: Exclude<FileKind, "text">; mime: string }, projectId: string, owns: () => boolean) => {
    const path = metadata.path;
    // A page shows the hub's own files by address; a device's it reads from the device when it can, as the apps do.
    if (!isInstalledClient() && !(await directAvailable(projectId))) {
      if (!owns()) return;
      const url = httpUrl(`/v0/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}&inline=1&revision=${encodeURIComponent(metadata.revision || "")}`);
      if (asset()?.url !== url) {
        releaseAsset();
        batch(() => {
          setPreview(null);
          setEditorDirty(false);
          setEditing(false);
          setImageDimensions(null);
          setAsset({ ...metadata, url, oversize: false });
        });
      }
      props.onLoaded?.(metadata);
      return;
    }
    if (metadata.size > MAX_INLINE_IMAGE_BYTES) {
      releaseAsset();
      batch(() => {
        setPreview(null);
        setAsset({ ...metadata, url: "", oversize: true });
      });
      props.onLoaded?.({ path, size: metadata.size, kind: metadata.kind, mime: metadata.mime });
      return;
    }
    const current = asset();
    const headers: HeadersInit = current?.path === path && current.revision && current.revision === metadata.revision
      ? { "if-none-match": `"${metadata.revision}"` }
      : {};
    const response = await workspaceFileResponse(projectId, `path=${encodeURIComponent(path)}&download=1`, { signal: controller?.signal, headers });
    if (response.status === 304 && current?.url) {
      props.onLoaded?.({ path, size: metadata.size, kind: metadata.kind, mime: metadata.mime });
      return;
    }
    if (!response.ok) throw new Error(`Could not load ${path}`);
    const blob = new Blob([await response.arrayBuffer()], { type: metadata.mime });
    if (!owns()) return;
    releaseAsset();
    batch(() => {
      setPreview(null);
      setEditorDirty(false);
      setEditing(false);
      setImageDimensions(null);
      setAsset({ ...metadata, url: URL.createObjectURL(blob), oversize: false });
    });
    props.onLoaded?.({ path, size: metadata.size, kind: metadata.kind, mime: metadata.mime });
  };

  const loadText = async (path: string, projectId: string, owns: () => boolean, options: { forceText?: boolean; preview?: boolean }) => {
    const replacesOpenDocument = preview()?.path === path;
    const query = [options.forceText && "force=text", options.preview && "preview=1"].filter(Boolean).join("&");
    const payload = await workspaceFileJson<FilePreview>(projectId, `path=${encodeURIComponent(path)}${query ? `&${query}` : ""}`, { signal: controller?.signal });
    if (!owns()) return;
    if (replacesOpenDocument && editorDirty()) return;
    releaseAsset();
    batch(() => {
      setAsset(null);
      setImageDimensions(null);
      setPreview({ ...payload, kind: "text", mime: payload.mime || "text/plain" });
      setEditorDirty(false);
      setEditing(false);
    });
    if (replacesOpenDocument) editor?.replaceDocument(payload.content);
    else editor?.openDocument(payload.path, payload.content);
    props.onLoaded?.({ path: payload.path, size: payload.size, kind: "text", mime: payload.mime });
  };

  const load = async (background = false, options: { forceText?: boolean; preview?: boolean } = {}) => {
    const path = props.path;
    const projectId = props.projectId;
    if (!path) {
      clear();
      return;
    }
    controller?.abort();
    controller = new AbortController();
    const token = ++loadToken;
    const owns = () => token === loadToken && props.path === path && props.projectId === projectId;
    if (fallbackKind(path) === "text") void loadWorkspaceEditor().catch(() => undefined);
    if (asset()?.path !== path && preview()?.path !== path) {
      const kind = fallbackKind(path);
      if (kind === "text" && preview()) {
        releaseAsset();
        batch(() => {
          setAsset(null);
          setImageDimensions(null);
        });
      } else {
        clear();
      }
      if (kind !== "text" && kind !== "binary") {
        setAsset({ path, kind, mime: fallbackMime(path, kind), size: 0, createdAt: null, modifiedAt: 0, url: "", oversize: false });
      }
    }
    try {
      await loadText(path, projectId, owns, options);
    } catch (cause) {
      if (controller?.signal.aborted || !owns()) return;
      const code = errorCode(cause);
      if (["file_not_text", "file_too_large"].includes(code)) {
        const metadataPayload = metadataFromError(path, cause) ?? await workspaceFileJson<FileMetadata>(projectId,
          `path=${encodeURIComponent(path)}&metadata=1`, { signal: controller.signal }).catch(() => null);
        if (!metadataPayload) {
          clear();
          if (!background) props.onError((cause as Error).message);
          return;
        }
        if (!owns()) return;
        const metadata = normalizeMetadata(path, metadataPayload);
        if (code === "file_not_text" && metadata.kind !== "binary" && metadata.kind !== "text" && !options.forceText) {
          await loadMedia({ ...metadata, kind: metadata.kind }, projectId, owns);
          return;
        }
        if (code === "file_not_text" && metadata.kind === "binary" && !options.forceText) {
          releaseAsset();
          batch(() => {
            setPreview(null);
            setAsset({ ...metadata, kind: "binary", mime: metadata.mime, url: "", oversize: false });
            setEditorDirty(false);
            setEditing(false);
            setImageDimensions(null);
          });
          props.onLoaded?.({ path, size: metadata.size, kind: "binary", mime: metadata.mime });
          return;
        }
        if (code === "file_too_large" && !options.preview) {
          releaseAsset();
          batch(() => {
            setAsset(null);
            setPreview({ ...metadata, kind: "text", mime: metadata.mime, revision: metadata.revision || "", content: "", truncated: true, readOnly: true });
            setEditorDirty(false);
            setEditing(false);
          });
          props.onLoaded?.({ path, size: metadata.size, kind: "text", mime: metadata.mime });
          return;
        }
      }
      clear();
      if (code === "path_not_found") props.onRemoved(path, false);
      // A device away is the workspace's state, shown on it; the tab loads again when the device is back.
      else if (!background && code !== "device_offline") props.onError((cause as Error).message);
    }
  };

  const openAsText = () => void load(false, { forceText: true });
  const loadLargeText = () => void load(false, { preview: true });

  // Reload only when this slot's own file actually changes: the parent hands
  // down a fresh object whenever *either* slot moves, and a re-read of an
  // unchanged path must never discard this slot's local document.
  let loadedKey: string | null = null;
  createEffect(on(() => [props.projectId, props.path] as const, ([projectId, path]) => {
    const key = `${projectId}\u0000${path ?? ""}`;
    if (key === loadedKey) return;
    loadedKey = key;
    void load();
  }));

  const save = async (content?: string) => {
    const file = preview();
    if (!file || !hasUnsavedChanges() || saving()) return;
    const submittedEditor = editor;
    const submittedContent = content ?? submittedEditor?.getValue() ?? file.content;
    setSaving(true);
    try {
      const written = await api<FileWriteResult>(
        `/v0/projects/${encodeURIComponent(props.projectId)}/file?path=${encodeURIComponent(file.path)}`,
        { method: "PUT", headers: { "content-type": "application/octet-stream", "if-match": file.revision }, body: submittedContent },
      );
      if (preview()?.path === file.path) {
        const next = { ...file, ...written, content: submittedContent };
        setPreview(next);
        if (editor === submittedEditor) submittedEditor?.acknowledgeSaved(submittedContent);
        props.onLoaded?.(next);
        props.onSaved?.();
      }
    } catch (cause) {
      props.onError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const edit = async () => {
    if (!preview()) return;
    setEditing(true);
  };

  const download = async () => {
    const file = preview()?.path || asset()?.path;
    if (!file) return;
    try {
      const response = await workspaceFileResponse(props.projectId, `path=${encodeURIComponent(file)}&download=1`);
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        const message = body && typeof body === "object" && "message" in body ? String(body.message) : "Download failed";
        throw new Error(message);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = file.split("/").at(-1) || "download";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      props.onError((cause as Error).message);
    }
  };

  props.ref?.({
    path: () => props.path,
    hasUnsavedChanges,
    reload: async () => { if (!hasUnsavedChanges()) await load(true); },
    edit: () => { if (preview() && !preview()!.readOnly && !preview()!.truncated) setEditing(true); },
    save,
    discardChanges: () => {
      const file = preview();
      if (!file) return;
      editor?.replaceDocument(file.content);
      setEditorDirty(false);
    },
  });

  onCleanup(() => {
    controller?.abort();
    releaseAsset();
    props.onDispose?.();
  });

  const currentText = () => editor?.getValue() ?? preview()?.content ?? "";
  const copy = (value?: string) => { if (value) void navigator.clipboard.writeText(value); };

  const editable = () => Boolean(preview() && !preview()!.readOnly && !preview()!.truncated);
  const hasChanges = () => Boolean(props.gitFile && (props.gitFile.status === "??" || props.gitFile.status[1] !== " "));
  const hasStaged = () => Boolean(props.gitFile && props.gitFile.status[0] !== " " && props.gitFile.status[0] !== "?");
  /*
   * A file viewer's header folds its actions one at a time (data-fold, first to
   * fold first) into its ⋯, which the viewer measures (workspace-file-viewer.tsx)
   * and reports with a "headerfold" event; the ⋯ lists only what has folded,
   * besides copying and wrapping, which live there.
   */
  const [folded, setFolded] = createSignal<string[]>([]);
  const isFolded = (action: string) => folded().includes(action);
  const watchFolds = (element: HTMLElement) => queueMicrotask(() => {
    const header = element.closest("header");
    if (!header) return;
    const note = (event: Event) => setFolded((event as CustomEvent<string[]>).detail);
    header.addEventListener("headerfold", note);
    onCleanup(() => header.removeEventListener("headerfold", note));
  });
  const pressHidden = (label: string, from: Element | null | undefined) => from?.closest("header")?.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.click();
  let moreAnchor: HTMLElement | undefined;
  const fileActions = () => <FileActions ref={watchFolds}>
    <Show when={hasChanges()}><FileButton type="button" data-fold="4" aria-label="Review unstaged changes" title="Review unstaged changes" onClick={(event) => props.onShowDiff?.(false, event.altKey)}><Icons.FileDiff /></FileButton></Show>
    <Show when={hasStaged()}><FileButton type="button" data-fold="3" aria-label="Review staged changes" title="Review staged changes" onClick={(event) => props.onShowDiff?.(true, event.altKey)}><Icons.GitCompareArrows /></FileButton></Show>
    <FileButton type="button" inMenu aria-label="Copy contents" title="Copy contents" onClick={() => copy(currentText())}><Icons.Copy /></FileButton>
    <FileButton type="button" inMenu aria-label="Copy path" title="Copy path" onClick={() => copy(props.path ?? "")}><Icons.FileCode /></FileButton>
    <FileButton type="button" data-fold="0" aria-label="Download working file" title="Download working file" onClick={() => void download()}><Icons.Download /></FileButton>
  </FileActions>;
  const moreMenu = (text: boolean) => <DropdownMenu modal={false}>
    <MenuControl as={FileMore} aria-label="More file actions" title="More file actions" ref={moreAnchor} />
    <MenuContent>
      <Show when={hasChanges() && isFolded("4")}><MenuRow onSelect={() => props.onShowDiff?.(false)} icon={<Icons.FileDiff />}>Review unstaged changes</MenuRow></Show>
      <Show when={hasStaged() && isFolded("3")}><MenuRow onSelect={() => props.onShowDiff?.(true)} icon={<Icons.GitCompareArrows />}>Review staged changes</MenuRow></Show>
      <Show when={text && isFolded("2")}><MenuRow onSelect={() => pressHidden("Find or replace", moreAnchor)} icon={<Icons.Search />}>Find or replace</MenuRow></Show>
      {props.headerMenuItems?.(isFolded)}
      <Show when={isFolded("0")}><MenuRow onSelect={() => void download()} icon={<Icons.Download />}>Download</MenuRow></Show>
      <Show when={text}><MenuRow onSelect={() => props.onToggleWrap()} icon={<Icons.WrapText />}>{props.wrap ? "Stop wrapping lines" : "Wrap lines"}</MenuRow></Show>
      <Show when={text}><MenuRow onSelect={() => copy(currentText())} icon={<Icons.Copy />}>Copy contents</MenuRow></Show>
      <MenuRow onSelect={() => copy(props.path ?? "")} icon={<Icons.FileCode />}>Copy path</MenuRow>
    </MenuContent>
  </DropdownMenu>;
  const gitControls = () => <Show when={props.gitFile}>{(file) =>
    <FileGit status={file().status === "??" ? "U" : file().status.trim()} />
  }</Show>;
  const textHeader = () => <>
    <Show when={props.headerPrefix}>{props.headerPrefix}</Show>
    <Show when={props.headerTabs} fallback={<FileName path={props.path ?? ""} icon={<FileTypeIcon name={props.path ?? ""} />} />}>{props.headerTabs}</Show>
    {gitControls()}
    <Show when={!props.headerTabs}><FileDirty dirty={hasUnsavedChanges()} /></Show>
    <Show when={hasUnsavedChanges()}>
      <FileButton wide type="button" aria-label="Save file" title="Save file (Ctrl+S)" disabled={saving()} onClick={() => void save()}><Show when={saving()} fallback={<SaveIcon />}><Spinner /></Show>Save</FileButton>
    </Show>
    {fileActions()}
    <FileSuffix>{props.headerSuffix}</FileSuffix>
    {/* A header too narrow for its actions keeps them here, and the file's name in view. */}
    {moreMenu(true)}
    <Show when={props.closable && !props.headerTabs}><FileButton type="button" close aria-label={closeLabel} title={closeLabel} onClick={props.onClose}><Icons.Close /></FileButton></Show>
    {props.headerEnd}
  </>;
  const previewStatus = (file: FileMetadata & { kind: FileKind; mime: string }) => <StatusBar commands={
    <StatusText>Working copy</StatusText>
  }>
    <Show when={file.kind === "image" && imageDimensions()}>{(dimensions) =>
      <StatusText>{dimensions().width} × {dimensions().height}</StatusText>
    }</Show>
    <StatusText>{formatFileSize(file.size)}</StatusText>
    <StatusText>{file.mime}</StatusText>
    <Show when={fileTimeMetadata(file)}>{(metadata) =>
      <StatusText><span title={metadata()}>{metadata()}</span></StatusText>
    }</Show>
  </StatusBar>;

  return <ContextMenu>
    <ContextMenuTrigger
      as={FileView}
      tabIndex={-1}
      data-slot={props.slot}
      focused={props.focused}
      aria-label={label}
      onFocusIn={props.onFocus}
      onPointerDown={props.onFocus}
    >
      <Show when={asset()}>{(file) => <>
        <FileHead>
          <Show when={props.headerPrefix}>{props.headerPrefix}</Show>
          <Show when={props.headerTabs} fallback={<FileName path={file().path} icon={<FileTypeIcon name={file().path} />} />}>{props.headerTabs}</Show>
          {gitControls()}
          <FileButton type="button" data-fold="0" ref={watchFolds} aria-label="Download file" title="Download file" onClick={() => void download()}><Icons.Download /></FileButton>
          <FileButton type="button" inMenu aria-label="Copy file path" title="Copy file path" onClick={() => copy(file().path)}><Icons.Copy /></FileButton>
          {props.headerSuffix}
          <Show when={props.headerTabs}>{moreMenu(false)}</Show>
          <Show when={props.closable && !props.headerTabs}>
            <FileButton type="button" close aria-label={closeLabel} title={closeLabel} onClick={props.onClose}><Icons.Close /></FileButton>
          </Show>
          {props.headerEnd}
        </FileHead>
        <Show when={!file().url && !file().oversize && file().kind !== "binary"}>
          <PaneEmpty><span role="status"><Spinner /> Loading {formatKind(file().kind).toLowerCase()}…</span></PaneEmpty>
        </Show>
        <Show when={file().url || file().oversize || file().kind === "binary"}>
        <Show when={file().kind === "image"}>
          <Show
            when={!file().oversize}
            fallback={<PaneEmpty>This image is {formatFileSize(file().size)}, past the {formatFileSize(MAX_INLINE_IMAGE_BYTES)} preview limit. Download it to view.</PaneEmpty>}
          >
            <FileImage>
              <img
                src={file().url}
                alt={file().path}
                onLoad={(event) => setImageDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              />
            </FileImage>
          </Show>
        </Show>
        <Show when={file().kind !== "image" && file().kind !== "binary"}>
          <Show when={!file().oversize} fallback={<PaneEmpty>This file exceeds the 100 MiB preview limit. Download it to open.</PaneEmpty>}>
            <FileMedia>
              <Show when={file().kind === "audio"}>
                <audio controls preload="metadata" src={file().url} aria-label={file().path} onError={() => props.onError("This browser cannot play this audio file. Download it to open in another player.")} />
              </Show>
              <Show when={file().kind === "video"}>
                <video controls playsinline preload="metadata" src={file().url} aria-label={file().path} onError={() => props.onError("This browser cannot play this video file. Download it to open in another player.")} />
              </Show>
              <Show when={file().kind === "pdf"}>
                <object data={file().url} type="application/pdf" aria-label={file().path}>
                  <Button variant="secondary" size="sm" onClick={() => void download()}>Download PDF</Button>
                </object>
              </Show>
            </FileMedia>
          </Show>
        </Show>
        <Show when={file().kind === "binary"}>
          <FileCard>
            <strong>{formatKind(file().kind)}</strong>
            <span>{file().mime} · {formatFileSize(file().size)} · {fileTimeMetadata(file())}</span>
            <Show when={file().kind === "binary"}>
              <code>{formatHexHead(file().head)}</code>
              <Button variant="secondary" size="sm" onClick={openAsText}>Open as text anyway</Button>
            </Show>
          </FileCard>
        </Show>
        </Show>
        {previewStatus(file())}
      </>}</Show>
      <Show when={!asset()}>
        <Show when={preview()} fallback={<>
          <Show when={props.headerPrefix}><FileHead>{props.headerPrefix}</FileHead></Show>
          <PaneEmpty>{props.empty ?? "Select a file to preview it."}</PaneEmpty>
        </>}>{(file) => <>
          <Show when={file().readOnly && !file().truncated}>
            <ToolNotice tone="warn">Opened as text. Editing is disabled.</ToolNotice>
          </Show>
          <Show when={file().truncated} fallback={<FileBody editing={editing()} wrap={props.wrap}>
            <Show when={file().path}>{(path) =>
              <Suspense fallback={<PaneEmpty>Loading preview…</PaneEmpty>}>
                <WorkspaceEditor
                  header={textHeader()}
                  ref={(handle) => { editor = handle; }}
                  path={path()}
                  value={file().content}
                  wrap={props.wrap}
                  editable={editing()}
                  canEdit={editable()}
                  statusText={["Working copy", hasUnsavedChanges() ? "Unsaved" : editing() ? "Editing" : "", formatFileSize(file().size)].filter(Boolean).join(" · ")}
                  statusTitle={[hasUnsavedChanges() ? "Unsaved" : formatFileSize(file().size), fileTimeMetadata(file())].filter(Boolean).join(" · ")}
                  onDirtyChange={setEditorDirty}
                  onSave={(value) => void save(value)}
                  onToggleEditing={() => editing() ? setEditing(false) : void edit()}
                  onToggleWrap={props.onToggleWrap}
                  commentHighlights={reviewComments(props.annotationChatId ?? "").filter((comment) => comment.scope === "file" && comment.path === file().path)}
                  reveal={props.reveal}
                  onAnnotate={props.annotationChatId ? (selection, note) => {
                    const chatId = props.annotationChatId;
                    if (!chatId) return false;
                    return addReviewComment({
                      id: `rc_${crypto.randomUUID()}`,
                      chatId,
                      path: file().path,
                      side: selection.side,
                      scope: "file",
                      from: selection.from,
                      to: selection.to,
                      startColumn: selection.startColumn,
                      endColumn: selection.endColumn,
                      excerpt: selection.excerpt,
                      note,
                    });
                  } : undefined}
                />
              </Suspense>
            }</Show>
          </FileBody>}>
            <FileHead>{textHeader()}</FileHead>
            <FileCard>
              <strong>This text file is larger than the 25 MiB preview limit.</strong>
              <span>Download the complete file, or load the first 25 MiB as read-only text.</span>
              <Button variant="secondary" size="sm" onClick={loadLargeText}>Load first 25 MiB</Button>
            </FileCard>
            {previewStatus({ ...file(), kind: "text" })}
          </Show>
        </>}</Show>
      </Show>
    </ContextMenuTrigger>
    <Show when={preview() || asset()}>{(file) =>
      <ContextMenuContent>
        <MenuSection>
          <Show when={preview()}>
            <MenuRow disabled={!editable()} onSelect={() => void edit()} icon={<Icons.Edit />}>Edit</MenuRow>
            <MenuRow disabled={!hasUnsavedChanges() || saving()} onSelect={() => void save()} icon={<SaveIcon />}>Save</MenuRow>
            <MenuRow onSelect={() => copy(currentText())} icon={<Icons.Copy />}>Copy contents</MenuRow>
          </Show>
          <MenuRow onSelect={() => void download()} icon={<Icons.Download />}>Download</MenuRow>
          <Show when={props.onReplace}><MenuRow disabled={props.busy || saving()} onSelect={() => props.onReplace?.(file().path)} icon={<Icons.Upload />}>Replace with upload…</MenuRow></Show>
          <MenuRow onSelect={() => copy(file().path)} icon={<Icons.Copy />}>Copy path</MenuRow>
        </MenuSection>
        <Rule />
        <MenuRow destructive disabled={props.busy || saving()} onSelect={() => props.onDelete(file().path)} icon={<Icons.Delete />}>Delete file</MenuRow>
      </ContextMenuContent>
    }</Show>
  </ContextMenu>;
}
