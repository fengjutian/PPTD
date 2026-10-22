import { strFromU8, strToU8 } from "fflate";

/**
 * Theme colors of an exported PPTX.
 *
 * PptxGenJS writes a fixed Office color scheme into `ppt/theme/theme1.xml` and
 * exposes no API for the palette of the source template. A deck that was
 * designed against a template therefore left the file with Office blue
 * accents, even though every painted object carried the template's own
 * colors. The palette is restored here by rewriting the color scheme of the
 * theme part, which is the one place PowerPoint reads theme colors from.
 */

export const THEME_PART = "ppt/theme/theme1.xml";

/** The color slots of the OOXML color scheme, in the order the scheme declares them. */
const COLOR_SLOTS = [
  "dk1",
  "lt1",
  "dk2",
  "lt2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
] as const;

export interface ThemeColorSlot {
  name: string;
  value: string;
}

function slotXml(name: string, value: string): string {
  return `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`;
}

/**
 * Replaces the slots the template declares and keeps the ones it does not.
 * A template that only defines accents still keeps the readable defaults of
 * the remaining slots instead of an empty scheme.
 */
export function patchColorScheme(xml: string, colors: ThemeColorSlot[]): string | undefined {
  const schemeMatch = /<a:clrScheme[^>]*>[\s\S]*?<\/a:clrScheme>/.exec(xml);
  if (!schemeMatch) return undefined;
  const scheme = schemeMatch[0];
  let patched = scheme;
  let replaced = 0;
  for (const color of colors) {
    const name = color.name.trim().toLowerCase();
    if (!(COLOR_SLOTS as readonly string[]).includes(name)) continue;
    const value = color.value.replace("#", "").toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(value)) continue;
    const slotPattern = new RegExp(`<a:${name}>[\\s\\S]*?</a:${name}>`);
    if (!slotPattern.test(patched)) continue;
    patched = patched.replace(slotPattern, slotXml(name, value));
    replaced += 1;
  }
  if (replaced === 0) return undefined;
  return xml.replace(scheme, patched);
}

/**
 * Writes the template palette into the theme part of a package. The entries
 * are only touched when the theme part exists and the template declares a
 * usable color, so a failure here can never corrupt a file that would
 * otherwise export correctly.
 */
export function patchThemeColors(entries: Record<string, Uint8Array>, colors: ThemeColorSlot[]): boolean {
  if (colors.length === 0) return false;
  const themePart = entries[THEME_PART];
  if (!themePart) return false;
  const patched = patchColorScheme(strFromU8(themePart), colors);
  if (!patched) return false;
  entries[THEME_PART] = strToU8(patched);
  return true;
}
