import { batch, createEffect, createSignal, lazy, on, onCleanup, Show, Suspense } from "solid-js";
import { CopyIcon, DownloadIcon, PencilIcon, SaveIcon, Trash2Icon, UploadIcon, WrapTextIcon, XIcon } from "lucide-solid";
import { toast } from "solid-sonner";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, Spinner } from "@/components/primitives";
import { api } from "../api/client";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl } from "../api/transport";
import { FileTypeIcon } from "./file-type-icon";

const WorkspaceEditor = lazy(() => import("./workspace-editor"));

// Rendered through an <img> on a blob URL: that carries the Bearer header the
// native builds need, and never executes script inside an SVG.
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"]);
const IMAGE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
};
const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;

function imageExtension(path: string): string | null {
  const extension = path.split(".").at(-1)?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(extension) ? extension : null;
}

export interface FilePreview { path: string; size: number; modifiedAt: number; revision: string; content: string; }
export interface FileSummary { path: string; size: number; }
interface ImageContent { path: string; size: number; modifiedAt: number; url: string; oversize: boolean; }
interface FileMetadata { path: string; size: number; modifiedAt: number; }
interface FileWriteResult { path: string; size: number; modifiedAt: number; revision: string; }

// The parent owns which paths are open; a slot owns everything about the file at
// its own path, so two slots never share load, draft, or save state.
export interface FileSlotHandle {
  path: () => string | null;
  hasUnsavedChanges: () => boolean;
  reload: () => Promise<void>;
  edit: () => void;
  poll: () => Promise<void>;
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
  const [image, setImage] = createSignal<ImageContent | null>(null);
  const [imageDimensions, setImageDimensions] = createSignal<{ width: number; height: number } | null>(null);
  const [draft, setDraft] = createSignal("");
  const [editing, setEditing] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const hasUnsavedChanges = () => Boolean(preview() && draft() !== preview()!.content);
  const label = props.slot === "primary" ? "File preview" : "Second file preview";
  const closeLabel = props.slot === "primary" ? "Close file" : "Close second file";

  let controller: AbortController | null = null;
  let loadToken = 0;
  const releaseImage = () => {
    const current = image();
    if (current?.url) URL.revokeObjectURL(current.url);
  };
  const clear = () => {
    releaseImage();
    batch(() => {
      setPreview(null);
      setImage(null);
      setDraft("");
      setEditing(false);
    });
    props.onLoaded?.(null);
  };

  // Images skip the text endpoint entirely: metadata first, so an enormous file
  // is refused before any of it crosses the wire.
  const loadImage = async (path: string, projectId: string, extension: string, owns: () => boolean, background: boolean) => {
    const metadata = await api<FileMetadata>(
      `/v0/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}&metadata=1`,
      { signal: controller?.signal },
    );
    if (!owns()) return;
    if (metadata.size > MAX_INLINE_IMAGE_BYTES) {
      releaseImage();
      batch(() => {
        setPreview(null);
        setImage({ path, size: metadata.size, modifiedAt: metadata.modifiedAt, url: "", oversize: true });
      });
      props.onLoaded?.({ path, size: metadata.size });
      return;
    }
    const response = await authorizedFetch(
      httpUrl(`/v0/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}&download=1`),
      { signal: controller?.signal },
    );
    if (!response.ok) throw new Error(`Could not load ${path}`);
    const blob = new Blob([await response.arrayBuffer()], { type: IMAGE_MIME[extension] });
    if (!owns()) return;
    releaseImage();
    batch(() => {
      setPreview(null);
      setDraft("");
      setEditing(false);
      setImageDimensions(null);
      setImage({ path, size: metadata.size, modifiedAt: metadata.modifiedAt, url: URL.createObjectURL(blob), oversize: false });
    });
    props.onLoaded?.({ path, size: metadata.size });
    void background;
  };

  const load = async (background = false) => {
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
    try {
      const extension = imageExtension(path);
      if (extension) {
        await loadImage(path, projectId, extension, owns, background);
        return;
      }
      const payload = await api<FilePreview>(
        `/v0/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}`,
        { signal: controller.signal },
      );
      if (!owns()) return;
      // The render checks the image branch first, so a text file replacing an
      // image must drop the image or the slot would keep showing the picture.
      releaseImage();
      batch(() => {
        setImage(null);
        setImageDimensions(null);
        setPreview(payload);
        setDraft(payload.content);
      });
      props.onLoaded?.(payload);
    } catch (cause) {
      if (controller?.signal.aborted || !owns()) return;
      clear();
      if (errorCode(cause) === "path_not_found") props.onRemoved(path, false);
      else if (!background) props.onError((cause as Error).message);
    }
  };

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
    const file = preview()?.path || image()?.path;
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

  // Staleness check driven by the panel's shared poll timer.
  const poll = async () => {
    const shown = image();
    if (shown) {
      const projectId = props.projectId;
      try {
        const metadata = await api<FileMetadata>(
          `/v0/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(shown.path)}&metadata=1`,
        );
        if (props.projectId !== projectId || image()?.path !== shown.path) return;
        if (metadata.modifiedAt !== shown.modifiedAt || metadata.size !== shown.size) await load(true);
      } catch (cause) {
        if (errorCode(cause) !== "path_not_found") throw cause;
        if (props.projectId === projectId && image()?.path === shown.path) {
          clear();
          props.onRemoved(shown.path, true);
        }
      }
      return;
    }
    const file = preview();
    if (!file || hasUnsavedChanges() || saving()) return;
    const projectId = props.projectId;
    try {
      const metadata = await api<FileMetadata>(
        `/v0/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(file.path)}&metadata=1`,
      );
      if (props.projectId !== projectId || preview()?.path !== file.path) return;
      if (typeof file.modifiedAt === "number" && typeof metadata.modifiedAt === "number"
        && (file.modifiedAt !== metadata.modifiedAt || file.size !== metadata.size)) {
        const before = file.revision;
        await load(true);
        if (preview()?.revision !== before) toast.info(`${file.path} updated`);
      }
    } catch (cause) {
      if (errorCode(cause) !== "path_not_found") throw cause;
      if (props.projectId === projectId && preview()?.path === file.path) {
        clear();
        props.onRemoved(file.path, true);
      }
    }
  };

