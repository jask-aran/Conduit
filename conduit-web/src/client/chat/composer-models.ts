import type { Accessor } from "solid-js";
import type { ModelOption } from "../api/contracts";

export interface ComposerModels {
  models: Accessor<ModelOption[]>;
  model: Accessor<string>;
  effort: Accessor<string>;
  notice: Accessor<string>;
  chooseModel: (spec: string) => Promise<boolean> | boolean;
  chooseEffort: (level: string) => Promise<boolean> | boolean;
}
