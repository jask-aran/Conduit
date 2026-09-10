import type { Accessor } from "solid-js";
import type { ModelOption } from "../api/contracts";

/**
 * The slice of model settings the composer needs.
 *
 * `ModelSettings` satisfies this. A driven harness thread supplies its own
 * implementation instead: its catalogue and selection belong to the live
 * record, not to a Conduit chat.
 */
export interface ComposerModels {
  models: Accessor<ModelOption[]>;
  model: Accessor<string>;
  effort: Accessor<string>;
  notice: Accessor<string>;
  chooseModel: (spec: string) => Promise<boolean> | boolean;
  chooseEffort: (level: string) => Promise<boolean> | boolean;
}
