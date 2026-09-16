import type { Accessor } from "solid-js";
import type { PermissionMode } from "../api/contracts";

/**
 * The slice of permission settings the composer needs.
 *
 * `PermissionSettings` satisfies this. The harness launch composer supplies its
 * own implementation: there is no chat to ask yet, so the modes come from the
 * harness for that folder and the choice is held until the chat exists.
 */
export interface ComposerPermissions {
  profiles: Accessor<PermissionMode[]>;
  selected: Accessor<string>;
  choose: (id: string) => Promise<boolean> | boolean;
}
