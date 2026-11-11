import { generateManifest } from "material-icon-theme";

/**
 * The file and folder icon lookup, worked out at build time: `generateManifest` in the page costs a quarter-second
 * before a file list can draw, and the lookup reads only a handful of maps.
 */
export function buildMaterialIconManifest() {
  const manifest = generateManifest({ files: { associations: { "*.dax": "table" } } });
  const { file, folder, folderExpanded, fileNames, fileExtensions, folderNames, folderNamesExpanded } = manifest;
  const icons = Object.fromEntries(Object.entries(manifest.iconDefinitions || {})
    .map(([name, definition]) => [name, definition.iconPath?.split("/").at(-1)]));
  return { file, folder, folderExpanded, fileNames, fileExtensions, folderNames, folderNamesExpanded, icons };
}
