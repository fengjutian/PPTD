import type { ElementId, Emu, PresentationDocument, RectEmu, SlideId, SupportedImageMimeType } from "../document-model";
import { createSlide, inches } from "../document-model";

export type ChangeDomain = "content" | "design" | "both";
export interface AiSlideDraft { title: string; body: string; speakerNotes: string }
export type AiLayoutKind = "cover" | "title-body" | "split" | "cards" | "quote" | "section" | "summary";
export interface AiSlideDesign { layout: AiLayoutKind; background: string; accent: string; titleColor: string; bodyColor: string }

export type DocumentCommand =
  | { type: "add-slide" }
  | { type: "apply-ai-draft"; title: string; slides: AiSlideDraft[] }
  | { type: "apply-ai-designed-draft"; title: string; slides: AiSlideDraft[]; designs: AiSlideDesign[]; pageSize?: { width: Emu; height: Emu }; fontFamily?: string }
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
    case "apply-ai-designed-draft": return "both";
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
      slide.content = { title: draft.title, body: draft.body, speakerNotes: draft.speakerNotes, status: "approved" };
      const title = slide.elements[0];
      if (title?.type === "text") title.text = draft.title;
      if (draft.body.trim()) slide.elements.push({ id: crypto.randomUUID() as ElementId, type: "text", frame: { x: inches(0.9), y: inches(1.8), width: inches(10.8), height: inches(4.6) }, rotationMilliDegree: 0, locked: false, text: draft.body, style: { fontFamily: "Microsoft YaHei", fontSizePt: 20, color: "#262626", bold: false, align: "left" } });
      return slide;
    });
    return;
  }
  if (command.type === "apply-ai-designed-draft") {
    if (!command.title.trim() || command.slides.length < 1 || command.slides.length > 20 || command.designs.length !== command.slides.length) throw new Error("AI_DESIGN_INVALID");
    if (command.pageSize) document.pageSize = command.pageSize;
    const pageWidth = document.pageSize.width;
    const pageHeight = document.pageSize.height;
    const frame = (x: number, y: number, width: number, height: number): RectEmu => ({ x: Math.round(x * pageWidth) as Emu, y: Math.round(y * pageHeight) as Emu, width: Math.round(width * pageWidth) as Emu, height: Math.round(height * pageHeight) as Emu });
    const text = (value: string, box: RectEmu, fontSizePt: number, color: string, bold: boolean, align: "left" | "center" | "right") => ({ id: crypto.randomUUID() as ElementId, type: "text" as const, frame: box, rotationMilliDegree: 0, locked: false, text: value, style: { fontFamily: command.fontFamily || "Microsoft YaHei", fontSizePt, color, bold, align } });
    const shape = (box: RectEmu, fill: string, kind: "rectangle" | "ellipse" = "rectangle") => ({ id: crypto.randomUUID() as ElementId, type: "shape" as const, frame: box, rotationMilliDegree: 0, locked: false, shape: kind, style: { fill, stroke: fill, strokeWidthPt: 0, radiusPt: kind === "ellipse" ? 999 : 8 } });
    const points = (body: string) => body.split(/\n+|(?=\d+[.、]\s*)/).map((value) => value.trim()).filter(Boolean);
    document.title = command.title.trim();
    document.slides = command.slides.map((content, index) => {
      const design = command.designs[index]!;
      const slide = createSlide(index + 1);
      slide.background = design.background;
      slide.content = { ...content, status: "approved" };
      const items = points(content.body);
      const bodySize = content.body.length > 260 ? 15 : content.body.length > 150 ? 17 : 20;
      slide.elements = [];
      if (design.layout === "cover") {
        slide.elements.push(shape(frame(0, 0, 0.035, 1), design.accent), shape(frame(0.08, 0.70, 0.18, 0.018), design.accent));
        slide.elements.push(text(content.title, frame(0.10, 0.24, 0.78, 0.28), 42, design.titleColor, true, "left"));
        if (content.body.trim()) slide.elements.push(text(content.body, frame(0.10, 0.56, 0.72, 0.16), 19, design.bodyColor, false, "left"));
      } else if (design.layout === "section") {
        slide.elements.push(shape(frame(0, 0, 0.32, 1), design.accent));
        slide.elements.push(text(String(index + 1).padStart(2, "0"), frame(0.07, 0.17, 0.16, 0.18), 52, "#FFFFFF", true, "left"));
        slide.elements.push(text(content.title, frame(0.39, 0.30, 0.50, 0.22), 36, design.titleColor, true, "left"));
        if (content.body.trim()) slide.elements.push(text(content.body, frame(0.39, 0.56, 0.47, 0.20), 18, design.bodyColor, false, "left"));
      } else if (design.layout === "quote") {
        slide.elements.push(shape(frame(0.08, 0.16, 0.025, 0.68), design.accent));
        slide.elements.push(text(content.title, frame(0.15, 0.12, 0.72, 0.13), 28, design.titleColor, true, "left"));
        if (content.body.trim()) slide.elements.push(text(content.body, frame(0.15, 0.31, 0.68, 0.46), Math.max(18, bodySize), design.bodyColor, false, "left"));
      } else if (design.layout === "cards" && items.length > 1) {
        slide.elements.push(text(content.title, frame(0.07, 0.07, 0.82, 0.12), 29, design.titleColor, true, "left"), shape(frame(0.07, 0.22, 0.12, 0.012), design.accent));
        const visible = items.slice(0, 6); const columns = visible.length > 3 ? 3 : 2; const rows = Math.ceil(visible.length / columns);
        visible.forEach((item, itemIndex) => { const column = itemIndex % columns; const row = Math.floor(itemIndex / columns); const x = 0.07 + column * (0.86 / columns); const y = 0.28 + row * (0.60 / rows); slide.elements.push(shape(frame(x, y, 0.86 / columns - 0.025, 0.60 / rows - 0.035), "#F3F5F7"), shape(frame(x, y, 0.012, 0.60 / rows - 0.035), design.accent), text(item, frame(x + 0.025, y + 0.035, 0.86 / columns - 0.07, 0.60 / rows - 0.10), 16, design.bodyColor, false, "left")); });
      } else if (design.layout === "split" && items.length > 1) {
        slide.elements.push(text(content.title, frame(0.07, 0.07, 0.84, 0.13), 30, design.titleColor, true, "left"), shape(frame(0.50, 0.25, 0.012, 0.60), design.accent));
        const middle = Math.ceil(items.length / 2); slide.elements.push(text(items.slice(0, middle).join("\n\n"), frame(0.08, 0.28, 0.36, 0.54), bodySize, design.bodyColor, false, "left"), text(items.slice(middle).join("\n\n"), frame(0.57, 0.28, 0.35, 0.54), bodySize, design.bodyColor, false, "left"));
      } else {
        slide.elements.push(text(content.title, frame(0.07, 0.07, 0.84, 0.13), 30, design.titleColor, true, "left"), shape(frame(0.07, 0.22, 0.11, 0.012), design.accent));
        if (content.body.trim()) slide.elements.push(text(content.body, frame(0.08, 0.30, 0.82, 0.55), bodySize, design.bodyColor, false, "left"));
      }
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
