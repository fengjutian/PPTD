import type { ElementId, Emu, PresentationDocument, RectEmu, SlideId, SupportedImageMimeType } from "../document-model";
import { createSlide, inches } from "../document-model";

export type ChangeDomain = "content" | "design" | "both";
export interface AiSlideDraft { title: string; body: string; speakerNotes: string }

export type DocumentCommand =
  | { type: "add-slide" }
  | { type: "apply-ai-draft"; title: string; slides: AiSlideDraft[] }
  | { type: "duplicate-slide"; slideId: SlideId }
  | { type: "delete-slide"; slideId: SlideId }
  | { type: "move-slide"; slideId: SlideId; toIndex: number }
  | { type: "set-slide"; slideId: SlideId }
  | { type: "add-text"; slideId: SlideId }
  | { type: "add-image"; slideId: SlideId; dataUrl: string; mimeType: SupportedImageMimeType; altText: string }
  | { type: "add-shape"; slideId: SlideId; shape: "rectangle" | "ellipse" }
  | { type: "duplicate-element"; slideId: SlideId; elementId: ElementId }
  | { type: "delete-element"; slideId: SlideId; elementId: ElementId }
  | { type: "set-element-lock"; slideId: SlideId; elementId: ElementId; locked: boolean }
  | { type: "transform-element"; slideId: SlideId; elementId: ElementId; frame: RectEmu; rotationMilliDegree: number }
  | { type: "move-element"; slideId: SlideId; elementId: ElementId; x: Emu; y: Emu }
  | { type: "edit-text"; slideId: SlideId; elementId: ElementId; text: string };

export function commandDomain(command: DocumentCommand): ChangeDomain | null {
  switch (command.type) {
    case "set-slide": return null;
    case "edit-text": return "content";
    case "add-text": return "both";
    case "add-image": return "both";
    case "add-slide": return "both";
    case "apply-ai-draft": return "both";
    case "duplicate-slide": return "both";
    case "delete-slide": return "both";
    case "move-slide": return "both";
    default: return "design";
  }
}

