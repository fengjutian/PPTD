import { z } from "zod";
import { phaseForEffect } from "./animation";
import { TABLE_MAX_COLUMNS, TABLE_MAX_ROWS } from "./table-data";
import { MAX_CONTENT_VERSIONS } from "./content-version";
import { ELEMENT_NAME_MAX_LENGTH, MAX_DESIGN_DIRECTIONS } from "./types";

export const CURRENT_SCHEMA_VERSION = 30 as const;
export type SchemaVersion = typeof CURRENT_SCHEMA_VERSION;

const positiveEmu = z.number().int().positive();
const rect = z.object({ x: z.number().int(), y: z.number().int(), width: positiveEmu, height: positiveEmu });
const base = z.object({
  id: z.string().uuid(),
  frame: rect,
  rotationMilliDegree: z.number().int(),
  locked: z.boolean(),
  /** Editor-side layer metadata; absent means the derived name and visible. */
  name: z
    .string()
    .trim()
    .min(1)
    .max(ELEMENT_NAME_MAX_LENGTH)
    .regex(/^[^\r\n]+$/, "ELEMENT_NAME_SINGLE_LINE")
    .optional(),
  hidden: z.boolean().optional(),
  /** Missing in legacy documents; the relayout command infers it structurally. */
  origin: z.enum(["generated", "user"]).optional(),
});

const hexColor = z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);

const textElement = base.extend({
  type: z.literal("text"),
  text: z.string(),
  contentRef: z.enum(["title", "body", "decorative"]).optional(),
  contentBlockRef: z
    .object({
      blockId: z.string().uuid(),
      field: z.enum(["label", "value"]),
    })
    .optional(),
  /** The slice of the bound field this element renders; see `TextElement`. */
  contentRange: z
    .object({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .optional(),
  style: z.object({
    fontFamily: z.string().min(1),
    fontSizePt: z.number().positive(),
    color: z.string(),
    bold: z.boolean(),
    align: z.enum(["left", "center", "right"]),
    letterSpacingPt: z.number().min(-2).max(20).optional(),
    lineHeight: z.number().min(0.8).max(3).optional(),
    paragraphSpaceBeforePt: z.number().min(0).max(200).optional(),
    paragraphSpaceAfterPt: z.number().min(0).max(200).optional(),
    tabStops: z
      .array(
        z.object({
          positionPt: z.number().positive().max(2000),
          alignment: z.enum(["left", "center", "right", "decimal"]),
        }),
      )
      .max(32)
      .optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
    bullet: z.enum(["none", "dot", "number"]).optional(),
    indentLevel: z.number().int().min(0).max(8).optional(),
  }),
  runs: z
    .array(
      z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        bold: z.boolean().optional(),
        color: hexColor.optional(),
        underline: z.boolean().optional(),
        hyperlinkUrl: z
          .string()
          .max(2048)
          .regex(/^(?:https?:\/\/[^\s\x00-\x1f]+|mailto:[^\s\x00-\x1f]+)$/i, "TEXT_RUN_HYPERLINK_SCHEME")
          .optional(),
      }),
    )
    .max(200)
    .optional(),
});

const shapeElement = base.extend({
  type: z.literal("shape"),
  shape: z.enum([
    "rectangle",
    "ellipse",
    "triangle",
    "diamond",
    "pentagon",
    "hexagon",
    "chevron",
    "arrow",
    "star",
    "parallelogram",
    "trapezoid",
  ]),
  style: z.object({
    fill: z.string(),
    stroke: z.string(),
    strokeWidthPt: z.number().nonnegative(),
    radiusPt: z.number().nonnegative(),
    shadow: z.enum(["card", "raised", "emphasis"]).optional(),
    fillGradient: z
      .object({
        angleDeg: z.number().min(0).max(360),
        stops: z
          .array(
            z.object({
              offset: z.number().min(0).max(1),
              color: hexColor,
              transparency: z.number().min(0).max(100).optional(),
            }),
          )
          .min(2)
          .max(10)
          .refine(
            (stops) => stops.every((stop, index) => index === 0 || stop.offset >= stops[index - 1]!.offset),
            "gradient stops must be ordered by offset",
          ),
      })
      .optional(),
  }),
});

