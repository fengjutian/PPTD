import { z } from "zod";

const positiveEmu = z.number().int().positive();
const rect = z.object({ x: z.number().int(), y: z.number().int(), width: positiveEmu, height: positiveEmu });
const base = z.object({
  id: z.string().uuid(),
  frame: rect,
  rotationMilliDegree: z.number().int(),
  locked: z.boolean(),
});

const textElement = base.extend({
  type: z.literal("text"),
  text: z.string(),
  style: z.object({
    fontFamily: z.string().min(1), fontSizePt: z.number().positive(), color: z.string(), bold: z.boolean(),
    align: z.enum(["left", "center", "right"]),
  }),
});

const shapeElement = base.extend({
  type: z.literal("shape"),
  shape: z.enum(["rectangle", "ellipse"]),
  style: z.object({ fill: z.string(), stroke: z.string(), strokeWidthPt: z.number().nonnegative(), radiusPt: z.number().nonnegative() }),
});

export const presentationDocumentSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(1),
  title: z.string().min(1),
  pageSize: z.object({ width: positiveEmu, height: positiveEmu }),
  revisions: z.object({ document: z.number().int().nonnegative(), content: z.number().int().nonnegative(), design: z.number().int().nonnegative() }),
  slides: z.array(z.object({
    id: z.string().uuid(),
    background: z.string(),
    content: z.object({ title: z.string(), body: z.string(), speakerNotes: z.string(), status: z.enum(["draft", "review", "approved", "changed", "needs_review"]) }),
    elements: z.array(z.discriminatedUnion("type", [textElement, shapeElement])),
  })).min(1),
});
