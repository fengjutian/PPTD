import { EMU_PER_INCH, type DocumentTheme, type Emu } from "../document-model";
import { resolveTypeScale } from "./type-scale";
import type { DeckConcept } from "./deck-concept";

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
  fonts: { heading: string; body: string };
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
