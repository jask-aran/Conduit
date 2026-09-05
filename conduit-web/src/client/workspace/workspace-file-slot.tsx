import { batch, createEffect, createSignal, lazy, on, onCleanup, Show, Suspense, type JSX } from "solid-js";
import { CopyIcon, DownloadIcon, PencilIcon, SaveIcon, Trash2Icon, UploadIcon, WrapTextIcon, XIcon } from "lucide-solid";
import { toast } from "solid-sonner";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, Spinner } from "@/components/primitives";
import { api } from "../api/client";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl } from "../api/transport";
import { FileTypeIcon } from "./file-type-icon";
import { Capacitor } from "@capacitor/core";

const WorkspaceEditor = lazy(() => import("./workspace-editor"));

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

function isAssetKind(kind: FileKind): kind is Exclude<FileKind, "text"> {
  return kind !== "text";
}

function formatHexHead(head = ""): string {
  return head.match(/.{1,2}/g)?.join(" ") || "No content prefix available";
}

export interface FilePreview {
  path: string;
  size: number;
  modifiedAt: number;
  revision: string;
  kind: "text";
  mime: string;
  content: string;
  truncated?: boolean;
  readOnly?: boolean;
}
export interface FileSummary { path: string; size: number; kind?: FileKind; mime?: string; }
interface FileMetadata { path: string; size: number; modifiedAt: number; revision?: string; kind?: FileKind; mime?: string; head?: string; }
interface FileAsset extends FileMetadata { kind: Exclude<FileKind, "text">; mime: string; url: string; oversize: boolean; }
interface FileWriteResult { path: string; size: number; modifiedAt: number; revision: string; }

