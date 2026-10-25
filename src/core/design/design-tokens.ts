import { EMU_PER_INCH, type DocumentTheme, type Emu } from "../document-model";
import { colorLuminance, contrastRatio, fillForInk, MINIMUM_CONTRAST, readableTextColor } from "../rendering/contrast";
import { mixHex } from "./shape-gradient";
import { resolveTypeScale } from "./type-scale";
import type { DeckConcept } from "./deck-concept";

/**
 * The color roles beyond the four inks a page needs to be readable.
 *
 * The palette used to carry one accent, one surface and a muted ink, so every
 * page could only separate things with a hairline: a card had no fill that was
 * not literally the page, and a tinted band had no tint. These four roles are
 * the missing steps — the Radix-style split between *the page*, *something on
 * the page*, and *the line between them* — kept to the smallest set that makes
 * a plate and a card possible.
 *
 * They are roles, not decoration: a recipe may paint a panel with
 * `surfaceRaised` and stroke it with `border`, and still be refused by the
 * taste lint if it overdraws the page.
 */
export interface SemanticColors {
  /** A surface that sits above the page: a card, a plate, a caption bar. */
  surfaceRaised: string;
  /** A surface that sits below the page field: a recessed column, a table band. */
  surfaceSunken: string;
  /** A hairline, a card stroke, a column separator. */
  border: string;
  /** A boundary that has to read as a line, not a texture: a rule, a selected edge. */
  borderStrong: string;
  /** Secondary copy: captions, source lines, figure credits. */
  textMuted: string;
  /** The accent as a low-intensity fill that body ink still reads on. */
  accentSubtle: string;
  /** The accent as a solid field that can carry `onAccent` at body size. */
  accentStrong: string;
  /** The ink that reads on `accentStrong`. */
  onAccent: string;
}

/**
 * Derives the eight semantic roles from a page's own surface, ink and accent.
 *
 * Deriving beats hard-coding here because the same function serves two callers:
 * a built-in preset (whose values are written into the theme once) and a page
 * painted on an imported template (whose surface and ink are resolved per
 * page). On a dark page the raised surface goes *towards* white and the sunken
 * one goes towards black, which is the opposite direction from a light page; a
 * single fixed mix would make one of the two disappear into the field.
 */
/**
 * Secondary ink: lighter than body copy, still readable on the page.
 *
 * The mix is bounded by contrast rather than by a fixed percentage: a third of
 * the way from a mid-toned body ink to a white page lands at 3.9:1, which is a
 * caption nobody can read. The amount walks back until the muted tone clears
 * the body-text floor, so a light palette gets a lighter mute and a dark one
 * keeps more.
 */
function muteInk(ink: string, surface: string): string {
  let amount = 0.38;
  let muted = mixHex(ink, surface, amount);
  while (amount > 0 && (contrastRatio(muted, surface) ?? 0) < MINIMUM_CONTRAST) {
    amount = Math.round((amount - 0.04) * 100) / 100;
    muted = mixHex(ink, surface, Math.max(0, amount));
  }
  return muted;
}

export function deriveSemanticColors(input: { surface: string; ink: string; accent: string }): SemanticColors {
  const dark = (colorLuminance(input.surface) ?? 1) < 0.45;
  const towards = dark ? "#FFFFFF" : input.ink;
  // A solid accent field is deepened only as far as it must be to carry white
  // copy; a pale brand tone therefore keeps its hue instead of turning into a
  // second, darker colour that no longer looks like the brand.
  const accentStrong = fillForInk("#FFFFFF", input.accent);
  return {
    surfaceRaised: mixHex(input.surface, towards, dark ? 0.1 : 0.05),
    // Inset moves away from the raised side: on a light page it darkens a
    // little more than the raised surface, on a dark page it goes under the
    // page field instead of above it. One direction for both would make the
    // two surfaces indistinguishable on one of them.
    surfaceSunken: dark ? mixHex(input.surface, "#000000", 0.22) : mixHex(input.surface, input.ink, 0.1),
    border: mixHex(input.surface, towards, dark ? 0.2 : 0.14),
    borderStrong: mixHex(input.surface, towards, dark ? 0.36 : 0.3),
    textMuted: muteInk(input.ink, input.surface),
    accentSubtle: mixHex(input.surface, input.accent, dark ? 0.22 : 0.12),
    accentStrong,
    onAccent: readableTextColor("#FFFFFF", colorLuminance(accentStrong) ?? 0.2),
  };
}

/**
 * Whether two surfaces need the same set of semantic roles.
 *
 * The stored roles of a preset are only valid for the surface they were derived
 * from. A light preset applied to a dark page used to reuse its white raised
 * surface, and the page drew light ink on it — a card nobody can read. The
 * appearance (light or dark) is enough to tell when the stored set must be
 * replaced by one derived from the page itself.
 */
