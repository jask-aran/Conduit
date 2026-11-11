declare module "virtual:settings-index" {
  /** acts: its buttons' words. words: what else the row says (its title, state, options). */
  const index: { section: string; group: string | null; label: string; words?: string; acts?: string }[];
  export default index;
}