// The parent owns which paths are open; a slot owns everything about the file at
// its own path, so two slots never share load, draft, or save state.
export interface FileSlotHandle {
  path: () => string | null;
  hasUnsavedChanges: () => boolean;
  reload: () => Promise<void>;
  edit: () => void;
  save: () => Promise<void>;
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
  onDispose?: () => void;
  ref?: (handle: FileSlotHandle) => void;
}) {
  const [preview, setPreview] = createSignal<FilePreview | null>(null);
  const [asset, setAsset] = createSignal<FileAsset | null>(null);
  const [imageDimensions, setImageDimensions] = createSignal<{ width: number; height: number } | null>(null);
  const [draft, setDraft] = createSignal("");
  const [editing, setEditing] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const hasUnsavedChanges = () => Boolean(preview() && !preview()!.readOnly && !preview()!.truncated && draft() !== preview()!.content);
  const label = props.slot === "primary" ? "File preview" : "Second file preview";
  const closeLabel = props.slot === "primary" ? "Close file" : "Close second file";

  let controller: AbortController | null = null;
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
      setDraft("");
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
          setDraft("");
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
      setDraft("");
      setEditing(false);
      setImageDimensions(null);
      setAsset({ ...metadata, url: URL.createObjectURL(blob), oversize: false });
    });
    props.onLoaded?.({ path, size: metadata.size, kind: metadata.kind, mime: metadata.mime });
  };

  const loadText = async (path: string, projectId: string, owns: () => boolean, options: { forceText?: boolean; preview?: boolean }) => {
    const query = [options.forceText && "force=text", options.preview && "preview=1"].filter(Boolean).join("&");
    const payload = await api<FilePreview>(
      `/v0/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}${query ? `&${query}` : ""}`,
      { signal: controller?.signal },
    );
    if (!owns()) return;
    releaseAsset();
    batch(() => {
      setAsset(null);
      setImageDimensions(null);
      setPreview({ ...payload, kind: "text", mime: payload.mime || "text/plain" });
      setDraft(payload.content);
      setEditing(false);
    });
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
    if (asset()?.path !== path && preview()?.path !== path) {
      clear();
      const kind = fallbackKind(path);
      if (kind !== "text" && kind !== "binary") {
        setAsset({ path, kind, mime: fallbackMime(path, kind), size: 0, modifiedAt: 0, url: "", oversize: false });
      }
    }
    try {
      const metadata = normalizeMetadata(path, await api<FileMetadata>(
        `/v0/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}&metadata=1`,
        { signal: controller.signal },
      ));
      if (!owns()) return;
      if (metadata.kind !== "text" && metadata.kind !== "binary" && !options.forceText) {
        await loadMedia({ ...metadata, kind: metadata.kind }, projectId, owns);
        return;
      }
      const kind = metadata.kind;
      if (isAssetKind(kind) && !options.forceText) {
        releaseAsset();
        batch(() => {
          setPreview(null);
          setAsset({ ...metadata, kind, mime: metadata.mime, url: "", oversize: false });
          setDraft("");
          setEditing(false);
          setImageDimensions(null);
        });
        props.onLoaded?.({ path, size: metadata.size, kind, mime: metadata.mime });
        return;
      }
      if (metadata.size > MAX_PREVIEW_BYTES && !options.preview) {
        releaseAsset();
        batch(() => {
          setAsset(null);
          setPreview({ ...metadata, kind: "text", mime: metadata.mime, revision: metadata.revision || "", content: "", truncated: true, readOnly: true });
          setDraft("");
          setEditing(false);
        });
        props.onLoaded?.({ path, size: metadata.size, kind: "text", mime: metadata.mime });
        return;
      }
      await loadText(path, projectId, owns, options);
    } catch (cause) {
      if (controller?.signal.aborted || !owns()) return;
      clear();
      if (errorCode(cause) === "path_not_found") props.onRemoved(path, false);
      else if (!background) props.onError((cause as Error).message);
    }
  };

  const openAsText = () => void load(false, { forceText: true });
  const loadLargeText = () => void load(false, { preview: true });

  // Reload only when this slot's own file actually changes: the parent hands
  // down a fresh object whenever *either* slot moves, and a re-read of an
  // unchanged path must never discard this slot's draft.
  let loadedKey: string | null = null;
  createEffect(on(() => [props.projectId, props.path] as const, ([projectId, path]) => {
    const key = `${projectId}\u0000${path ?? ""}`;
    if (key === loadedKey) return;
    loadedKey = key;
    void load();
  }));

  const save = async () => {
    const file = preview();
    if (!file || !hasUnsavedChanges() || saving()) return;
    const submittedContent = draft();
    setSaving(true);
    try {
      const written = await api<FileWriteResult>(
        `/v0/projects/${encodeURIComponent(props.projectId)}/file?path=${encodeURIComponent(file.path)}`,
        { method: "PUT", headers: { "content-type": "application/octet-stream", "if-match": file.revision }, body: submittedContent },
      );
      const next = { ...file, ...written, content: submittedContent };
      setPreview(next);
      props.onLoaded?.(next);
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
  });

  onCleanup(() => {
    controller?.abort();
    releaseAsset();
    props.onDispose?.();
  });

  const copy = (value?: string) => { if (value) void navigator.clipboard.writeText(value); };

  const editable = () => Boolean(preview() && !preview()!.readOnly && !preview()!.truncated);

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
      <Show when={asset()}>{(file) => <>
        <header class="workspace-preview-header">
          <Show when={props.headerPrefix}>{props.headerPrefix}</Show>
          <div class="workspace-preview-file" title={file().path}><FileTypeIcon name={file().path} /><span>{file().path}</span></div>
          <small>{[file().kind === "image" && imageDimensions() && `${imageDimensions()!.width} × ${imageDimensions()!.height}`, formatFileSize(file().size), file().mime].filter(Boolean).join(" · ")}</small>
          <button type="button" class="workspace-preview-action" aria-label="Download file" title="Download file" onClick={() => void download()}><DownloadIcon /></button>
          <button type="button" class="workspace-preview-copy" aria-label="Copy file path" title="Copy file path" onClick={() => copy(file().path)}><CopyIcon /></button>
          <Show when={props.closable}>
            <button type="button" class="workspace-preview-action workspace-preview-close" aria-label={closeLabel} title={closeLabel} onClick={props.onClose}><XIcon /></button>
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
                  <button type="button" class="workspace-file-kind-action" onClick={() => void download()}>Download PDF</button>
                </object>
              </Show>
            </div>
          </Show>
        </Show>
        <Show when={file().kind === "binary"}>
          <div class="workspace-file-kind-card">
            <strong>{formatKind(file().kind)}</strong>
            <span>{file().mime} · {formatFileSize(file().size)}</span>
            <Show when={file().kind === "binary"}>
              <code>{formatHexHead(file().head)}</code>
              <button type="button" class="workspace-file-kind-action" onClick={openAsText}>Open as text anyway</button>
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
          <header class="workspace-preview-header">
            <Show when={props.headerPrefix}>{props.headerPrefix}</Show>
            <div class="workspace-preview-file" title={file().path}><FileTypeIcon name={file().path} /><span>{file().path}</span></div>
            <small>{hasUnsavedChanges() ? "Unsaved" : file().truncated ? "Truncated" : formatFileSize(file().size)}</small>
            <Show when={!file().truncated}>
              <button type="button" class="workspace-preview-action" aria-label={props.wrap ? "Disable line wrapping" : "Enable line wrapping"} title={props.wrap ? "Disable line wrapping" : "Enable line wrapping"} aria-pressed={props.wrap} onClick={props.onToggleWrap}><WrapTextIcon /></button>
            </Show>
            <Show when={editable()}>
              <button type="button" class="workspace-preview-action" aria-label={editing() ? "Close editor" : "Edit file"} title={editing() ? "Close editor" : "Edit file"} aria-pressed={editing()} onClick={() => editing() ? setEditing(false) : void edit()}><Show when={editing()} fallback={<PencilIcon />}><XIcon /></Show></button>
              <button type="button" class="workspace-preview-action" aria-label="Save file" title="Save file (Ctrl+S)" disabled={!hasUnsavedChanges() || saving()} onClick={() => void save()}><Show when={saving()} fallback={<SaveIcon />}><Spinner /></Show></button>
            </Show>
            <button type="button" class="workspace-preview-action" aria-label="Download file" title="Download file" onClick={() => void download()}><DownloadIcon /></button>
            <button type="button" class="workspace-preview-copy" aria-label="Copy file contents" title="Copy file contents" onClick={() => copy(draft())}><CopyIcon /></button>
            <Show when={props.closable}>
              <button type="button" class="workspace-preview-action workspace-preview-close" aria-label={closeLabel} title={closeLabel} onClick={props.onClose}><XIcon /></button>
            </Show>
          </header>
          <Show when={file().readOnly && !file().truncated}>
            <div class="workspace-file-readonly-notice">Opened as text. Editing is disabled.</div>
          </Show>
          <Show when={file().truncated} fallback={<div class="workspace-preview-editor" data-editing={editing()} data-wrap={props.wrap}>
            <Show when={file().path} keyed>{(path) =>
              <Suspense fallback={<div class="workspace-panel-empty">Loading preview…</div>}>
                <WorkspaceEditor path={path} value={draft()} wrap={props.wrap} editable={editing()} onInput={setDraft} onSave={() => void save()} />
              </Suspense>
            }</Show>
          </div>}>
            <div class="workspace-file-kind-card">
              <strong>This text file is larger than the 25 MiB preview limit.</strong>
              <span>Download the complete file, or load the first 25 MiB as read-only text.</span>
              <button type="button" class="workspace-file-kind-action" onClick={loadLargeText}>Load first 25 MiB</button>
            </div>
          </Show>
        </>}</Show>
      </Show>
    </ContextMenuTrigger>
    <Show when={preview() || asset()}>{(file) =>
      <ContextMenuContent shortcutScope="workspace-panel" class="w-48 workspace-file-menu">
        <ContextMenuGroup>
          <Show when={preview()}>
            <ContextMenuItem disabled={!editable()} onSelect={() => void edit()}><PencilIcon />Edit</ContextMenuItem>
            <ContextMenuItem disabled={!hasUnsavedChanges() || saving()} onSelect={() => void save()}><SaveIcon />Save</ContextMenuItem>
            <ContextMenuItem onSelect={() => copy(draft())}><CopyIcon />Copy contents</ContextMenuItem>
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
