import type { ImageTone } from "../document-model";
import { colorLuminance } from "../rendering/contrast";
import { mixHex } from "./shape-gradient";

/**
 * The tone a full-bleed photograph takes on a dark page.
 *
 * A photograph dropped onto a near-black page is the brightest thing on it: the
 * page's own composition disappears behind it. Mapping the picture onto the
 * deck's brand colour keeps the photograph recognisable while putting it inside
 * the page instead of on top of it.
 *
 * Only full-bleed placements are toned, and only on dark pages. A picture in a
 * column beside text keeps its own colours — it is being looked at as a picture,
 * not used as a field. Light pages never get a tone: there the picture already
 * belongs, and a duotone would be decoration for its own sake.
 *
 * The two ends come from the brand, not from the ink: `accent` on a dark page is
 * near-white (ADR 0098), and a near-white highlight end lifted the whole picture
 * into a pale field that competed with the headline. Shadow and highlight are
 * two stops of the same brand colour instead, which keeps the picture dark.
 */
export function darkPageTone(colors: {
  background: string;
  accent: string;
  accentStrong: string;
}): ImageTone | undefined {
  if ((colorLuminance(colors.background) ?? 1) >= 0.45) return undefined;
  return {
    dark: colors.accentStrong,
    light: mixHex(colors.accentStrong, "#FFFFFF", 0.55),
  };
}
