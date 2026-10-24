import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import type { CompositionFacts } from "./design-intent";
import { createDocument } from "../document-model";
import {
  defaultDocumentaryConcept,
  defaultEditorialConcept,
  resolveDeckConcept,
  type AiDeckConcept,
} from "../design/deck-concept";

/**
 * The direction has to reach the command layer, not just the resolver. A
 * documentary deck may give a content page a hero picture; an editorial deck
 * keeps the picture out of the copy.
 */

const content = {
  title: "门店效率的三个判断",
  body: "本季度门店效率提升主要来自陈列调整与预约制，复购率连续三个月上升。",
  speakerNotes: "",
};

const facts = (bodyLength: number): CompositionFacts => ({
  itemCount: 2,
  shortItems: true,
  longestItemLength: 16,
  bodyLength,
  hasQuote: false,
  hasComparison: false,
  hasRowBlock: false,
  layout: "title-body",
});

function conceptFor(source: AiDeckConcept) {
  return resolveDeckConcept({
    concept: source,
    pageFacts: [facts(content.body.length)],
    pageCount: 1,
    id: "concept-imagery",
  }).concept;
}

function documentFor(conceptSource: AiDeckConcept) {
  const document = createDocument();
  applyCommand(document, {
    type: "apply-ai-designed-draft",
    title: "配图方向",
    slides: [content],
    designs: [
      {
        layout: "title-body",
        background: "#FFFFFF",
        accent: "#0F7869",
        titleColor: "#1E3550",
        bodyColor: "#5F6B76",
        visualAsset: { enabled: true, role: "hero" },
      },
    ],
    designConcept: conceptFor(conceptSource),
    visualAssets: [
      {
        slideIndex: 0,
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        mimeType: "image/png",
        naturalWidth: 1024,
        naturalHeight: 768,
        altText: "门店现场",
      },
    ],
  });
  return document;
}

describe("concept imagery", () => {
  it("lets a documentary direction put a hero picture on a content page", () => {
    const document = documentFor(defaultDocumentaryConcept());
    const images = document.slides[0]!.elements.filter(
      (element) => element.type === "image" && element.placement === "content",
    );
    expect(images).toHaveLength(1);
    expect(images[0]!.frame.width / document.pageSize.width).toBeGreaterThan(0.4);
    // The picture moves the copy; it never replaces it.
    expect(document.slides[0]!.content).toEqual({ ...content, status: "approved" });
  });

  it("keeps a hero request out of an editorial content page", () => {
    const document = documentFor(defaultEditorialConcept());
    const images = document.slides[0]!.elements.filter(
      (element) => element.type === "image" && element.placement === "content",
    );
    expect(images).toHaveLength(0);
    expect(document.slides[0]!.content.title).toBe(content.title);
  });
});
