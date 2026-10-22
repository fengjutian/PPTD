import { normalizeHexColor } from "./inspector-color";

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

/** `dk1`, `lt1`, `dk2`, `lt2`, `accent1`…`accent6`, `hlink` and `folHlink`. */
const SCHEME_SLOT_COUNT = 12;

export interface PaletteColor {
  name: string;
  value: string;
}

/**
 * The swatches offered next to a color field.
 *
 * A template usually carries more than one theme part, and the analysis lists
 * the color scheme of each of them one after another. Drawn as-is that is a
 * wall of forty to sixty chips in which the whites and greens of every scheme
 * repeat, so the panel keeps the palette the way PowerPoint offers it: the
 * first scheme, without the colors that occur twice in it.
 */
export function paletteSwatches(colors?: readonly PaletteColor[]): readonly string[] {
  const swatches: string[] = [];
  const seenNames = new Set<string>();
  const seenValues = new Set<string>();

  for (const color of colors ?? []) {
    const name = color.name.trim().toLowerCase();
    if (name) {
      // A slot name that comes around a second time starts the scheme of the
      // next theme, so the palette of the deck ends here.
      if (seenNames.has(name)) break;
      seenNames.add(name);
    }
    const value = normalizeHexColor(color.value);
    if (!value || seenValues.has(value)) continue;
    seenValues.add(value);
    swatches.push(value);
    if (swatches.length === SCHEME_SLOT_COUNT) break;
  }

  return swatches.length > 0 ? swatches : DEFAULT_PALETTE;
}
