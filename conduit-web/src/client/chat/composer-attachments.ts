import type { Accessor } from "solid-js";
import type { UploadAttachment } from "../state/attachments";

/** A surface with no attachment pipeline uses `NO_ATTACHMENTS`, never a cast: a method left out takes the surface down. */
export interface ComposerAttachments {
  items: Accessor<UploadAttachment[]>;
  pendingIds: Accessor<string[]>;
  addFiles: (files: FileList | File[]) => void;
  remove: (item: UploadAttachment) => unknown;
  retry: (item: UploadAttachment) => void;
}

export const NO_ATTACHMENTS: ComposerAttachments = {
  items: () => [],
  pendingIds: () => [],
  addFiles: () => {},
  remove: () => undefined,
  retry: () => {},
};
