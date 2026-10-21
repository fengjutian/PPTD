import type { ElementId, Emu, PresentationDocument, SlideId } from "../document-model";
import { createSlide, inches } from "../document-model";

export type ChangeDomain = "content" | "design" | "both";

export type DocumentCommand =
  | { type: "add-slide" }
  | { type: "set-slide"; slideId: SlideId }
  | { type: "add-shape"; slideId: SlideId; shape: "rectangle" | "ellipse" }
  | { type: "move-element"; slideId: SlideId; elementId: ElementId; x: Emu; y: Emu }
  | { type: "edit-text"; slideId: SlideId; elementId: ElementId; text: string };

export function commandDomain(command: DocumentCommand): ChangeDomain | null {
  switch (command.type) {
    case "set-slide": return null;
    case "edit-text": return "content";
    case "add-slide": return "both";
    default: return "design";
  }
}

export function applyCommand(document: PresentationDocument, command: DocumentCommand): void {
  if (command.type === "set-slide") return;
  if (command.type === "add-slide") {
    document.slides.push(createSlide(document.slides.length + 1));
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
  if (element.locked) throw new Error("ELEMENT_LOCKED");
  if (command.type === "move-element") element.frame = { ...element.frame, x: command.x, y: command.y };
  if (command.type === "edit-text") {
    if (element.type !== "text") throw new Error("ELEMENT_NOT_TEXT");
    element.text = command.text;
    slide.content.title = command.text;
    if (slide.content.status === "approved") slide.content.status = "changed";
  }
}