const lineElement = base.extend({
  type: z.literal("line"),
  direction: z.enum(["horizontal", "vertical", "diagonal"]),
  style: z.object({
    stroke: z.string(),
    strokeWidthPt: z.number().nonnegative(),
    startArrow: z.enum(["none", "arrow"]),
    endArrow: z.enum(["none", "arrow"]),
    dashed: z.boolean(),
  }),
});

/** A crop cuts a fraction off each side of the source image, so the visible region never vanishes. */
const imageCropSchema = z
  .object({
    top: z.number().min(0).max(0.99),
    bottom: z.number().min(0).max(0.99),
    left: z.number().min(0).max(0.99),
    right: z.number().min(0).max(0.99),
  })
  .refine((crop) => crop.top + crop.bottom < 1 && crop.left + crop.right < 1, { message: "IMAGE_CROP_EMPTY" });

const iconElement = base.extend({
  type: z.literal("icon"),
  name: z.enum([
    "book",
    "mountain",
    "water",
    "sun",
    "moon",
    "target",
    "chart",
    "users",
    "bulb",
    "flag",
    "heart",
    "leaf",
  ]),
  style: z.object({
    color: hexColor,
    strokeWidth: z.number().min(1).max(6).optional(),
  }),
});

const assetProvenanceSchema = z
  .object({
    verification: z.enum(["verified", "pending", "user"]),
    sourceUrl: z.string().max(2048).optional(),
    license: z.string().max(200).optional(),
    checkedAt: z.string().max(64).optional(),
    contentHash: z.string().max(64).optional(),
  })
  .superRefine((value, context) => {
    if (value.verification === "verified" && (!value.sourceUrl?.trim() || !value.license?.trim())) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "IMAGE_PROVENANCE_INCOMPLETE" });
    }
  });

const imageElement = base.extend({
  type: z.literal("image"),
  source: z.object({
    kind: z.literal("embedded"),
    // Either an inline data URL (legacy / not-yet-saved) or a content-addressed
    // asset reference written by the desktop backend when the picture is stored.
    dataUrl: z
      .string()
      .max(360_000_000)
      .refine(
        (value) =>
          /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value) ||
          /^asset:\/\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(value),
        { message: "INVALID_IMAGE_DATA_URL" },
      ),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  }),
  altText: z.string().max(500),
  crop: imageCropSchema.optional(),
  frameShape: z.enum(["roundRect", "ellipse"]).optional(),
  tone: z.object({ dark: hexColor, light: hexColor }).optional(),
  provenance: assetProvenanceSchema.optional(),
  placement: z.enum(["content", "layout-background", "slide-background"]).optional(),
});

const tableElement = base.extend({
  type: z.literal("table"),
  contentBlockId: z.string().uuid(),
  style: z.object({
    fontFamily: z.string().min(1),
    fontSizePt: z.number().positive(),
    headerFill: hexColor,
    headerTextColor: hexColor,
    bodyTextColor: hexColor,
    borderColor: hexColor,
    firstColumnBold: z.boolean(),
    bandingFill: hexColor.optional(),
    headerBold: z.boolean().optional(),
    cellPaddingPt: z.number().min(0).max(30).optional(),
    borderWidthPt: z.number().min(0).max(10).optional(),
  }),
});

const chartElement = base.extend({
  type: z.literal("chart"),
  contentBlockIds: z.array(z.string().uuid()).min(1).max(32),
  kind: z.enum(["column", "bar", "line", "pie"]),
  style: z.object({
    fontFamily: z.string().min(1),
    fontSizePt: z.number().positive(),
    textColor: hexColor,
    seriesColors: z.array(hexColor).min(1).max(12),
    showLegend: z.boolean(),
    showValueLabels: z.boolean(),
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
  // Optional so a document written before display faces existed still loads;
  // nothing is inferred from it, it only selects a heading family for titles.
  displayFont: z.string().min(1).max(200).optional(),
  colors: z.array(z.object({ name: z.string().min(1).max(64), value: hexColor })).max(64),
  textStyles: z
    .object({
      display: textStyleTokenSchema.optional(),
      title: textStyleTokenSchema.optional(),
      subtitle: textStyleTokenSchema.optional(),
      body: textStyleTokenSchema.optional(),
      caption: textStyleTokenSchema.optional(),
    })
    .optional(),
});

const slideLayoutSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  backgroundColor: hexColor.optional(),
  capabilities: z
    .object({
      hasTitle: z.boolean(),
      hasBody: z.boolean(),
      hasImage: z.boolean(),
      columns: z.number().int().min(1).max(4),
      free: z.boolean(),
    })
    .optional(),
});

