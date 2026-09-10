import { WorkbenchButton } from "./workspace-workbench";
import { batch, createEffect, createSignal, lazy, on, onCleanup, Show, Suspense, type JSX } from "solid-js";
import { CopyIcon, DownloadIcon, GitCompareArrowsIcon, PencilIcon, SaveIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-solid";
import { toast } from "solid-sonner";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, Spinner } from "@/components/primitives";
import { api } from "../api/client";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl } from "../api/transport";
import { FileTypeIcon } from "./file-type-icon";
import { Capacitor } from "@capacitor/core";
import type { WorkspaceEditorHandle } from "./workspace-editor";
import type { ComparisonPayload, ComparisonViewState } from "./workspace-comparison";

const WorkspaceComparison = lazy(() => import("./workspace-comparison"));
export interface TemporaryComparison { comparison: ComparisonPayload; viewState: ComparisonViewState; }

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
const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;

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
  height?: string;
  onToggleWrap: () => void;
  onFocus: () => void;
  onClose: () => void;
  onError: (message: string) => void;
  // announce: the file vanished while it was on screen, which is worth saying.
  // A stale stored path that simply does not exist here clears in silence.
  onRemoved: (path: string, announce: boolean) => void;
  onReplace: (path: string) => void;
  onDelete: (path: string) => void;
  onLoaded?: (file: FileSummary | null) => void;
  navigation?: { source: string; position: number };
  onNavigated?: () => void;
  onSaved?: () => void;
  comparison?: TemporaryComparison;
  onEditComparison?: (source: string, position: number) => void;
  gitFile?: { status: string; stagedCounts?: { added: number; removed: number } | null; workingCounts?: { added: number; removed: number } | null };
  onShowDiff?: (staged: boolean) => void;
  onShowFile?: () => void;
  onRestoreComparison?: (comparison: TemporaryComparison) => void;
  onDispose?: () => void;
  ref?: (handle: FileSlotHandle) => void;
}) {
  const [retainedComparison, setRetainedComparison] = createSignal<TemporaryComparison>();
  createEffect(() => {
    const incoming = props.comparison;
    const path = props.path;
    const projectId = props.projectId;
    setRetainedComparison((previous) => incoming ?? (retainedProject === projectId && previous?.comparison.path === path ? previous : undefined));
    retainedProject = projectId;
  });
  let retainedProject = props.projectId;
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
    if (!Capacitor.isNativePlatform()) {
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
    const response = await authorizedFetch(
      httpUrl(`/v0/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}&download=1`),
      { signal: controller?.signal, headers },
    );
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
    const payload = await api<FilePreview>(
      `/v0/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}${query ? `&${query}` : ""}`,
      { signal: controller?.signal },
    );
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
    if (props.comparison) return;
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
        const metadataPayload = metadataFromError(path, cause) ?? await api<FileMetadata>(
          `/v0/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}&metadata=1`,
          { signal: controller.signal },
        ).catch(() => null);
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
      else if (!background) props.onError((cause as Error).message);
    }
  };

  const openAsText = () => void load(false, { forceText: true });
  const loadLargeText = () => void load(false, { preview: true });

  // Reload only when this slot's own file actually changes: the parent hands
  // down a fresh object whenever *either* slot moves, and a re-read of an
  // unchanged path must never discard this slot's local document.
  let loadedKey: string | null = null;
  createEffect(on(() => [props.projectId, props.path, Boolean(props.comparison)] as const, ([projectId, path, comparison]) => {
    if (comparison) {
      const key = `${projectId}\u0000${path ?? ""}`;
      if (key !== loadedKey) {
        controller?.abort();
        loadToken++;
        clear();
        loadedKey = null;
      }
      return;
    }
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

  createEffect(() => {
    if (props.navigation && preview()?.path === props.path && !preview()?.readOnly && !preview()?.truncated) setEditing(true);
  });

  const download = async () => {
    const file = preview()?.path || asset()?.path || props.comparison?.comparison.path;
    if (!file) return;
    try {
      const response = await authorizedFetch(httpUrl(`/v0/projects/${encodeURIComponent(props.projectId)}/file?path=${encodeURIComponent(file)}&download=1`));
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
  const gitControls = () => <Show when={props.gitFile}>{(file) => <>
    <code class="workspace-file-git-status" data-status={file().status === "??" ? "U" : file().status.trim()} title="Git status">{file().status === "??" ? "U" : file().status.trim()}</code>
    <Show when={hasChanges()}><WorkbenchButton type="button" class="workspace-file-diff-button" title="Show working-copy changes" aria-label="Show Changes diff" onClick={() => props.onShowDiff?.(false)}><GitCompareArrowsIcon /><span>Changes</span><Show when={file().workingCounts}>{(count) => <><span class="workspace-git-removed">−{count().removed}</span><span class="workspace-git-added">+{count().added}</span></>}</Show></WorkbenchButton></Show>
    <Show when={hasStaged()}><WorkbenchButton type="button" class="workspace-file-diff-button" title="Show staged changes" aria-label="Show Staged diff" onClick={() => props.onShowDiff?.(true)}><GitCompareArrowsIcon /><span>Staged</span><Show when={file().stagedCounts}>{(count) => <><span class="workspace-git-removed">−{count().removed}</span><span class="workspace-git-added">+{count().added}</span></>}</Show></WorkbenchButton></Show>
  </>}</Show>;
  const textHeader = () => <header class="workspace-preview-header">
    <Show when={props.headerPrefix}>{props.headerPrefix}</Show>
    <div class="workspace-preview-file" title={props.path ?? ""}><FileTypeIcon name={props.path ?? ""} /><span>{props.path}</span></div>
    {gitControls()}
    <span class="workspace-preview-dirty" data-dirty={hasUnsavedChanges()} aria-hidden="true" />
    <WorkbenchButton type="button" class="workspace-preview-action" aria-label="Save file" title="Save file (Ctrl+S)" disabled={Boolean(props.comparison) || !hasUnsavedChanges() || saving()} onClick={() => void save()}><Show when={saving()} fallback={<SaveIcon />}><Spinner /></Show></WorkbenchButton>
    <WorkbenchButton type="button" class="workspace-preview-copy" aria-label="Copy file contents" title="Copy file contents" onClick={() => { const compared = props.comparison?.comparison; void copy(compared?.kind === "text" ? compared.modified : currentText()); }}><CopyIcon /></WorkbenchButton>
    <WorkbenchButton type="button" class="workspace-preview-action" aria-label="Download file" title="Download working file" onClick={() => void download()}><DownloadIcon /></WorkbenchButton>
    <Show when={props.closable}><WorkbenchButton type="button" class="workspace-preview-action workspace-preview-close" aria-label={closeLabel} title={closeLabel} onClick={props.onClose}><XIcon /></WorkbenchButton></Show>
  </header>;

  return <ContextMenu>
    <ContextMenuTrigger
      as="section"
      class="workspace-preview"
      data-slot={props.slot}
      data-focused={props.focused}
      aria-label={label}
      style={props.height ? { height: props.height } : undefined}
      onFocusIn={props.onFocus}
      onPointerDown={props.onFocus}
    >
      <div class="workspace-file-representation" hidden={!props.comparison}>
        <Show when={retainedComparison()}>{(temporary) => <Suspense fallback={<div class="workspace-panel-empty">Loading comparison…</div>}>
          <WorkspaceComparison comparison={temporary().comparison} viewState={temporary().viewState} inFiles header={textHeader()} onViewStateChange={(viewState) => setRetainedComparison((current) => current ? { ...current, viewState } : current)} onShowFile={props.onShowFile} onOpenFile={(source, position) => props.onEditComparison?.(source, position)} />
        </Suspense>}</Show>
      </div>
      <div class="workspace-file-representation" hidden={Boolean(props.comparison)}>
      <Show when={asset()}>{(file) => <>
        <header class="workspace-preview-header">
          <Show when={props.headerPrefix}>{props.headerPrefix}</Show>
          <div class="workspace-preview-file" title={file().path}><FileTypeIcon name={file().path} /><span>{file().path}</span></div>
          {gitControls()}
          <small>{[file().kind === "image" && imageDimensions() && `${imageDimensions()!.width} × ${imageDimensions()!.height}`, formatFileSize(file().size), file().mime, fileTimeMetadata(file())].filter(Boolean).join(" · ")}</small>
          <WorkbenchButton type="button" class="workspace-preview-action" aria-label="Download file" title="Download file" onClick={() => void download()}><DownloadIcon /></WorkbenchButton>
          <WorkbenchButton type="button" class="workspace-preview-copy" aria-label="Copy file path" title="Copy file path" onClick={() => copy(file().path)}><CopyIcon /></WorkbenchButton>
          <Show when={props.closable}>
            <WorkbenchButton type="button" class="workspace-preview-action workspace-preview-close" aria-label={closeLabel} title={closeLabel} onClick={props.onClose}><XIcon /></WorkbenchButton>
          </Show>
        </header>
        <Show when={!file().url && !file().oversize && file().kind !== "binary"}>
          <div class="workspace-panel-empty" role="status"><Spinner /> Loading {formatKind(file().kind).toLowerCase()}…</div>
        </Show>
        <Show when={file().url || file().oversize || file().kind === "binary"}>
        <Show when={file().kind === "image"}>
          <Show
            when={!file().oversize}
            fallback={<div class="workspace-panel-empty">This image is {formatFileSize(file().size)}, past the {formatFileSize(MAX_INLINE_IMAGE_BYTES)} preview limit. Download it to view.</div>}
          >
            <div class="workspace-preview-image">
              <img
                src={file().url}
                alt={file().path}
                onLoad={(event) => setImageDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              />
            </div>
          </Show>
        </Show>
        <Show when={file().kind !== "image" && file().kind !== "binary"}>
          <Show when={!file().oversize} fallback={<div class="workspace-panel-empty">This file exceeds the 100 MiB preview limit. Download it to open.</div>}>
            <div class="workspace-preview-media">
              <Show when={file().kind === "audio"}>
                <audio controls preload="metadata" src={file().url} aria-label={file().path} onError={() => props.onError("This browser cannot play this audio file. Download it to open in another player.")} />
              </Show>
              <Show when={file().kind === "video"}>
                <video controls playsinline preload="metadata" src={file().url} aria-label={file().path} onError={() => props.onError("This browser cannot play this video file. Download it to open in another player.")} />
              </Show>
              <Show when={file().kind === "pdf"}>
                <object data={file().url} type="application/pdf" aria-label={file().path}>
                  <WorkbenchButton type="button" class="workspace-file-kind-action" onClick={() => void download()}>Download PDF</WorkbenchButton>
                </object>
              </Show>
            </div>
          </Show>
        </Show>
        <Show when={file().kind === "binary"}>
          <div class="workspace-file-kind-card">
            <strong>{formatKind(file().kind)}</strong>
            <span>{file().mime} · {formatFileSize(file().size)} · {fileTimeMetadata(file())}</span>
            <Show when={file().kind === "binary"}>
              <code>{formatHexHead(file().head)}</code>
              <WorkbenchButton type="button" class="workspace-file-kind-action" onClick={openAsText}>Open as text anyway</WorkbenchButton>
            </Show>
          </div>
        </Show>
        </Show>
      </>}</Show>
      <Show when={!asset()}>
        <Show when={preview()} fallback={<>
          <Show when={props.headerPrefix}><header class="workspace-preview-header">{props.headerPrefix}</header></Show>
          <div class="workspace-panel-empty">Select a file to preview it.</div>
        </>}>{(file) => <>
          {textHeader()}
          <Show when={file().readOnly && !file().truncated}>
            <div class="workspace-file-readonly-notice">Opened as text. Editing is disabled.</div>
          </Show>
          <Show when={file().truncated} fallback={<div class="workspace-preview-editor" data-editing={editing()} data-wrap={props.wrap}>
            <Show when={file().path}>{(path) =>
              <Suspense fallback={<div class="workspace-panel-empty">Loading preview…</div>}>
                <WorkspaceEditor
                  ref={(handle) => { editor = handle; }}
                  path={path()}
                  value={file().content}
                  wrap={props.wrap}
                  reveal={file().path === props.path ? props.navigation : undefined}
                  onRevealed={props.onNavigated}
                  onShowDiff={props.gitFile || retainedComparison() ? () => {
                    const retained = retainedComparison();
                    if (retained && props.onRestoreComparison) props.onRestoreComparison(retained);
                    else props.onShowDiff?.(!hasChanges());
                  } : undefined}
                  editable={editing()}
                  canEdit={editable()}
                  statusText={[hasUnsavedChanges() ? "Unsaved" : formatFileSize(file().size), formatFileTime(file().modifiedAt)].filter(Boolean).join(" · ")}
                  statusTitle={[hasUnsavedChanges() ? "Unsaved" : formatFileSize(file().size), fileTimeMetadata(file())].filter(Boolean).join(" · ")}
                  onDirtyChange={setEditorDirty}
                  onSave={(value) => void save(value)}
                  onToggleEditing={() => editing() ? setEditing(false) : void edit()}
                  onToggleWrap={props.onToggleWrap}
                />
              </Suspense>
            }</Show>
          </div>}>
            <div class="workspace-file-kind-card">
              <strong>This text file is larger than the 25 MiB preview limit.</strong>
              <span>Download the complete file, or load the first 25 MiB as read-only text.</span>
              <WorkbenchButton type="button" class="workspace-file-kind-action" onClick={loadLargeText}>Load first 25 MiB</WorkbenchButton>
            </div>
          </Show>
        </>}</Show>
      </Show>
      </div>
    </ContextMenuTrigger>
    <Show when={preview() || asset()}>{(file) =>
      <ContextMenuContent shortcutScope="workspace-panel" class="w-48 workspace-file-menu">
        <ContextMenuGroup>
          <Show when={preview()}>
            <ContextMenuItem disabled={!editable()} onSelect={() => void edit()}><PencilIcon />Edit</ContextMenuItem>
            <ContextMenuItem disabled={!hasUnsavedChanges() || saving()} onSelect={() => void save()}><SaveIcon />Save</ContextMenuItem>
            <ContextMenuItem onSelect={() => copy(currentText())}><CopyIcon />Copy contents</ContextMenuItem>
          </Show>
          <ContextMenuItem onSelect={() => void download()}><DownloadIcon />Download</ContextMenuItem>
          <ContextMenuItem disabled={props.busy || saving()} onSelect={() => props.onReplace(file().path)}><UploadIcon />Replace with upload…</ContextMenuItem>
          <ContextMenuItem onSelect={() => copy(file().path)}><CopyIcon />Copy path</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" disabled={props.busy || saving()} onSelect={() => props.onDelete(file().path)}><Trash2Icon />Delete file</ContextMenuItem>
      </ContextMenuContent>
    }</Show>
  </ContextMenu>;
}
