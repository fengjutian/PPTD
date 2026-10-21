import type { ElementId, Emu, PresentationDocument, SlideId } from "../document-model";
import { createSlide, inches } from "../document-model";

export type ChangeDomain = "content" | "design" | "both";

export type DocumentCommand =
  | { type: "add-slide" }
  | { type: "duplicate-slide"; slideId: SlideId }
  | { type: "delete-slide"; slideId: SlideId }
  | { type: "move-slide"; slideId: SlideId; toIndex: number }
  | { type: "set-slide"; slideId: SlideId }
  | { type: "add-shape"; slideId: SlideId; shape: "rectangle" | "ellipse" }
  | { type: "duplicate-element"; slideId: SlideId; elementId: ElementId }
  | { type: "delete-element"; slideId: SlideId; elementId: ElementId }
  | { type: "set-element-lock"; slideId: SlideId; elementId: ElementId; locked: boolean }
  | { type: "move-element"; slideId: SlideId; elementId: ElementId; x: Emu; y: Emu }
  | { type: "edit-text"; slideId: SlideId; elementId: ElementId; text: string };

export function commandDomain(command: DocumentCommand): ChangeDomain | null {
  switch (command.type) {
    case "set-slide": return null;
    case "edit-text": return "content";
    case "add-slide": return "both";
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
        : { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame }, style: { ...element.style } }),
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

  if (command.type === "add-shape") {
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "shape",
      shape: command.shape,
      frame: { x: inches(4), y: inches(2.4), width: inches(2.4), height: inches(1.4) },
      rotationMilliDegree: 0,
      locked: false,
      style: { fill: "#d8ff52", stroke: "#15171a", strokeWidthPt: 1.5, radiusPt: 12 },
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
      : { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame, x: (element.frame.x + offset) as Emu, y: (element.frame.y + offset) as Emu }, style: { ...element.style } };
    slide.elements.splice(sourceIndex + 1, 0, duplicate);
    return;
  }
  if (command.type === "delete-element") {
    slide.elements.splice(slide.elements.findIndex((item) => item.id === command.elementId), 1);
    return;
  }
  if (command.type === "move-element") element.frame = { ...element.frame, x: command.x, y: command.y };
  if (command.type === "edit-text") {
    if (element.type !== "text") throw new Error("ELEMENT_NOT_TEXT");
    element.text = command.text;
    slide.content.title = command.text;
    if (slide.content.status === "approved") slide.content.status = "changed";
  }
}
