import { FileArchiveIcon, FileIcon, FileTextIcon, ImageIcon, PaperclipIcon, XIcon } from "lucide-react";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { InputGroupButton } from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TypeIcon({ item }) {
  if (item.type?.startsWith("image/")) return <ImageIcon />;
  if (/zip|archive|tar|gzip/.test(item.type || "")) return <FileArchiveIcon />;
  if (/text|json|pdf|csv/.test(item.type || "")) return <FileTextIcon />;
  return <FileIcon />;
}

export function AttachmentPopover({ attachments }) {
  const { items, open, setOpen, inputRef, addFiles, remove } = attachments;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <InputGroupButton size="icon-sm" aria-label={`Attachments${items.length ? ` (${items.length})` : ""}`}>
        <PaperclipIcon />
        {items.length > 0 && <span className="attachment-count" aria-hidden="true">{items.length}</span>}
      </InputGroupButton>
    </PopoverTrigger>
    <PopoverContent side="top" align="start" className="attachment-popover">
      <div className="attachment-popover-heading">
        <strong>Attachments</strong>
        <Button type="button" variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>Add files</Button>
      </div>
      <ScrollArea className="attachment-scroll">
        <div className="attachment-list">
          {items.map((item) => <Attachment key={item.id} size="xs" orientation="horizontal" state={item.status === "queued" ? "processing" : item.status} className="attachment-row">
            <AttachmentMedia variant={item.objectUrl ? "image" : "icon"}>
              {item.objectUrl ? <img src={item.objectUrl} alt="" /> : <TypeIcon item={item} />}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{item.name}</AttachmentTitle>
              <AttachmentDescription>
                {item.status === "uploading" ? `${item.progress}%` : item.status === "error" ? item.error : sizeLabel(item.size || 0)}
                {item.status === "uploading" && <Progress value={item.progress} className="mt-1" />}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction aria-label={`Remove ${item.name}`} onClick={() => remove(item).catch(() => {})}>
                <XIcon />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>)}
          {!items.length && <p className="attachment-empty">No files attached to this chat.</p>}
        </div>
      </ScrollArea>
    </PopoverContent>
    <input ref={inputRef} type="file" multiple hidden onChange={(event) => {
      addFiles(event.target.files || []);
      event.target.value = "";
    }} />
  </Popover>;
}