const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().uuid(), type: z.literal("paragraph"), text: z.string().max(20_000) }),
  z.object({ id: z.string().uuid(), type: z.literal("bullet-list"), items: z.array(z.string().max(2_000)).max(100) }),
  z.object({
    id: z.string().uuid(),
    type: z.literal("quote"),
    text: z.string().max(20_000),
    attribution: z.string().max(500).optional(),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal("metric"),
    label: z.string().max(1_000),
    value: z.string().max(1_000),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal("chart"),
    kind: z.enum(["column", "bar", "line", "pie"]),
    categories: z.array(z.string().max(200)).min(2).max(8),
    values: z.array(z.number().finite()).min(2).max(8).optional(),
    series: z
      .array(
        z.object({
          name: z.string().min(1).max(100),
          values: z.array(z.number().finite()).min(2).max(8),
        }),
      )
      .min(1)
      .max(6)
      .optional(),
    unit: z.string().max(20).optional(),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal("timeline"),
    items: z.array(z.object({ label: z.string().max(500), text: z.string().max(2_000) })).max(50),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal("comparison"),
    leftLabel: z.string().max(1_000),
    rightLabel: z.string().max(1_000),
    leftItems: z.array(z.string().max(2_000)).max(50),
    rightItems: z.array(z.string().max(2_000)).max(50),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal("process"),
    items: z.array(z.object({ label: z.string().max(500), text: z.string().max(2_000) })).max(50),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal("table-data"),
    header: z.array(z.string().max(200)).min(1).max(TABLE_MAX_COLUMNS),
    rows: z
      .array(z.array(z.string().max(500)).min(1).max(TABLE_MAX_COLUMNS))
      .min(1)
      .max(TABLE_MAX_ROWS),
    merges: z
      .array(
        z.object({
          section: z.enum(["header", "body"]),
          row: z.number().int().nonnegative(),
          column: z.number().int().nonnegative(),
          rowSpan: z.number().int().min(1).max(TABLE_MAX_ROWS),
          columnSpan: z.number().int().min(1).max(TABLE_MAX_COLUMNS),
        }),
      )
      .max(200)
      .optional(),
  }),
]);

const contentVersionSlideSchema = z.object({
  slideId: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  blocks: z.array(contentBlockSchema).max(64).optional(),
  speakerNotes: z.string(),
});

const animationSchema = z.object({
  id: z.string().uuid(),
  elementId: z.string().uuid(),
  effect: z.enum(["appear", "fade", "fly-in", "float-in", "split", "wipe", "zoom", "pulse", "disappear"]),
  phase: z.enum(["entrance", "emphasis", "exit"]),
  start: z.enum(["on-click", "with-previous", "after-previous"]),
  durationMs: z.number().int().min(100).max(60_000),
  delayMs: z.number().int().min(0).max(60_000),
  direction: z.enum(["none", "left", "right", "top", "bottom"]),
});

const transitionSchema = z.object({
  kind: z.enum(["fade", "push", "wipe", "split"]),
  speed: z.enum(["fast", "medium", "slow"]),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
});

const templateGridSchema = z.object({
  left: z.number(),
  right: z.number(),
  top: z.number(),
  bottom: z.number(),
  titleX: z.number(),
  titleY: z.number(),
  titleWidth: z.number(),
  titleHeight: z.number(),
  bodyTop: z.number(),
  bodyBottom: z.number(),
});

const templateLayoutTargetSchema = z.object({
  name: z.string().min(1).max(200),
  grid: templateGridSchema,
  titleSizePt: z.number().positive().max(400).optional(),
  bodySizePt: z.number().positive().max(400).optional(),
  titleInk: z.string().max(32).optional(),
  bodyInk: z.string().max(32).optional(),
  titleAlign: z.enum(["left", "center", "right"]).optional(),
  bodyAlign: z.enum(["left", "center", "right"]).optional(),
  titleLineHeight: z.number().min(0.5).max(4).optional(),
  bodyLineHeight: z.number().min(0.5).max(4).optional(),
  freeComposition: z.boolean(),
});