export function sameAppearance(first: string, second: string): boolean {
  return (colorLuminance(first) ?? 1) < 0.45 === (colorLuminance(second) ?? 1) < 0.45;
}

/**
 * The measurements every page recipe shares.
 *
 * Recipes do not carry their own 16pt/18pt/20pt numbers. A theme owns the type
 * scale, the page owns the geometry, and the concept only decides how much
 * contrast the hierarchy should have. This is what keeps the title axis and the
 * body size stable across a deck whose pages use different recipes.
 *
 * `space` and `grid` are fractions of the page height and width; `type` and
 * `rule` are points. The unit is part of the field name so a recipe cannot mix
 * them by accident.
 */
export interface DesignTokens {
  fonts: {
    /**
     * The display face: titles that carry the page.
     *
     * It defaults to the heading face, so a theme that never sets one keeps
     * exactly its previous typography. A theme that does set one gets a second
     * typographic voice at display size only — which is what the taste lint
     * allows one of, not an extra family for body copy.
     */
    display: string;
    heading: string;
    body: string;
  };
  type: {
    displayPt: number;
    titlePt: number;
    subtitlePt: number;
    bodyPt: number;
    captionPt: number;
    lineHeight: number;
    /** Leading for headlines; tighter than `lineHeight`. */
    titleLineHeight: number;
  };
  space: { xs: number; sm: number; md: number; lg: number; xl: number };
  rule: { hairlinePt: number; accentPt: number };
  grid: { columns: number; margin: number; gutter: number };
  radius: { cardPt: number; badgePt: number };
}

export type TypeScaleIntent = "compact" | "normal" | "expressive";

const CONTRAST_FACTORS: Record<DeckConcept["typeContrast"], { display: number; title: number }> = {
  calm: { display: 0.96, title: 0.96 },
  strong: { display: 1, title: 1 },
  dramatic: { display: 1.2, title: 1.1 },
};

/**
 * Bounded multipliers for the page's type-scale intent.
 *
 * The AI chooses an intent, never a point size. The clamp keeps an expressive
 * page from pushing a title past what the layout can carry; the taste lint and
 * overflow checks still run afterwards.
 */
const INTENT_FACTORS: Record<TypeScaleIntent, { display: number; title: number; body: number }> = {
  compact: { display: 0.9, title: 0.92, body: 0.96 },
  normal: { display: 1, title: 1, body: 1 },
  expressive: { display: 1.12, title: 1.08, body: 1.04 },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Derives the tokens of a deck.
 *
 * A larger page gets slightly more air, but the normalized spacing stays in a
 * narrow band: the deck should still read as one system when the page size
 * comes from a template rather than from the 13.33×7.5 default.
 */
export function deriveDesignTokens(
  theme: DocumentTheme | undefined,
  pageSize: { width: Emu; height: Emu },
  concept: DeckConcept,
  intent: TypeScaleIntent = "normal",
): DesignTokens {
  const scale = resolveTypeScale(theme);
  const factors = CONTRAST_FACTORS[concept.typeContrast];
  const intentFactors = INTENT_FACTORS[intent];
  const heightInches = pageSize.height / EMU_PER_INCH;
  const spaceScale = clamp(heightInches / 7.5, 0.8, 1.25);
  return {
    fonts: {
      display: theme?.displayFont ?? theme?.majorFont ?? "Microsoft YaHei",
      heading: theme?.majorFont ?? "Microsoft YaHei",
      body: theme?.minorFont ?? theme?.majorFont ?? "Microsoft YaHei",
    },
    type: {
      displayPt: clamp(Math.round(scale.display * factors.display * intentFactors.display), 24, 96),
      titlePt: clamp(Math.round(scale.title * factors.title * intentFactors.title), 18, 56),
      subtitlePt: clamp(scale.subtitle, 14, 32),
      bodyPt: clamp(Math.round(scale.body * intentFactors.body), 12, 28),
      captionPt: clamp(scale.caption, 8, 16),
      lineHeight: theme?.textStyles?.body?.lineHeight ?? 1.25,
      /**
       * Headline leading, tighter than body copy.
       *
       * A 28–48pt headline set at the body's 1.3 turns a two-line title into a
       * gap with words in it: the lines drift apart and the block eats the space
       * the copy below needs. Display type is read as one shape, so it gets a
       * tighter band — never tighter than 1.08, which would collide ascenders
       * with descenders on the line above.
       */
      titleLineHeight: clamp((theme?.textStyles?.body?.lineHeight ?? 1.25) * 0.88, 1.08, 1.2),
    },
    space: {
      xs: 0.012 * spaceScale,
      sm: 0.025 * spaceScale,
      md: 0.045 * spaceScale,
      lg: 0.07 * spaceScale,
      xl: 0.12 * spaceScale,
    },
    rule: { hairlinePt: 0.75, accentPt: 2.5 },
    grid: { columns: 12, margin: 0.07, gutter: 0.022 },
    radius: { cardPt: 8, badgePt: 999 },
  };
}
