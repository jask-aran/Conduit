import { FileIcon, FolderIcon } from "lucide-solid";
import { Show } from "solid-js";
import { materialFileIconAsset, materialFolderIconAsset } from "./material-file-icons";

const materialIconAssets = import.meta.glob<string>(
  "/node_modules/material-icon-theme/icons/*.svg",
  { eager: true, import: "default", query: "?url" },
);

function materialIconUrl(assetName: string) {
  return materialIconAssets[`/node_modules/material-icon-theme/icons/${assetName}`];
}

export function FileTypeIcon(props: { name: string }) {
  const source = () => materialIconUrl(materialFileIconAsset(props.name));
  return <Show when={source()} fallback={<FileIcon class="workspace-file-icon-generic" aria-hidden="true" />}>
    {(url) => <img class="workspace-file-icon" src={url()} alt="" aria-hidden="true" draggable={false} />}
  </Show>;
}

export function FolderTypeIcon(props: { name: string; expanded: boolean }) {
  const source = () => materialIconUrl(materialFolderIconAsset(props.name, props.expanded));
  return <Show when={source()} fallback={<FolderIcon aria-hidden="true" />}>
    {(url) => <img class="workspace-file-icon" src={url()} alt="" aria-hidden="true" draggable={false} />}
  </Show>;
}
