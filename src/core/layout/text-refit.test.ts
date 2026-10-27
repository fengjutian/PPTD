import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand } from "../commands/commands";
import {
  createDocument,
  createSlide,
  emu,
  inches,
  type Emu,
  type PresentationDocument,
  type RectEmu,
  type Slide,
  type TextElement,
} from "../document-model";
import { estimateTextLines } from "../rendering/text-fit";
import { auditSlideLayout } from "./layout-audit";
import { growFrameForText, refitSlideText } from "./text-refit";

const pageHeight = inches(7.5) as Emu;

/** A one-page document around a slide, so the audit can read it. */
function singleSlideDocument(slide: Slide): PresentationDocument {
  const document = createDocument();
  document.slides = [slide];
  return document;
}

function textPage(overrides: {
  text: string;
  frame: RectEmu;
  fontSizePt: number;
  lineHeight?: number;
  verticalAlign?: "top" | "middle" | "bottom";
  letterSpacingPt?: number;
  bold?: boolean;
}): { slide: Slide; element: TextElement } {
  const slide = createSlide(2);
  const base = slide.elements[0]!;
  if (base.type !== "text") throw new Error("expected the factory page to carry a text");
  const element: TextElement = {
    ...base,
    text: overrides.text,
    frame: overrides.frame,
    style: {
      ...base.style,
      fontSizePt: overrides.fontSizePt,
      ...(overrides.lineHeight === undefined ? {} : { lineHeight: overrides.lineHeight }),
      ...(overrides.verticalAlign === undefined ? {} : { verticalAlign: overrides.verticalAlign }),
      ...(overrides.letterSpacingPt === undefined ? {} : { letterSpacingPt: overrides.letterSpacingPt }),
      ...(overrides.bold === undefined ? {} : { bold: overrides.bold }),
    },
  };
  slide.elements = [element];
  return { slide, element };
}

/** The height a copy needs at its own size, measured the way the renderer does. */
function neededPt(element: TextElement): number {
  const lines = estimateTextLines(
    element.text,
    element.frame.width / 12_700,
    element.style.fontSizePt,
    element.style.fontFamily,
  );
  return lines * element.style.fontSizePt * (element.style.lineHeight ?? 1.25);
}

