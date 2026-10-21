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

const imageElement = base.extend({
  type: z.literal("image"),
  source: z.object({
    kind: z.literal("embedded"),
    dataUrl: z.string().max(360_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  }),
  altText: z.string().max(500),
});

export const presentationDocumentSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(2),
  title: z.string().min(1),
  pageSize: z.object({ width: positiveEmu, height: positiveEmu }),
  revisions: z.object({ document: z.number().int().nonnegative(), content: z.number().int().nonnegative(), design: z.number().int().nonnegative() }),
  slides: z.array(z.object({
    id: z.string().uuid(),
    background: z.string(),
    content: z.object({ title: z.string(), body: z.string(), speakerNotes: z.string(), status: z.enum(["draft", "review", "approved", "changed", "needs_review"]) }),
    elements: z.array(z.discriminatedUnion("type", [textElement, shapeElement, imageElement])),
  })).min(1),
});

const versionOneDocumentSchema = presentationDocumentSchema.extend({ schemaVersion: z.literal(1) });

export function parsePresentationDocument(input: unknown) {
  const version = z.object({ schemaVersion: z.number().int() }).passthrough().parse(input).schemaVersion;
  if (version === 1) {
    const legacy = versionOneDocumentSchema.parse(input);
    return presentationDocumentSchema.parse({ ...legacy, schemaVersion: 2 });
  }
  return presentationDocumentSchema.parse(input);
}
