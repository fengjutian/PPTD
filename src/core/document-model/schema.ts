import { z } from "zod";
import { TABLE_MAX_COLUMNS, TABLE_MAX_ROWS } from "./table-data";

export const CURRENT_SCHEMA_VERSION = 10 as const;
export type SchemaVersion = typeof CURRENT_SCHEMA_VERSION;

const positiveEmu = z.number().int().positive();
const rect = z.object({ x: z.number().int(), y: z.number().int(), width: positiveEmu, height: positiveEmu });
const base = z.object({
  id: z.string().uuid(),
  frame: rect,
  rotationMilliDegree: z.number().int(),
  locked: z.boolean(),
  /** Missing in legacy documents; the relayout command infers it structurally. */
  origin: z.enum(["generated", "user"]).optional(),
});

const hexColor = z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);

const textElement = base.extend({
  type: z.literal("text"),
  text: z.string(),
  contentRef: z.enum(["title", "body", "decorative"]).optional(),
  style: z.object({
    fontFamily: z.string().min(1), fontSizePt: z.number().positive(), color: z.string(), bold: z.boolean(),
    align: z.enum(["left", "center", "right"]),
  }),
  runs: z.array(z.object({
    start: z.number().int().nonnegative(), end: z.number().int().positive(),
    bold: z.boolean().optional(), color: hexColor.optional(), underline: z.boolean().optional(),
  })).max(200).optional(),
});

const shapeElement = base.extend({
  type: z.literal("shape"),
  shape: z.enum(["rectangle", "ellipse"]),
  style: z.object({ fill: z.string(), stroke: z.string(), strokeWidthPt: z.number().nonnegative(), radiusPt: z.number().nonnegative() }),
});

/** A crop cuts a fraction off each side of the source image, so the visible region never vanishes. */
const imageCropSchema = z.object({
  top: z.number().min(0).max(0.99),
  bottom: z.number().min(0).max(0.99),
  left: z.number().min(0).max(0.99),
  right: z.number().min(0).max(0.99),
}).refine((crop) => crop.top + crop.bottom < 1 && crop.left + crop.right < 1, { message: "IMAGE_CROP_EMPTY" });

const imageElement = base.extend({
  type: z.literal("image"),
  source: z.object({
    kind: z.literal("embedded"),
    // Either an inline data URL (legacy / not-yet-saved) or a content-addressed
    // asset reference written by the desktop backend when the picture is stored.
    dataUrl: z.string().max(360_000_000).refine(
      (value) => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
        || /^asset:\/\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(value),
      { message: "INVALID_IMAGE_DATA_URL" },
    ),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  }),
  altText: z.string().max(500),
  crop: imageCropSchema.optional(),
  placement: z.enum(["content", "layout-background", "slide-background"]).optional(),
});

const tableElement = base.extend({
  type: z.literal("table"),
  contentBlockId: z.string().uuid(),
  style: z.object({
    fontFamily: z.string().min(1), fontSizePt: z.number().positive(),
    headerFill: hexColor, headerTextColor: hexColor, bodyTextColor: hexColor, borderColor: hexColor,
    firstColumnBold: z.boolean(),
  }),
});

const chartElement = base.extend({
  type: z.literal("chart"),
  contentBlockIds: z.array(z.string().uuid()).min(1).max(32),
  kind: z.enum(["column", "bar", "line", "pie"]),
  style: z.object({
    fontFamily: z.string().min(1), fontSizePt: z.number().positive(), textColor: hexColor,
    seriesColors: z.array(hexColor).min(1).max(12), showLegend: z.boolean(), showValueLabels: z.boolean(),
  }),
});

const textStyleTokenSchema = z.object({
  fontSizePt: z.number().positive().max(200),
  bold: z.boolean().optional(),
  color: hexColor.optional(),
  lineHeight: z.number().min(0.8).max(3).optional(),
  letterSpacingPt: z.number().min(-2).max(20).optional(),
});

