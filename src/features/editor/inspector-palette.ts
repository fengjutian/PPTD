/**
 * The colors a page can be painted with when the deck has no template yet.
 * With a template the palette of the template is used instead.
 *
 * The constant lives in its own file so the panel module only exports
 * components: a module that exports plain values breaks the fast refresh of
 * the editor while it is being developed.
 */
export const DEFAULT_PALETTE = [
  "#000000",
  "#7F7F7F",
  "#C0C0C0",
  "#FFFFFF",
  "#D35230",
  "#2B579A",
  "#217346",
  "#C2660F",
  "#7030A0",
  "#0F8B8D",
] as const;