describe("text refit", () => {
  it("leaves a text that already fits untouched", () => {
    const { slide, element } = textPage({
      text: "利润率行业领先",
      frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.5) },
      fontSizePt: 18,
      lineHeight: 1.25,
    });
    const before = { frame: element.frame, size: element.style.fontSizePt };
    const report = refitSlideText(slide, pageHeight);
    expect(report.adjustments).toEqual([]);
    expect(report.conflicts).toEqual([]);
    expect(element.frame).toEqual(before.frame);
    expect(element.style.fontSizePt).toBe(before.size);
  });

  it("grows a short frame into the empty room below instead of shrinking the type", () => {
    const copy = "搜索与广告业务规模大、利润率高，是当前的现金牛，但增速持续放缓";
    const { slide, element } = textPage({
      text: copy,
      frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.3) },
      fontSizePt: 18,
      lineHeight: 1.25,
    });
    expect(neededPt(element)).toBeGreaterThan(element.frame.height / 12_700);
    const report = refitSlideText(slide, pageHeight);
    expect(report.adjustments.map((adjustment) => adjustment.kind)).toEqual(["grew-frame"]);
    expect(element.style.fontSizePt).toBe(18);
    expect(element.text).toBe(copy);
    expect(neededPt(element)).toBeLessThanOrEqual(element.frame.height / 12_700);
  });

  it("shrinks the type rather than letting the copy leave the card that backs it", () => {
    const slide = createSlide(2);
    const base = slide.elements[0]!;
    if (base.type !== "text") throw new Error("expected a text");
    const copy = "收入增速保持双位数";
    const frame: RectEmu = { x: inches(1), y: inches(1.2), width: inches(1.6), height: inches(0.5) };
    const element: TextElement = {
      ...base,
      text: copy,
      frame,
      style: { ...base.style, fontSizePt: 18, lineHeight: 1.25 },
    };
    // The card ends where the frame ends: there is no room to grow into.
    slide.elements = [
      {
        ...element,
        id: "card" as typeof element.id,
        type: "shape",
        shape: "rectangle",
        frame: { x: inches(0.9), y: inches(1), width: inches(1.8), height: inches(0.7) },
        style: { fill: "#F2F4F7", stroke: "#F2F4F7", strokeWidthPt: 0, radiusPt: 8 },
      } as (typeof slide.elements)[number],
      element,
    ];
    const report = refitSlideText(slide, pageHeight);
    expect(report.adjustments).toHaveLength(1);
    expect(report.adjustments[0]!.kind).toBe("shrank-type");
    expect(element.style.fontSizePt).toBeLessThan(18);
    expect(element.frame).toEqual(frame);
    expect(element.text).toBe(copy);
    expect(neededPt(element)).toBeLessThanOrEqual(element.frame.height / 12_700);
  });

  it("shrinks a vertically centred block instead of moving it", () => {
    const copy = "搜索与广告业务规模大、利润率高，是当前的现金牛，但增速持续放缓";
    const { slide, element } = textPage({
      text: copy,
      frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.3) },
      fontSizePt: 18,
      lineHeight: 1.25,
      verticalAlign: "middle",
    });
    const before = element.frame;
    const report = refitSlideText(slide, pageHeight);
    expect(report.adjustments.map((adjustment) => adjustment.kind)).toEqual(["shrank-type"]);
    expect(element.frame).toEqual(before);
  });

  it("counts the tracking the exported file will apply", () => {
    // Fifteen full-width glyphs at 20pt are exactly 300pt wide. The design gives
    // the title 1pt of tracking per glyph, so the file needs 315pt: the text
    // wraps where the untracked measure said it fit, and the refit has to see
    // that before PowerPoint does.
    const copy = "一二三四五六七八九十一二三四五";
    const frame: RectEmu = {
      x: inches(1),
      y: inches(1),
      width: emu(300 * 12_700),
      height: emu(Math.round(20 * 1.25 * 12_700)),
    };
    // Centred, so the refit cannot grow the frame and only the type can give way.
    const plain = textPage({ text: copy, frame, fontSizePt: 20, lineHeight: 1.25, verticalAlign: "middle" });
    expect(refitSlideText(plain.slide, pageHeight).adjustments).toEqual([]);

    const tracked = textPage({
      text: copy,
      frame,
      fontSizePt: 20,
      lineHeight: 1.25,
      verticalAlign: "middle",
      letterSpacingPt: 1,
    });
    const report = refitSlideText(tracked.slide, pageHeight);
    expect(report.adjustments.map((adjustment) => adjustment.kind)).toEqual(["shrank-type"]);
    expect(tracked.element.style.fontSizePt).toBeLessThan(20);
    // The copy is untouched; only the size gives way.
    expect(tracked.element.text).toBe(copy);
  });

  it("reports a page whose copy cannot fit even at the floor", () => {
    const slide = createSlide(2);
    const base = slide.elements[0]!;
    if (base.type !== "text") throw new Error("expected a text");
    const element: TextElement = {
      ...base,
      text: "搜索与广告业务规模大、利润率高，是当前的现金牛，但增速持续放缓，且仍在继续下滑",
      frame: { x: inches(1), y: inches(1), width: inches(1.2), height: inches(0.2) },
      style: { ...base.style, fontSizePt: 18, lineHeight: 1.25 },
    };
    // A rule sits right under the frame, so the refit cannot grow into it.
    slide.elements = [
      element,
      {
        ...element,
        id: "rule" as typeof element.id,
        type: "shape",
        shape: "rectangle",
        frame: { x: inches(1), y: inches(1.2), width: inches(1.2), height: inches(0.01) },
        style: { fill: "#1F4E79", stroke: "#1F4E79", strokeWidthPt: 0, radiusPt: 0 },
      } as (typeof slide.elements)[number],
    ];
    const report = refitSlideText(slide, pageHeight);
    expect(report.conflicts).toHaveLength(1);
    // The copy is never rewritten and the size stops at the readable floor.
    expect(element.text).toContain("现金牛");
    expect(element.style.fontSizePt).toBeGreaterThanOrEqual(12);
    expect(report.conflicts[0]!.neededPt).toBeGreaterThan(report.conflicts[0]!.availablePt);
  });

  it("leaves a template placeholder alone even when its copy overflows", () => {
    // A template page's frames are the uploaded layout; the refit must not
    // rewrite them, and the audit reports the overflow instead.
    const copy = "搜索与广告业务规模大、利润率高，是当前的现金牛，但增速持续放缓";
    const { slide, element } = textPage({
      text: copy,
      frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.3) },
      fontSizePt: 18,
    });
    slide.layoutId = "layout-1";
    const before = { frame: element.frame, size: element.style.fontSizePt };
    const report = refitSlideText(slide, pageHeight);
    expect(report.adjustments).toEqual([]);
    expect(element.frame).toEqual(before.frame);
    expect(element.style.fontSizePt).toBe(before.size);
  });

  it("is deterministic", () => {
    const copy = "搜索与广告业务规模大、利润率高，是当前的现金牛，但增速持续放缓";
    const first = textPage({
      text: copy,
      frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.3) },
      fontSizePt: 18,
    });
    const second = textPage({
      text: copy,
      frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.3) },
      fontSizePt: 18,
    });
    refitSlideText(first.slide, pageHeight);
    refitSlideText(second.slide, pageHeight);
    // The element ids are generated per page, so the comparison is geometry.
    expect(first.element.frame).toEqual(second.element.frame);
    expect(first.element.style.fontSizePt).toBe(second.element.style.fontSizePt);
  });
});

