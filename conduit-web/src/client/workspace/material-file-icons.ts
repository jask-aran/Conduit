import { generateManifest } from "material-icon-theme";

const manifest = generateManifest({
  files: { associations: { "*.dax": "table" } },
});

function leafName(path: string) {
  return path.split(/[\\/]/).at(-1)?.toLowerCase() ?? path.toLowerCase();
}

function iconAsset(iconName: string | undefined) {
  const path = iconName ? manifest.iconDefinitions?.[iconName]?.iconPath : undefined;
  return path?.split("/").at(-1) ?? "file.svg";
}

export function materialFileIconAsset(path: string) {
  const name = leafName(path);
  let iconName = manifest.fileNames?.[name];
  if (!iconName) {
    for (let separator = name.indexOf("."); separator >= 0; separator = name.indexOf(".", separator + 1)) {
      const extension = name.slice(separator + 1);
      if (extension && manifest.fileExtensions?.[extension]) {
        iconName = manifest.fileExtensions[extension];
        break;
      }
    }
  }
  return iconAsset(iconName ?? manifest.file);
}

export function materialFolderIconAsset(path: string, expanded: boolean) {
  const name = leafName(path);
  const names = expanded ? manifest.folderNamesExpanded : manifest.folderNames;
  const fallback = expanded ? manifest.folderExpanded : manifest.folder;
  return iconAsset(names?.[name] ?? fallback);
}