const themeSchema = z.object({
  name: z.string().min(1).max(200),
  majorFont: z.string().min(1).max(200),
  minorFont: z.string().min(1).max(200),
  colors: z.array(z.object({ name: z.string().min(1).max(64), value: hexColor })).max(64),
  textStyles: z.object({
    display: textStyleTokenSchema.optional(),
    title: textStyleTokenSchema.optional(),
    subtitle: textStyleTokenSchema.optional(),
    body: textStyleTokenSchema.optional(),
    caption: textStyleTokenSchema.optional(),
  }).optional(),
});

const slideLayoutSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  backgroundColor: hexColor.optional(),
});

const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().uuid(), type: z.literal("paragraph"), text: z.string().max(20_000) }),
  z.object({ id: z.string().uuid(), type: z.literal("bullet-list"), items: z.array(z.string().max(2_000)).max(100) }),
  z.object({ id: z.string().uuid(), type: z.literal("quote"), text: z.string().max(20_000), attribution: z.string().max(500).optional() }),
  z.object({ id: z.string().uuid(), type: z.literal("metric"), label: z.string().max(1_000), value: z.string().max(1_000) }),
  z.object({ id: z.string().uuid(), type: z.literal("timeline"), items: z.array(z.object({ label: z.string().max(500), text: z.string().max(2_000) })).max(50) }),
  z.object({ id: z.string().uuid(), type: z.literal("comparison"), leftLabel: z.string().max(1_000), rightLabel: z.string().max(1_000), leftItems: z.array(z.string().max(2_000)).max(50), rightItems: z.array(z.string().max(2_000)).max(50) }),
  z.object({ id: z.string().uuid(), type: z.literal("process"), items: z.array(z.object({ label: z.string().max(500), text: z.string().max(2_000) })).max(50) }),
  z.object({ id: z.string().uuid(), type: z.literal("table-data"), header: z.array(z.string().max(200)).min(1).max(TABLE_MAX_COLUMNS), rows: z.array(z.array(z.string().max(500)).min(1).max(TABLE_MAX_COLUMNS)).min(1).max(TABLE_MAX_ROWS) }),
]);

const slideSchema = z.object({
  id: z.string().uuid(),
  background: z.string(),
  content: z.object({ title: z.string(), body: z.string(), blocks: z.array(contentBlockSchema).max(64).optional(), speakerNotes: z.string(), status: z.enum(["draft", "review", "approved", "changed", "needs_review"]), contentHash: z.string().regex(/^[0-9a-f]{16}$/).optional() }),
  elements: z.array(z.discriminatedUnion("type", [textElement, shapeElement, imageElement, chartElement, tableElement])),
  layoutId: z.string().uuid().optional(),
});

const baseDocumentSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.number().int(),
  title: z.string().min(1),
  pageSize: z.object({ width: positiveEmu, height: positiveEmu }),
  revisions: z.object({ document: z.number().int().nonnegative(), content: z.number().int().nonnegative(), design: z.number().int().nonnegative() }),
  slides: z.array(slideSchema).min(1),
  theme: themeSchema.optional(),
  layouts: z.array(slideLayoutSchema).max(200).optional(),
});

type DocumentShape = z.infer<typeof baseDocumentSchema>;

function validateUniqueIds(document: DocumentShape, context: z.RefinementCtx): void {
  const slideIds = new Set<string>();
  const elementIds = new Set<string>();
  for (const [slideIndex, slide] of document.slides.entries()) {
    if (slideIds.has(slide.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["slides", slideIndex, "id"], message: "DUPLICATE_SLIDE_ID" });
    }
    slideIds.add(slide.id);
    for (const [elementIndex, element] of slide.elements.entries()) {
      if (elementIds.has(element.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["slides", slideIndex, "elements", elementIndex, "id"], message: "DUPLICATE_ELEMENT_ID" });
      }
      elementIds.add(element.id);
    }
  }
}

