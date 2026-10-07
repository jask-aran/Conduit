declare module "virtual:material-icon-manifest" {
  type Names = Record<string, string> | undefined;
  const manifest: {
    file?: string; folder?: string; folderExpanded?: string;
    fileNames: Names; fileExtensions: Names; folderNames: Names; folderNamesExpanded: Names;
    /** Icon name to its file in material-icon-theme/icons. */
    icons: Record<string, string | undefined>;
  };
  export default manifest;
}