const templateTolerancesSchema = z.object({
  axis: z.number().min(0).max(1),
  axisY: z.number().min(0).max(1),
  margin: z.number().min(0).max(1),
  fontSizePt: z.number().min(0).max(100),
  colorChannel: z.number().min(0).max(255),
});

const templateReviewTargetSchema = z.object({
  name: z.string().min(1).max(200),
  templateHash: z.string().max(128).optional(),
  page: z.object({ widthEmu: positiveEmu, heightEmu: positiveEmu }),
  grid: templateGridSchema,
  layouts: z.array(templateLayoutTargetSchema).min(1).max(200),
  palette: z.array(z.string().max(32)).max(100),
  majorFont: z.string().min(1).max(200).optional(),
  minorFont: z.string().min(1).max(200).optional(),
  titleInk: z.string().max(32).optional(),
  bodyInk: z.string().max(32).optional(),
  titleAlign: z.enum(["left", "center", "right"]).optional(),
  bodyAlign: z.enum(["left", "center", "right"]).optional(),
  titleLineHeight: z.number().min(0.5).max(4).optional(),
  bodyLineHeight: z.number().min(0.5).max(4).optional(),
  titleSizePt: z.number().positive().max(400).optional(),
  bodySizePt: z.number().positive().max(400).optional(),
  alignment: z.enum(["left-grid", "centered-grid"]),
  confidence: z.enum(["high", "low"]),
  minimumFit: z.number().min(0).max(100),
  tolerances: templateTolerancesSchema,
});

const contentVersionDesignSchema = z.object({
  pageSize: z.object({ width: positiveEmu, height: positiveEmu }),
  theme: themeSchema.optional(),
  layouts: z.array(slideLayoutSchema).max(200).optional(),
  templateStyle: templateReviewTargetSchema.optional(),
  slides: z
    .array(
      z.object({
        slideId: z.string().uuid(),
        background: z.string(),
        elements: z.array(
          z.discriminatedUnion("type", [
            textElement,
            shapeElement,
            lineElement,
            iconElement,
            imageElement,
            chartElement,
            tableElement,
          ]),
        ),
        animations: z.array(animationSchema).max(500).optional(),
        transition: transitionSchema.optional(),
        groups: z
          .array(z.object({ id: z.string().uuid(), elementIds: z.array(z.string().uuid()).min(2).max(200) }))
          .max(100)
          .optional(),
        layoutId: z.string().uuid().optional(),
      }),
    )
    .min(1)
    .max(500),
});

const contentVersionSchema = z.object({
  id: z.string().uuid(),
  contentRevision: z.number().int().nonnegative(),
  documentRevision: z.number().int().nonnegative(),
  slides: z.array(contentVersionSlideSchema).min(1).max(500),
  design: contentVersionDesignSchema.optional(),
});

const slideSchema = z.object({
  id: z.string().uuid(),
  background: z.string(),
  content: z.object({
    title: z.string(),
    body: z.string(),
    blocks: z.array(contentBlockSchema).max(64).optional(),
    speakerNotes: z.string(),
    status: z.enum(["draft", "review", "approved", "changed", "needs_review"]),
    contentHash: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .optional(),
  }),
  elements: z.array(
    z.discriminatedUnion("type", [
      textElement,
      shapeElement,
      lineElement,
      iconElement,
      imageElement,
      chartElement,
      tableElement,
    ]),
  ),
  animations: z.array(animationSchema).max(500).optional(),
  transition: transitionSchema.optional(),
  groups: z
    .array(
      z.object({
        id: z.string().uuid(),
        elementIds: z.array(z.string().uuid()).min(2).max(200),
      }),
    )
    .max(100)
    .optional(),
  layoutId: z.string().uuid().optional(),
});

const designDirectionProposalSchema = z.object({
  id: z.string().uuid(),
  preset: z.enum(["editorial", "documentary", "paper", "instrument"]),
  name: z.string().min(1).max(20),
  idea: z.string().min(1).max(80),
  rationale: z.string().min(1).max(120),
  typeContrast: z.enum(["calm", "strong", "dramatic"]),
  imagery: z.enum(["none", "hero", "band", "side", "texture"]),
  previewPages: z
    .array(z.object({ index: z.number().int().nonnegative(), contentFingerprint: z.string().min(1).max(200) }))
    .max(3),
});

const designDirectionRecordSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().min(1).max(64),
  contentRevision: z.number().int().nonnegative(),
  contentFingerprint: z.string().min(1).max(20_000),
  proposals: z.array(designDirectionProposalSchema).min(1).max(4),
  selectedProposalId: z.string().uuid(),
  selectedBy: z.enum(["user", "fallback"]),
  userWords: z.string().max(200).optional(),
  regenerations: z.number().int().min(0).max(2),
  promptVersion: z.string().min(1).max(64),
  model: z.string().min(1).max(120).optional(),
});

const baseDocumentSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.number().int(),
  title: z.string().min(1),
  pageSize: z.object({ width: positiveEmu, height: positiveEmu }),
  revisions: z.object({
    document: z.number().int().nonnegative(),
    content: z.number().int().nonnegative(),
    design: z.number().int().nonnegative(),
  }),
  slides: z.array(slideSchema).min(1),
  theme: themeSchema.optional(),
  layouts: z.array(slideLayoutSchema).max(200).optional(),
  templateStyle: templateReviewTargetSchema.optional(),
  contentVersions: z.array(contentVersionSchema).max(MAX_CONTENT_VERSIONS).optional(),
  designDirections: z.array(designDirectionRecordSchema).max(MAX_DESIGN_DIRECTIONS).optional(),
  reviewTraces: z
    .array(
      z.object({
        id: z.string().uuid(),
        createdAt: z.string(),
        overallScore: z.number(),
        templateFitScore: z.number().min(0).max(100).optional(),
        templateName: z.string().min(1).max(200).optional(),
        templateHash: z.string().max(128).optional(),
        templateFitCounts: z.record(z.string().max(80), z.number().int().nonnegative()).optional(),
        issueCount: z.number().int().nonnegative(),
        slides: z.array(z.object({ slideIndex: z.number().int().nonnegative(), overallScore: z.number() })).max(500),
      }),
    )
    .max(20)
    .optional(),
});

type DocumentShape = z.infer<typeof baseDocumentSchema>;

function validateUniqueIds(document: DocumentShape, context: z.RefinementCtx): void {
  const slideIds = new Set<string>();
  const elementIds = new Set<string>();
  const animationIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const [slideIndex, slide] of document.slides.entries()) {
    if (slideIds.has(slide.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slides", slideIndex, "id"],
        message: "DUPLICATE_SLIDE_ID",
      });
    }
    slideIds.add(slide.id);
    for (const [elementIndex, element] of slide.elements.entries()) {
      if (elementIds.has(element.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slides", slideIndex, "elements", elementIndex, "id"],
          message: "DUPLICATE_ELEMENT_ID",
        });
      }
      elementIds.add(element.id);
    }
    const slideElementIds = new Set(slide.elements.map((element) => element.id));
    for (const [animationIndex, animation] of (slide.animations ?? []).entries()) {
      if (animationIds.has(animation.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slides", slideIndex, "animations", animationIndex, "id"],
          message: "DUPLICATE_ANIMATION_ID",
        });
      }
      animationIds.add(animation.id);
      if (!slideElementIds.has(animation.elementId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slides", slideIndex, "animations", animationIndex, "elementId"],
          message: "UNKNOWN_ANIMATION_ELEMENT",
        });
      }
      if (animation.phase !== phaseForEffect(animation.effect)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slides", slideIndex, "animations", animationIndex, "phase"],
          message: "ANIMATION_PHASE_MISMATCH",
        });
      }
    }
    const groupedElements = new Set<string>();
    for (const [groupIndex, group] of (slide.groups ?? []).entries()) {
      if (groupIds.has(group.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slides", slideIndex, "groups", groupIndex, "id"],
          message: "DUPLICATE_GROUP_ID",
        });
      }
      groupIds.add(group.id);
      for (const elementId of group.elementIds) {
        if (!slideElementIds.has(elementId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["slides", slideIndex, "groups", groupIndex, "elementIds"],
            message: "UNKNOWN_GROUP_ELEMENT",
          });
        }
        if (groupedElements.has(elementId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["slides", slideIndex, "groups", groupIndex, "elementIds"],
            message: "ELEMENT_IN_MULTIPLE_GROUPS",
          });
        }
        groupedElements.add(elementId);
      }
    }
  }
}