describe("growing a frame after an edit", () => {
  it("makes the box tall enough for the new copy and keeps the type size", () => {
    const { slide, element } = textPage({
      text: "利润率行业领先。搜索与广告业务规模大、利润率高，是公司当前的现金牛，但增速持续放缓；云业务增速更快但利润率仍低。",
      frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.5) },
      fontSizePt: 18,
      lineHeight: 1.25,
    });
    const size = element.style.fontSizePt;
    const before = element.frame.height;
    const adjustment = growFrameForText(slide, element, pageHeight);
    expect(adjustment?.kind).toBe("grew-frame");
    expect(element.frame.height).toBeGreaterThan(before);
    expect(element.style.fontSizePt).toBe(size);
    // The grown frame is enough: the audit has nothing left to report.
    expect(auditSlideLayout(singleSlideDocument(slide)).issues).toEqual([]);
  });

  it("stops when something sits right below the text", () => {
    const { slide, element } = textPage({
      text: "利润率行业领先。搜索与广告业务规模大、利润率高，是公司当前的现金牛，但增速持续放缓。",
      frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.5) },
      fontSizePt: 18,
      lineHeight: 1.25,
    });
    slide.elements.push({
      ...element,
      id: crypto.randomUUID() as TextElement["id"],
      text: "图表标题",
      frame: { x: inches(1), y: inches(1.55), width: inches(4), height: inches(0.4) },
    });
    const before = element.frame;
    expect(growFrameForText(slide, element, pageHeight)).toBeUndefined();
    expect(element.frame).toEqual(before);
  });

  it("leaves a vertically centred block alone", () => {
    const { slide, element } = textPage({
      text: "利润率行业领先。搜索与广告业务规模大、利润率高，是公司当前的现金牛，但增速持续放缓。",
      frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.5) },
      fontSizePt: 18,
      lineHeight: 1.25,
      verticalAlign: "middle",
    });
    const before = element.frame;
    expect(growFrameForText(slide, element, pageHeight)).toBeUndefined();
    expect(element.frame).toEqual(before);
  });

  it("does not touch a page that follows a template", () => {
    const { slide, element } = textPage({
      text: "利润率行业领先。搜索与广告业务规模大、利润率高，是公司当前的现金牛。",
      frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.5) },
      fontSizePt: 18,
      lineHeight: 1.25,
    });
    slide.layoutId = "layout-1";
    const before = element.frame;
    expect(growFrameForText(slide, element, pageHeight)).toBeUndefined();
    expect(element.frame).toEqual(before);
  });
});

describe("designed pages carry copy that fits", () => {
  it("leaves no text overflowing after an AI-designed draft", () => {
    const content = (title: string, body: string) => ({
      title,
      body,
      speakerNotes: "",
      blocks: [
        {
          type: "bullet-list" as const,
          items: [
            "搜索与广告业务规模大、利润率高，是 Alphabet 当前的现金牛，但增速持续放缓",
            "Google Cloud 增速保持双位数、营业利润率首次转正",
            "生成式 AI 已经同时进入搜索、办公与企业云三条产品主线",
          ],
        },
      ],
    });
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#1F4E79",
      titleColor: "#12233D",
      bodyColor: "#465368",
    };
    const source = createDocument();
    const document: PresentationDocument = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "装得下",
        slides: [content("云业务首次实现年度盈利，标志第二增长曲线进入兑现期", "正文"), content("三条产品线", "正文")],
        designs: [design, { ...design, layout: "title-body" }],
      }),
    );
    const overflow = auditSlideLayout(document).issues.filter((issue) => issue.kind === "text-overflow");
    expect(overflow).toEqual([]);
  });
});
