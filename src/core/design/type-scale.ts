import type { DocumentTheme } from "../document-model";

/**
 * The six levels of type a generated page can use.
 *
 * A theme may name some of them (see `DocumentTheme.textStyles`); the rest fall
 * back to the generator's defaults. The layout branches read this object instead
 * of repeating 30 / 18 / 12 at every call site, so a template or a built-in
 * preset can own the hierarchy without editing the renderer.
 */
export interface TypeScale {
  /** The cover headline. */
  display: number;
  /** A content page title. */
  title: number;
  /** The line under a cover or section title. */
  subtitle: number;
  /** Running copy. */
  body: number;
  /** Page numbers, panel labels, footnotes. */
  caption: number;
  /** A section divider title. */
  section: number;
}

export const DEFAULT_TYPE_SCALE: TypeScale = {
  display: 42,
  title: 30,
  subtitle: 18,
  body: 18,
  caption: 12,
  section: 36,
};

/** Point sizes a theme token may carry. A token outside this range is ignored. */
const MIN_POINT_SIZE = 8;
const MAX_POINT_SIZE = 120;

function readPointSize(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  if (value < MIN_POINT_SIZE || value > MAX_POINT_SIZE) return fallback;
  return value;
}

/**
 * Reads the type scale a document theme declares.
 *
 * The section title is not its own token: it sits one step below the display
 * size, which keeps covers and section dividers related without adding a sixth
 * level to the schema.
 */
export function resolveTypeScale(theme: DocumentTheme | undefined): TypeScale {
  const styles = theme?.textStyles;
  const display = readPointSize(styles?.display?.fontSizePt, DEFAULT_TYPE_SCALE.display);
  return {
    display,
    title: readPointSize(styles?.title?.fontSizePt, DEFAULT_TYPE_SCALE.title),
    subtitle: readPointSize(styles?.subtitle?.fontSizePt, DEFAULT_TYPE_SCALE.subtitle),
    body: readPointSize(styles?.body?.fontSizePt, DEFAULT_TYPE_SCALE.body),
    caption: readPointSize(styles?.caption?.fontSizePt, DEFAULT_TYPE_SCALE.caption),
    section: Math.max(24, display - 6),
  };
}
