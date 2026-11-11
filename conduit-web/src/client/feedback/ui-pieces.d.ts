declare module "virtual:ui-pieces" {
  /** Paths are from the repository root. */
  const names: {
    /** A piece: where it is declared, the piece its root is drawn through, the pieces that draw through it unnamed. */
    pieces: Record<string, { source: string; wraps?: string; through?: string[] }>;
    /** A `ui-*` class: the piece whose root it is (also: others that claim it), or the piece it is a part of. */
    classes: Record<string, { piece: string; also?: string[]; part?: true }>;
    /** A `ui-*` class: the first rule that begins with it in each stylesheet that has one. */
    styles: Record<string, string[]>;
    /** An anchor (`data-region=sidebar`): where the app writes it. */
    anchors: Record<string, string>;
  };
  export default names;
}
