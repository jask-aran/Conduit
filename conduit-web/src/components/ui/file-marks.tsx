import { Show } from "solid-js";
import * as Icons from "./icons";
import { materialFileIconAsset, materialFolderIconAsset } from "./material-file-icons";

/* A file's or folder's type, as Material's icon for it (a generic glyph where it has none). Not in the library's index:
   its lookup table is large, so it loads with the views that list files (import "@/components/ui/file-marks"). */

// Asset URLs keep SVG data out of the JavaScript chunk and its parse cost.
const materialIconAssets = import.meta.glob<string>(
  "/node_modules/material-icon-theme/icons/*.svg",
  { eager: true, import: "default", query: "?url&no-inline" },
);

function materialIconUrl(assetName: string) {
  return materialIconAssets[`/node_modules/material-icon-theme/icons/${assetName}`];
}

export function FileTypeIcon(props: { name: string }) {
  const source = () => materialIconUrl(materialFileIconAsset(props.name));
  return <Show when={source()} fallback={<Icons.File class="ui-file-icon-generic" aria-hidden="true" />}>
    {(url) => <img class="ui-file-icon" src={url()} alt="" aria-hidden="true" draggable={false} />}
  </Show>;
}

export function FolderTypeIcon(props: { name: string; expanded: boolean }) {
  const source = () => materialIconUrl(materialFolderIconAsset(props.name, props.expanded));
  return <Show when={source()} fallback={<Icons.Folder aria-hidden="true" />}>
    {(url) => <img class="ui-file-icon" src={url()} alt="" aria-hidden="true" draggable={false} />}
  </Show>;
}
