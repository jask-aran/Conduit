// Built from material-icon-theme at build time (scripts/material-icon-manifest.mjs).
import manifest from "virtual:material-icon-manifest";
import { materialIconLookup } from "./material-icon-lookup";

export const { materialFileIconAsset, materialFolderIconAsset } = materialIconLookup(manifest);