function validateLayoutReferences(document: DocumentShape, context: z.RefinementCtx): void {
  const layoutIds = new Set((document.layouts ?? []).map((layout) => layout.id));
  for (const [slideIndex, slide] of document.slides.entries()) {
    if (slide.layoutId && !layoutIds.has(slide.layoutId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slides", slideIndex, "layoutId"],
        message: "UNKNOWN_SLIDE_LAYOUT",
      });
    }
  }
}

function validateTableMerges(document: DocumentShape, context: z.RefinementCtx): void {
  document.slides.forEach((slide, slideIndex) => {
    (slide.content.blocks ?? []).forEach((block, blockIndex) => {
      if (block.type !== "table-data" || !block.merges?.length) return;
      const covered = new Set<string>();
      const path = ["slides", slideIndex, "content", "blocks", blockIndex, "merges"];
      for (const merge of block.merges) {
        const rowCount = merge.section === "header" ? 1 : block.rows.length;
        if (merge.row >= rowCount || merge.column >= block.header.length) {
          context.addIssue({ code: z.ZodIssueCode.custom, path, message: "TABLE_MERGE_OUT_OF_RANGE" });
          continue;
        }
        if (merge.section === "header" && merge.rowSpan !== 1) {
          // A merge that crosses the header/body boundary has no stable
          // section; the importer reports it and keeps the header one row.
          context.addIssue({ code: z.ZodIssueCode.custom, path, message: "TABLE_MERGE_HEADER_ROWSPAN" });
          continue;
        }
        if (merge.column + merge.columnSpan > block.header.length || merge.row + merge.rowSpan > rowCount) {
          context.addIssue({ code: z.ZodIssueCode.custom, path, message: "TABLE_MERGE_OUT_OF_RANGE" });
          continue;
        }
        let overlapping = false;
        for (let row = merge.row; row < merge.row + merge.rowSpan; row += 1) {
          for (let column = merge.column; column < merge.column + merge.columnSpan; column += 1) {
            const key = `${merge.section}:${row}:${column}`;
            if (covered.has(key)) overlapping = true;
            covered.add(key);
          }
        }
        if (overlapping) {
          context.addIssue({ code: z.ZodIssueCode.custom, path, message: "TABLE_MERGE_OVERLAP" });
        }
      }
    });
  });
}

export const presentationDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(CURRENT_SCHEMA_VERSION) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences)
  .superRefine(validateTableMerges);

const versionEighteenDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(18) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionTwentyFourDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(24) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionTwentyFiveDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(25) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionTwentyEightDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(28) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionTwentyNineDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(29) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionTwentySevenDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(27) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionTwentySixDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(26) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionTwentyThreeDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(23) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionTwentyTwoDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(22) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionTwentyOneDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(21) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionTwentyDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(20) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionNineteenDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(19) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionSeventeenDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(17) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionSixteenDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(16) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionFifteenDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(15) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionFourteenDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(14) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionTenDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(10) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionElevenDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(11) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionTwelveDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(12) })
  .superRefine(validateUniqueIds)
  .superRefine(validateLayoutReferences);