function validateLayoutReferences(document: DocumentShape, context: z.RefinementCtx): void {
  const layoutIds = new Set((document.layouts ?? []).map((layout) => layout.id));
  for (const [slideIndex, slide] of document.slides.entries()) {
    if (slide.layoutId && !layoutIds.has(slide.layoutId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["slides", slideIndex, "layoutId"], message: "UNKNOWN_SLIDE_LAYOUT" });
    }
  }
}

export const presentationDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(CURRENT_SCHEMA_VERSION) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionNineDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(9) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionEightDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(8) })
  .superRefine(validateUniqueIds);

const versionSevenDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(7) })
  .superRefine(validateUniqueIds);

const versionSixDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(6) })
  .superRefine(validateUniqueIds);

const versionFiveDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(5) })
  .superRefine(validateUniqueIds);

const versionFourDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(4) })
  .superRefine(validateUniqueIds);

const versionThreeDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(3) })
  .superRefine(validateUniqueIds);

const versionTwoDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(2) })
  .superRefine(validateUniqueIds);

const versionOneDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(1) })
  .superRefine(validateUniqueIds);

export type PresentationDocumentInput = z.infer<typeof presentationDocumentSchema>;

type Migration = (document: unknown) => unknown;
const migrations: Readonly<Record<number, Migration>> = {
  1: (document) => ({ ...versionOneDocumentSchema.parse(document), schemaVersion: 2 }),
  // Version 3 adds the template theme and the layout binding of a slide.
  // Both are optional, so a version 2 document keeps every page and every
  // object and simply has no layout to export.
  2: (document) => ({ ...versionTwoDocumentSchema.parse(document), schemaVersion: 3 }),
  // Version 4 adds the crop of a picture. The field is optional, so a version 3
  // document keeps every picture and simply shows the whole source image.
  3: (document) => ({ ...versionThreeDocumentSchema.parse(document), schemaVersion: 4 }),
  // Version 5 adds the native chart. A version 4 document has no chart, so it
  // keeps every page and every object and simply has nothing to chart.
  4: (document) => ({ ...versionFourDocumentSchema.parse(document), schemaVersion: 5 }),
  // Version 6 adds the design provenance of an element. Older documents keep
  // every object; relayout infers provenance for them from the rendered page.
  5: (document) => ({ ...versionFiveDocumentSchema.parse(document), schemaVersion: 6 }),
  // Version 7 adds the native table and the table block. A version 6 document
  // has no table, so it keeps every page and every object.
  6: (document) => ({ ...versionSixDocumentSchema.parse(document), schemaVersion: 7 }),
  // Version 8 adds the styled fragments of a text element. The field is
  // optional, so a version 7 document keeps every page and simply renders one
  // uniform style per text box.
  7: (document) => ({ ...versionSevenDocumentSchema.parse(document), schemaVersion: 8 }),
  // Version 9 widens the picture source so it may carry a content-addressed
  // asset reference instead of an inline data URL. A version 8 document has
  // only inline data, which the new schema still accepts, so nothing changes.
  8: (document) => ({ ...versionEightDocumentSchema.parse(document), schemaVersion: 9 }),
  // Version 10 adds an explicit page-background picture placement. Existing
  // pictures keep their previous placement and no visual object is invented.
  9: (document) => ({ ...versionNineDocumentSchema.parse(document), schemaVersion: 10 }),
};

export function parsePresentationDocument(input: unknown) {
  const version = z.object({ schemaVersion: z.number().int() }).passthrough().parse(input).schemaVersion;
  if (version < 1 || version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`UNSUPPORTED_SCHEMA_VERSION: ${version}`);
  }
  let document: unknown = input;
  for (let current = version; current < CURRENT_SCHEMA_VERSION; current += 1) {
    const migrate = migrations[current];
    if (!migrate) throw new Error(`SCHEMA_MIGRATION_MISSING: ${current}->${current + 1}`);
    document = migrate(document);
  }
  return presentationDocumentSchema.parse(document);
}
