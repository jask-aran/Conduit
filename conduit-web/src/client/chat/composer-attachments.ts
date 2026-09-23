import type { Accessor } from "solid-js";
import type { UploadAttachment } from "../state/attachments";

/**
 * The slice of the attachments store the composer needs.
 *
 * `AttachmentsStore` satisfies this. A surface with no attachment pipeline
 * behind it uses `NO_ATTACHMENTS` rather than a cast: the drive composer used
 * to pass an object literal through `as never`, and the one method it happened
 * to leave out took the whole surface down with "pendingIds is not a function".
 * A type nobody can lie to is the point of this file.
 */
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