  props.ref?.({
    path: () => props.path,
    hasUnsavedChanges,
    reload: async () => { if (!hasUnsavedChanges()) await load(true); },
    edit: () => { if (preview()) setEditing(true); },
    poll,
    save,
  });

  onCleanup(() => {
    controller?.abort();
    releaseImage();
    props.onDispose?.();
  });

  const copy = (value?: string) => { if (value) void navigator.clipboard.writeText(value); };

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
      <Show when={image()}>{(file) => <>
        <header class="workspace-preview-header">
          <div class="workspace-preview-file" title={file().path}><FileTypeIcon name={file().path} /><span>{file().path}</span></div>
          <small>{[imageDimensions() && `${imageDimensions()!.width} × ${imageDimensions()!.height}`, formatFileSize(file().size)].filter(Boolean).join(" · ")}</small>
          <button type="button" class="workspace-preview-action" aria-label="Download file" title="Download file" onClick={() => void download()}><DownloadIcon /></button>
          <button type="button" class="workspace-preview-copy" aria-label="Copy file path" title="Copy file path" onClick={() => copy(file().path)}><CopyIcon /></button>
          <Show when={props.closable}>
            <button type="button" class="workspace-preview-action workspace-preview-close" aria-label={closeLabel} title={closeLabel} onClick={props.onClose}><XIcon /></button>
          </Show>
        </header>
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
      </>}</Show>
      <Show when={!image()}>
      <Show when={preview()} fallback={<div class="workspace-panel-empty">Select a text file to preview it.</div>}>{(file) => <>
        <header class="workspace-preview-header">
          <div class="workspace-preview-file" title={file().path}><FileTypeIcon name={file().path} /><span>{file().path}</span></div>
          <small>{hasUnsavedChanges() ? "Unsaved" : formatFileSize(file().size)}</small>
          <button type="button" class="workspace-preview-action" aria-label={props.wrap ? "Disable line wrapping" : "Enable line wrapping"} title={props.wrap ? "Disable line wrapping" : "Enable line wrapping"} aria-pressed={props.wrap} onClick={props.onToggleWrap}><WrapTextIcon /></button>
          <button type="button" class="workspace-preview-action" aria-label={editing() ? "Close editor" : "Edit file"} title={editing() ? "Close editor" : "Edit file"} aria-pressed={editing()} onClick={() => editing() ? setEditing(false) : void edit()}><Show when={editing()} fallback={<PencilIcon />}><XIcon /></Show></button>
          <button type="button" class="workspace-preview-action" aria-label="Save file" title="Save file (Ctrl+S)" disabled={!hasUnsavedChanges() || saving()} onClick={() => void save()}><Show when={saving()} fallback={<SaveIcon />}><Spinner /></Show></button>
          <button type="button" class="workspace-preview-action" aria-label="Download file" title="Download file" onClick={() => void download()}><DownloadIcon /></button>
          <button type="button" class="workspace-preview-copy" aria-label="Copy file contents" title="Copy file contents" onClick={() => copy(draft())}><CopyIcon /></button>
          <Show when={props.closable}>
            <button type="button" class="workspace-preview-action workspace-preview-close" aria-label={closeLabel} title={closeLabel} onClick={props.onClose}><XIcon /></button>
          </Show>
        </header>
        <div class="workspace-preview-editor" data-editing={editing()} data-wrap={props.wrap}>
          <Show when={file().path} keyed>{(path) =>
            <Suspense fallback={<div class="workspace-panel-empty">Loading preview…</div>}>
              <WorkspaceEditor path={path} value={draft()} wrap={props.wrap} editable={editing()} onInput={setDraft} onSave={() => void save()} />
            </Suspense>
          }</Show>
        </div>
      </>}</Show>
      </Show>
    </ContextMenuTrigger>
    <Show when={preview() || image()}>{(file) =>
      <ContextMenuContent shortcutScope="workspace-panel" class="w-48 workspace-file-menu">
        <ContextMenuGroup>
          <Show when={!image()}>
            <ContextMenuItem onSelect={() => void edit()}><PencilIcon />Edit</ContextMenuItem>
            <ContextMenuItem disabled={!hasUnsavedChanges() || saving()} onSelect={() => void save()}><SaveIcon />Save</ContextMenuItem>
          </Show>
          <ContextMenuItem onSelect={() => void download()}><DownloadIcon />Download</ContextMenuItem>
          <ContextMenuItem disabled={props.busy || saving()} onSelect={() => props.onReplace(file().path)}><UploadIcon />Replace with upload…</ContextMenuItem>
          <Show when={!image()}>
            <ContextMenuItem onSelect={() => copy(draft())}><CopyIcon />Copy contents</ContextMenuItem>
          </Show>
          <ContextMenuItem onSelect={() => copy(file().path)}><CopyIcon />Copy path</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" disabled={props.busy || saving()} onSelect={() => props.onDelete(file().path)}><Trash2Icon />Delete file</ContextMenuItem>
      </ContextMenuContent>
    }</Show>
  </ContextMenu>;
}