export function applyCommand(document: PresentationDocument, command: DocumentCommand): void {
  if (command.type === "set-slide") return;
  if (command.type === "add-slide") {
    document.slides.push(createSlide(document.slides.length + 1));
    return;
  }
  if (command.type === "apply-ai-draft") {
    if (!command.title.trim() || command.slides.length < 1 || command.slides.length > 20) throw new Error("AI_DRAFT_INVALID");
    document.title = command.title.trim();
    document.slides = command.slides.map((draft, index) => {
      const slide = createSlide(index + 1);
      slide.content = { title: draft.title, body: draft.body, speakerNotes: draft.speakerNotes, status: "draft" };
      const title = slide.elements[0];
      if (title?.type === "text") title.text = draft.title;
      if (draft.body.trim()) slide.elements.push({ id: crypto.randomUUID() as ElementId, type: "text", frame: { x: inches(0.9), y: inches(1.8), width: inches(10.8), height: inches(4.6) }, rotationMilliDegree: 0, locked: false, text: draft.body, style: { fontFamily: "Microsoft YaHei", fontSizePt: 20, color: "#262626", bold: false, align: "left" } });
      return slide;
    });
    return;
  }
  if (command.type === "duplicate-slide") {
    const sourceIndex = document.slides.findIndex((item) => item.id === command.slideId);
    if (sourceIndex < 0) throw new Error("SLIDE_NOT_FOUND");
    const source = document.slides[sourceIndex]!;
    const duplicate = {
      ...source,
      id: crypto.randomUUID() as SlideId,
      content: { ...source.content },
      elements: source.elements.map((element) => element.type === "text"
        ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame }, style: { ...element.style } }
        : element.type === "shape"
          ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame }, style: { ...element.style } }
          : { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame }, source: { ...element.source } }),
    };
    document.slides.splice(sourceIndex + 1, 0, duplicate);
    return;
  }
  if (command.type === "delete-slide") {
    if (document.slides.length === 1) throw new Error("LAST_SLIDE_CANNOT_BE_DELETED");
    const sourceIndex = document.slides.findIndex((item) => item.id === command.slideId);
    if (sourceIndex < 0) throw new Error("SLIDE_NOT_FOUND");
    document.slides.splice(sourceIndex, 1);
    return;
  }
  if (command.type === "move-slide") {
    const sourceIndex = document.slides.findIndex((item) => item.id === command.slideId);
    if (sourceIndex < 0) throw new Error("SLIDE_NOT_FOUND");
    if (!Number.isInteger(command.toIndex) || command.toIndex < 0 || command.toIndex >= document.slides.length) {
      throw new Error("SLIDE_INDEX_OUT_OF_RANGE");
    }
    if (sourceIndex === command.toIndex) return;
    const [slide] = document.slides.splice(sourceIndex, 1);
    document.slides.splice(command.toIndex, 0, slide!);
    return;
  }
  const slide = document.slides.find((item) => item.id === command.slideId);
  if (!slide) throw new Error("SLIDE_NOT_FOUND");

  if (command.type === "add-text") {
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "text",
      frame: { x: inches(1), y: inches(1.8), width: inches(4), height: inches(0.65) },
      rotationMilliDegree: 0,
      locked: false,
      text: "新文本",
      style: { fontFamily: "Microsoft YaHei", fontSizePt: 20, color: "#17181c", bold: false, align: "left" },
    });
    if (slide.content.status === "approved") slide.content.status = "changed";
    return;
  }
  if (command.type === "add-image") {
    const expectedPrefix = `data:${command.mimeType};base64,`;
    const payload = command.dataUrl.slice(expectedPrefix.length);
    if (!command.dataUrl.startsWith(expectedPrefix) || command.dataUrl.length > 360_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload) || command.altText.length > 500) {
      throw new Error("INVALID_IMAGE_SOURCE");
    }
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "image",
      frame: { x: inches(2), y: inches(1.7), width: inches(4), height: inches(3) },
      rotationMilliDegree: 0,
      locked: false,
      source: { kind: "embedded", dataUrl: command.dataUrl, mimeType: command.mimeType },
      altText: command.altText,
    });
    if (slide.content.status === "approved") slide.content.status = "changed";
    return;
  }
  if (command.type === "add-shape") {
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "shape",
      shape: command.shape,
      frame: { x: inches(4), y: inches(2.4), width: inches(2.4), height: inches(1.4) },
      rotationMilliDegree: 0,
      locked: false,
      style: { fill: "#d35230", stroke: "#7f2f1d", strokeWidthPt: 1.5, radiusPt: 12 },
    });
    return;
  }

  const element = slide.elements.find((item) => item.id === command.elementId);
  if (!element) throw new Error("ELEMENT_NOT_FOUND");
  if (command.type === "set-element-lock") {
    element.locked = command.locked;
    return;
  }
  if (element.locked) throw new Error("ELEMENT_LOCKED");
  if (command.type === "duplicate-element") {
    const sourceIndex = slide.elements.findIndex((item) => item.id === command.elementId);
    const offset = inches(0.2);
    const duplicate = element.type === "text"
      ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame, x: (element.frame.x + offset) as Emu, y: (element.frame.y + offset) as Emu }, style: { ...element.style } }
      : element.type === "shape"
        ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame, x: (element.frame.x + offset) as Emu, y: (element.frame.y + offset) as Emu }, style: { ...element.style } }
        : { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame, x: (element.frame.x + offset) as Emu, y: (element.frame.y + offset) as Emu }, source: { ...element.source } };
    slide.elements.splice(sourceIndex + 1, 0, duplicate);
    return;
  }
  if (command.type === "delete-element") {
    slide.elements.splice(slide.elements.findIndex((item) => item.id === command.elementId), 1);
    return;
  }
  if (command.type === "move-element") {
    if (!Number.isSafeInteger(command.x) || !Number.isSafeInteger(command.y)) throw new Error("INVALID_ELEMENT_TRANSFORM");
    element.frame = { ...element.frame, x: command.x, y: command.y };
  }
  if (command.type === "transform-element") {
    const values = [command.frame.x, command.frame.y, command.frame.width, command.frame.height, command.rotationMilliDegree];
    if (!values.every(Number.isSafeInteger) || command.frame.width <= 0 || command.frame.height <= 0) {
      throw new Error("INVALID_ELEMENT_TRANSFORM");
    }
    element.frame = { ...command.frame };
    element.rotationMilliDegree = command.rotationMilliDegree;
  }
  if (command.type === "edit-text") {
    if (element.type !== "text") throw new Error("ELEMENT_NOT_TEXT");
    element.text = command.text;
    if (slide.elements[0]?.id === element.id) slide.content.title = command.text;
    if (slide.content.status === "approved") slide.content.status = "changed";
  }
}
