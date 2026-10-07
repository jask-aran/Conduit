import type manifestType from "virtual:material-icon-manifest";

type Manifest = typeof manifestType;

/** File and folder names to their icon's file, from the build-time manifest. */
export function materialIconLookup(manifest: Manifest) {
  const leafName = (path: string) => path.split(/[\\/]/).at(-1)?.toLowerCase() ?? path.toLowerCase();
  const iconAsset = (iconName: string | undefined) => (iconName && manifest.icons[iconName]) || "file.svg";

  function materialFileIconAsset(path: string) {
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

  function materialFolderIconAsset(path: string, expanded: boolean) {
    const name = leafName(path);
    const names = expanded ? manifest.folderNamesExpanded : manifest.folderNames;
    const fallback = expanded ? manifest.folderExpanded : manifest.folder;
    return iconAsset(names?.[name] ?? fallback);
  }

  return { materialFileIconAsset, materialFolderIconAsset };
}
