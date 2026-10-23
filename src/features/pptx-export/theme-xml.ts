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

/**
 * Semantic color names of the built-in themes, mapped onto the slots of the
 * OOXML color scheme.
 *
 * `DocumentTheme.colors` predates the semantic token list and carries template
 * slot names (`accent1`, `dk1`, …) for imported templates and semantic names
 * (`primary`, `surface`, …) for built-in presets. Exporting has to understand
 * both, otherwise a preset deck gets Office blue accents in its theme part and
 * every object stays hard-coded.
 */
const SEMANTIC_SLOTS: Readonly<Record<string, string>> = {
  background: "lt1",
  surface: "lt1",
  surfacealt: "lt2",
  primarytext: "dk1",
  secondarytext: "dk2",
  primary: "dk2",
  darkbackground: "dk2",
  onprimary: "lt1",
  ondark: "lt1",
  muted: "dk2",
  accent: "accent1",
  secondaryaccent: "accent2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hlink: "hlink",
  folhlink: "folHlink",
};

/**
 * Normalizes the theme colors to OOXML slot names and drops duplicates.
 *
 * The first declaration of a slot wins: a preset may describe both `primary`
 * and `muted` as dark text colors, and the theme part can only hold one `dk2`.
 */
export function normalizeThemeColors(colors: ThemeColorSlot[]): ThemeColorSlot[] {
  const slots = new Map<string, string>();
  for (const color of colors) {
    const key = color.name.trim().toLowerCase();
    const slot = (SEMANTIC_SLOTS[key] ?? key) as string;
    if (!(COLOR_SLOTS as readonly string[]).includes(slot)) continue;
    if (slots.has(slot)) continue;
    const value = color.value.replace("#", "").toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(value)) continue;
    slots.set(slot, value);
  }
  return [...slots].map(([name, value]) => ({ name, value }));
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
  for (const color of normalizeThemeColors(colors)) {
    const slotPattern = new RegExp(`<a:${color.name}>[\\s\\S]*?</a:${color.name}>`);
    if (!slotPattern.test(patched)) continue;
    patched = patched.replace(slotPattern, slotXml(color.name, color.value));
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

/**
 * Parts whose colors are painted objects. The theme part is deliberately
 * absent: its scheme must keep literal `srgbClr` values.
 */
const COLOR_PART_PATTERN =
  /^ppt\/(?:slides\/slide|charts\/chart|notesSlides\/notesSlide|slideMasters\/slideMaster|slideLayouts\/slideLayout)[^/]*\.xml$/;

/**
 * A literal color, with or without child elements such as `alpha` or
 * `lumMod`. Both forms have to be rewritten as a whole; replacing only the
 * opening tag would leave a mismatched closing tag.
 */
const LITERAL_COLOR = /<a:srgbClr val="([0-9A-Fa-f]{6})"\s*(\/>|>([\s\S]*?)<\/a:srgbClr>)/g;

/**
 * Replaces literal object colors with the theme slot that carries the same
 * value.
 *
 * PowerPoint only recolors an object when the object references a theme color.
 * PptxGenJS writes every fill, line and text color as a literal `srgbClr`, so
 * a deck inherited the palette but not its behavior: editing the theme in
 * PowerPoint left all objects their original color. Exact matches are safe to
 * rewrite; colors that are not in the theme stay literal, because guessing a
 * nearest slot would change the design the user approved.
 *
 * Returns the number of rewritten color references.
 */
export function linkThemeColors(entries: Record<string, Uint8Array>, colors: ThemeColorSlot[]): number {
  const paletteByValue = new Map<string, string>();
  for (const color of normalizeThemeColors(colors)) {
    if (!paletteByValue.has(color.value)) paletteByValue.set(color.value, color.name);
  }
  if (paletteByValue.size === 0) return 0;
  let references = 0;
  for (const [part, data] of Object.entries(entries)) {
    if (!COLOR_PART_PATTERN.test(part)) continue;
    const xml = strFromU8(data);
    const patched = xml.replace(
      LITERAL_COLOR,
      (match: string, hex: string, closing: string, inner: string | undefined) => {
        const slot = paletteByValue.get(hex.toUpperCase());
        if (!slot) return match;
        references += 1;
        return closing === "/>"
          ? `<a:schemeClr val="${slot}"/>`
          : `<a:schemeClr val="${slot}">${inner ?? ""}</a:schemeClr>`;
      },
    );
    if (patched !== xml) entries[part] = strToU8(patched);
  }
  return references;
}