const versionThirteenDocumentSchema = baseDocumentSchema
  .extend({ schemaVersion: z.literal(13) })
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
  // Version 11 adds the line element. A version 10 document has no line, so it
  // keeps every page and every object and simply draws nothing extra.
  10: (document) => ({ ...versionTenDocumentSchema.parse(document), schemaVersion: 11 }),
  // Version 12 adds design-only page animations. Existing documents keep all
  // objects and simply have no animation timeline.
  11: (document) => ({ ...versionElevenDocumentSchema.parse(document), schemaVersion: 12 }),
  // Version 13 links a generated card text to the metric block it reproduces.
  // The link is optional, so older documents keep every card as plain text and
  // simply cannot be edited through the structured metric fields.
  12: (document) => ({ ...versionTwelveDocumentSchema.parse(document), schemaVersion: 13 }),
  // Version 14 stores confirmed content snapshots. An older document has no
  // history yet; the first confirmation creates the first version.
  13: (document) => ({ ...versionThirteenDocumentSchema.parse(document), schemaVersion: 14 }),
  // Version 15 adds character and paragraph formatting (italic, strike,
  // vertical alignment, markers, indentation). Every field is optional, so a
  // version 14 document keeps every page and simply shows unstyled paragraphs.
  14: (document) => ({ ...versionFourteenDocumentSchema.parse(document), schemaVersion: 15 }),
  // Version 16 widens animations to the emphasis and exit phases. Existing
  // animations are all entrances, which the new schema still accepts; a deck
  // with no timeline simply keeps no timeline.
  15: (document) => ({ ...versionFifteenDocumentSchema.parse(document), schemaVersion: 16 }),
  // Version 17 adds editor-side selection groups. A version 16 document has no
  // groups, so every page keeps its objects and simply has no grouping.
  16: (document) => ({ ...versionSixteenDocumentSchema.parse(document), schemaVersion: 17 }),
  // Version 18 adds a design-only page transition. The field is optional, so a
  // version 17 document keeps every page and simply has no transition.
  17: (document) => ({ ...versionSeventeenDocumentSchema.parse(document), schemaVersion: 18 }),
  // Version 19 widens the shape enum to the preset geometries and adds the
  // optional merges of a table block. Older documents only contain
  // rectangle/ellipse and unmerged tables, which are still valid, so nothing
  // has to be rewritten.
  18: (document) => ({ ...versionEighteenDocumentSchema.parse(document), schemaVersion: 19 }),
  // Version 20 stores the design-direction decision. It is design state and
  // optional: an older document keeps every page and simply has no recorded
  // direction, so the next generation asks again instead of guessing.
  19: (document) => ({ ...versionNineteenDocumentSchema.parse(document), schemaVersion: 20 }),
  // Version 21 adds the source and licence of a picture. The field is optional:
  // imported and older pictures keep no provenance and are reported as such.
  20: (document) => ({ ...versionTwentyDocumentSchema.parse(document), schemaVersion: 21 }),
  // Version 22 adds the persisted template review target. The field is
  // optional: an older project simply has no template target to reuse.
  21: (document) => ({ ...versionTwentyOneDocumentSchema.parse(document), schemaVersion: 22 }),
  // Version 23 adds the shadow token of a shape. It is optional and defaults to
  // flat, so a version 22 document keeps every object and renders exactly as it
  // did; the set of cards that float is a design decision, not a migration.
  22: (document) => ({ ...versionTwentyTwoDocumentSchema.parse(document), schemaVersion: 23 }),
  // Version 24 adds the frame shape of a picture. Optional, so a version 23
  // document keeps its rectangular pictures and renders exactly as it did.
  23: (document) => ({ ...versionTwentyThreeDocumentSchema.parse(document), schemaVersion: 24 }),
  // Version 25 adds the editor-side layer name and visibility flag. Both are
  // optional: a version 24 document keeps deriving every name and stays fully
  // visible, so approving a deck does not silently hide an object.
  24: (document) => ({ ...versionTwentyFourDocumentSchema.parse(document), schemaVersion: 25 }),
  // Version 26 adds optional paragraph spacing. Older text keeps its existing
  // compact flow because the migration does not invent spacing values.
  25: (document) => ({ ...versionTwentyFiveDocumentSchema.parse(document), schemaVersion: 26 }),
  // Version 27 adds optional native tab stops. Existing tabs keep rendering as
  // plain text because the migration does not invent layout positions.
  26: (document) => ({ ...versionTwentySixDocumentSchema.parse(document), schemaVersion: 27 }),
  // 28 adds the optional picture tone; a document without one is unchanged.
  27: (document) => ({ ...versionTwentySevenDocumentSchema.parse(document), schemaVersion: 28 }),
  // 29 adds the optional layout capabilities; a layout without them is unchanged.
  28: (document) => ({ ...versionTwentyEightDocumentSchema.parse(document), schemaVersion: 29 }),
  // 30 preserves safe external links on text fragments. Older documents have
  // no links, so migration must not infer a destination from visible text.
  29: (document) => ({ ...versionTwentyNineDocumentSchema.parse(document), schemaVersion: 30 }),
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
