import { describe, expect, it } from "vitest";
import {
  createDocument,
  createSlide,
  inches,
  type PresentationDocument,
  type Slide,
  type TextElement,
} from "../document-model";
import { auditDeckLayout } from "./deck-audit";

/**
 * A page with one title-sized text and one footer-sized text.
 *
 * The factory page carries a title, so the footer is built from the same style
 * without that binding: a page number is not a second heading.
 */
function page(titleX: number, footerY: number, options: { centered?: boolean; template?: string } = {}): Slide {
  const slide = createSlide(2);
  const base = slide.elements[0]!;
  if (base.type !== "text") throw new Error("expected the factory page to carry a text");
  const { contentRef: _titleRef, ...bare } = base;
  const title: TextElement = {
    ...base,
    id: crypto.randomUUID() as TextElement["id"],
    text: "标题",
    contentRef: "title",
    frame: { x: inches(titleX), y: inches(0.6), width: inches(6), height: inches(0.8) },
    style: {
      ...base.style,
      fontSizePt: 30,
      ...(options.centered ? { align: "center" as const } : {}),
    },
  };
  const footer: TextElement = {
    ...bare,
    id: crypto.randomUUID() as TextElement["id"],
    text: "02 / 08",
    frame: { x: inches(6), y: inches(footerY), width: inches(1.2), height: inches(0.2) },
    style: { ...bare.style, fontSizePt: 10 },
  };
  slide.elements = [title, footer];
  if (options.template) slide.layoutId = options.template;
  return slide;
}

function deck(slides: Slide[]): PresentationDocument {
  const document = createDocument();
  document.slides = slides;
  return document;
}

describe("deck layout audit", () => {
  it("accepts a deck whose titles and footers share an axis", () => {
    const report = auditDeckLayout(deck([page(0.9, 7.1), page(0.9, 7.1), page(0.9, 7.1)]));
    expect(report.issues).toEqual([]);
  });

  it("reports one page whose title left the axis", () => {
    const report = auditDeckLayout(deck([page(0.9, 7.1), page(0.9, 7.1), page(1.4, 7.1), page(0.9, 7.1)]));
    expect(report.issues.map((issue) => issue.kind)).toEqual(["title-axis-drift"]);
    expect(report.issues[0]!.slideIndex).toBe(2);
    expect(report.issues[0]!.message).toContain("第 3 页");
  });

  it("reports a footer that dropped below the others", () => {
    const report = auditDeckLayout(deck([page(0.9, 7.1), page(0.9, 7.25), page(0.9, 7.1), page(0.9, 7.1)]));
    expect(report.issues.map((issue) => issue.kind)).toEqual(["footer-drift"]);
    expect(report.issues[0]!.slideIndex).toBe(1);
  });

  it("leaves a centred statement title out of the comparison", () => {
    // A pull quote sets its heading on the centre axis on purpose.
    const report = auditDeckLayout(deck([page(0.9, 7.1), page(0.9, 7.1), page(2.4, 7.1, { centered: true })]));
    expect(report.issues).toEqual([]);
  });

  it("does not compare a cover band with the body band", () => {
    // A cover title is set in a narrower band at another x; it is its own band.
    const cover = page(2.4, 7.1);
    const coverTitle = cover.elements[0]!;
    if (coverTitle.type !== "text") throw new Error("expected a text");
    coverTitle.frame = { ...coverTitle.frame, width: inches(5) };
    const report = auditDeckLayout(deck([page(0.9, 7.1), page(0.9, 7.1), page(0.9, 7.1), page(0.9, 7.1), cover]));
    expect(report.issues).toEqual([]);
  });

  it("ignores pages bound to a template layout", () => {
    const report = auditDeckLayout(
      deck([page(0.9, 7.1), page(0.9, 7.1), page(0.9, 7.1), page(2.4, 7.4, { template: "layout-1" })]),
    );
    expect(report.issues).toEqual([]);
  });

  it("needs a few pages before it calls anything drift", () => {
    const report = auditDeckLayout(deck([page(0.9, 7.1), page(2.4, 7.4)]));
    expect(report.issues).toEqual([]);
  });
});
