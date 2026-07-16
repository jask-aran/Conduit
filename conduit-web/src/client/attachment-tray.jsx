import { FileArchiveIcon, FileCode2Icon, FileIcon, FileTextIcon, ImageIcon, PackageIcon, XIcon } from "lucide-react";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

function sizeLabel(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const imageExtensions = new Set(["gif", "jpeg", "jpg", "png", "webp"]);

function extension(item) {
  return item.name?.split(".").at(-1)?.toLowerCase() || "";
}

function isImage(item) {
  return item.type?.startsWith("image/") || imageExtensions.has(extension(item));
}

function TypeIcon({ item }) {
  const suffix = extension(item);
  if (isImage(item)) return <ImageIcon />;
  if (/^(zip|7z|rar|tar|gz|bz2|xz)$/.test(suffix) || /zip|archive|tar|gzip/.test(item.type || "")) return <FileArchiveIcon />;
  if (/^(js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|css|html|json|yaml|yml|toml)$/.test(suffix)) return <FileCode2Icon />;
  if (/^(exe|msi|app|dmg|deb|rpm|apk)$/.test(suffix)) return <PackageIcon />;
  if (/^(pdf|txt|md|csv|rtf|doc|docx)$/.test(suffix) || /text|pdf|csv/.test(item.type || "")) return <FileTextIcon />;
  return <FileIcon />;
}

function status(item) {
  if (item.status === "queued") return "processing";
  return item.status;
}

function description(item) {
  if (item.status === "queued") return "Waiting to upload";
  if (item.status === "uploading") return `Uploading · ${item.progress}%`;
  if (item.status === "error") return item.error;
  const kind = item.type?.split("/").at(-1)?.toUpperCase() || extension(item).toUpperCase() || "File";
  const size = sizeLabel(item.size);
  return size ? `${kind} · ${size}` : kind;
}

function AttachmentRow({ item, orientation, onRemove, chatId }) {
  const previewUrl = isImage(item) && chatId
    ? `/v0/chats/${encodeURIComponent(chatId)}/attachments/${encodeURIComponent(item.id)}?preview=1`
    : null;
  const imageUrl = item.objectUrl || previewUrl;
  return <Attachment
    size="default"
    orientation={orientation}
    state={status(item)}
    className={orientation === "horizontal" ? "w-[25rem] flex-nowrap" : undefined}
  >
    <AttachmentMedia variant={imageUrl ? "image" : "icon"}>
      {imageUrl ? <img src={imageUrl} alt="" /> : <TypeIcon item={item} />}
    </AttachmentMedia>
    <AttachmentContent>
      <AttachmentTitle>{item.name}</AttachmentTitle>
      <AttachmentDescription>{description(item)}</AttachmentDescription>
      {item.status === "uploading" && <Progress value={item.progress} className="mt-2" />}
    </AttachmentContent>
    {onRemove && <AttachmentActions>
      <AttachmentAction aria-label={`Remove ${item.name}`} onClick={() => void onRemove(item)}><XIcon /></AttachmentAction>
    </AttachmentActions>}
  </Attachment>;
}

export function AttachmentCards({ items, onRemove, chatId, className = "", label = "Attachments" }) {
  const images = items.filter(isImage);
  const files = items.filter((item) => !isImage(item));
  if (items.length === 0) return null;
  return <div className={cn("attachment-tray", className)} aria-label={label}>
    {images.length > 0 && <AttachmentGroup>
      {images.map((item) => <AttachmentRow key={item.id} item={item} orientation="vertical" onRemove={onRemove} chatId={chatId} />)}
    </AttachmentGroup>}
    {files.length > 0 && <AttachmentGroup className="flex-col overflow-visible">
      {files.map((item) => <AttachmentRow key={item.id} item={item} orientation="horizontal" onRemove={onRemove} chatId={chatId} />)}
    </AttachmentGroup>}
  </div>;
}

export function AttachmentTray({ attachments, chatId }) {
  return <>
    <AttachmentCards items={attachments.items} onRemove={attachments.remove} chatId={chatId} />
    <input ref={attachments.inputRef} type="file" multiple hidden onChange={(event) => {
      attachments.addFiles(event.target.files || []);
      event.target.value = "";
    }} />
  </>;
}
