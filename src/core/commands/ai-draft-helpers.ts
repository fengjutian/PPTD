import type { ContentBlock, DocumentTheme, RectEmu } from "../document-model";
import { inches, stableStringify } from "../document-model";
import type { AiContentBlock, AiSlideDraft, AiTemplateTheme } from "./commands";

export const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const TEXT_STYLE_LEVELS = ["display", "title", "subtitle", "body", "caption"] as const;

/**
 * Reads the named type levels of a theme.
 *
 * The value arrives from outside the domain (a template analysis or a preset),
 * so every level is re-validated: a missing or absurd size is dropped instead of
 * silently scaling the whole deck.
 */
function readTextStyles(input: AiTemplateTheme["textStyles"]): DocumentTheme["textStyles"] {
  if (!input) return undefined;
  const result: NonNullable<DocumentTheme["textStyles"]> = {};
  for (const level of TEXT_STYLE_LEVELS) {
    const token = input[level];
    if (!token || !Number.isFinite(token.fontSizePt)) continue;
    const fontSizePt = Math.min(120, Math.max(8, token.fontSizePt));
    result[level] = {
      fontSizePt,
      ...(typeof token.bold === "boolean" ? { bold: token.bold } : {}),
      ...(typeof token.color === "string" && HEX_COLOR_PATTERN.test(token.color) ? { color: token.color } : {}),
      ...(typeof token.lineHeight === "number" && Number.isFinite(token.lineHeight)
        ? { lineHeight: token.lineHeight }
        : {}),
      ...(typeof token.letterSpacingPt === "number" && Number.isFinite(token.letterSpacingPt)
        ? { letterSpacingPt: token.letterSpacingPt }
        : {}),
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function readTemplateTheme(theme: AiTemplateTheme | undefined): DocumentTheme | undefined {
  if (!theme) return undefined;
  const majorFont = theme.majorFont?.trim();
  const minorFont = theme.minorFont?.trim();
  const colors = (theme.colors ?? [])
    .filter((color) => typeof color.name === "string" && color.name.trim() && HEX_COLOR_PATTERN.test(color.value))
    .map((color) => ({ name: color.name.trim(), value: color.value.toUpperCase() }));
  const textStyles = readTextStyles(theme.textStyles);
  if (!majorFont && !minorFont && colors.length === 0 && !textStyles) return undefined;
  return {
    name: theme.name?.trim() || "模板主题",
    majorFont: majorFont || minorFont || "Calibri",
    minorFont: minorFont || majorFont || "Calibri",
    colors,
    ...(textStyles ? { textStyles } : {}),
  };
}

export function toContentBlocks(blocks: AiContentBlock[] | undefined): ContentBlock[] | undefined {
  if (!blocks) return undefined;
  return blocks.map((block): ContentBlock => {
    const id = crypto.randomUUID();
    if (block.type === "paragraph") return { id, type: "paragraph", text: block.text };
    if (block.type === "bullet-list") return { id, type: "bullet-list", items: [...block.items] };
    if (block.type === "quote") return { id, type: "quote", text: block.text, attribution: block.attribution };
    if (block.type === "metric") return { id, type: "metric", label: block.label, value: block.value };
    if (block.type === "chart")
      return {
        id,
        type: "chart",
        kind: block.kind,
        categories: [...block.categories],
        ...(block.series
          ? { series: block.series.map((item) => ({ name: item.name, values: [...item.values] })) }
          : block.values
            ? { values: [...block.values] }
            : {}),
        ...(block.unit ? { unit: block.unit } : {}),
      };
    if (block.type === "timeline") return { id, type: "timeline", items: block.items.map((item) => ({ ...item })) };
    if (block.type === "comparison")
      return {
        id,
        type: "comparison",
        leftLabel: block.leftLabel,
        rightLabel: block.rightLabel,
        leftItems: [...block.leftItems],
        rightItems: [...block.rightItems],
      };
    if (block.type === "table-data")
      return { id, type: "table-data", header: [...block.header], rows: block.rows.map((row) => [...row]) };
    return { id, type: "process", items: block.items.map((item) => ({ ...item })) };
  });
}

/**
 * A stable fingerprint of the reviewed drafts a direction was chosen against.
 *
 * It must not use `documentContentFingerprint`: applying a draft creates fresh
 * block IDs, so the document hash changes on every application even when the
 * copy is identical. The draft itself has no IDs and is the same input the
 * direction was shown with.
 */
export function directionContentFingerprint(slides: readonly AiSlideDraft[]): string {
  return stableStringify(slides.map((slide) => [slide.title, slide.body, slide.speakerNotes, slide.blocks ?? []]));
}

export type MetricBlock = Extract<ContentBlock, { type: "metric" }>;

/** The box a new picture is placed in. */
const IMAGE_BOX = { x: 2, y: 1.7, width: 4, height: 3 } as const;

/**
 * A picture is placed in the box with the proportions of its own pixels, so it
 * is never squeezed into a shape it does not have.
 */
export function imageFrame(naturalWidth?: number, naturalHeight?: number): RectEmu {
  const box = IMAGE_BOX;
  if (
    !naturalWidth ||
    !naturalHeight ||
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return { x: inches(box.x), y: inches(box.y), width: inches(box.width), height: inches(box.height) };
  }
  const aspect = naturalWidth / naturalHeight;
  const width = aspect >= box.width / box.height ? box.width : box.height * aspect;
  const height = aspect >= box.width / box.height ? box.width / aspect : box.height;
  return {
    x: inches(box.x + (box.width - width) / 2),
    y: inches(box.y + (box.height - height) / 2),
    width: inches(width),
    height: inches(height),
  };
}
