import type { Accessor } from "solid-js";
import type { PermissionMode } from "../api/contracts";

export interface ComposerPermissions {
  profiles: Accessor<PermissionMode[]>;
  selected: Accessor<string>;
  choose: (id: string) => Promise<boolean> | boolean;
}
