import { describe, it } from "vitest";
import { createDocument, createSlide, inches, type TextElement } from "../../src/core/document-model";
import { auditDeckLayout } from "../../src/core/layout/deck-audit";

describe("scratch deck audit", () => {
  it("prints the samples", () => {
    const document = createDocument();
    console.log("pageSize", document.pageSize, "slides", document.slides.length);
    const slides = [0, 1, 2].map(() => {
      const slide = createSlide(2);
      const base = slide.elements[0]!;
      if (base.type !== "text") throw new Error("expected text");
      const title: TextElement = {
        ...base,
        id: crypto.randomUUID() as TextElement["id"],
        text: "标题",
        contentRef: "title",
        frame: { x: inches(0.9), y: inches(0.6), width: inches(6), height: inches(0.8) },
        style: { ...base.style, fontSizePt: 30 },
      };
      const footer: TextElement = {
        ...base,
        id: crypto.randomUUID() as TextElement["id"],
        text: "02 / 08",
        frame: { x: inches(6), y: inches(7.1), width: inches(1.2), height: inches(0.2) },
        style: { ...base.style, fontSizePt: 10 },
      };
      slide.elements = [title, footer];
      console.log(
        "slide elements",
        slide.elements.map((element) => `${element.type}:${(element as TextElement).contentRef ?? "-"}`),
      );
      return slide;
    });
    document.slides = slides;
    console.log("report", JSON.stringify(auditDeckLayout(document), null, 2));
  });
});
