import { describe, expect, it } from "vitest";
import { createDocument, inches, type PresentationDocument, type RectEmu, type TextElement } from "../document-model";
import { auditSlideLayout } from "./layout-audit";

/** A text element with the geometry and copy the case needs. */
function text(overrides: {
  text: string;
  frame: RectEmu;
  fontSizePt: number;
  lineHeight?: number;
  hidden?: boolean;
}): TextElement {
  const document = createDocument();
  const base = document.slides[0]!.elements[0]!;
  if (base.type !== "text") throw new Error("expected the default page to carry a text");
  const { frame, fontSizePt, lineHeight, text: copy } = overrides;
  return {
    ...base,
    text: copy,
    frame,
    ...(overrides.hidden ? { hidden: true } : {}),
    style: {
      ...base.style,
      fontSizePt,
      ...(lineHeight === undefined ? {} : { lineHeight }),
    },
  };
}

function page(elements: TextElement[]): PresentationDocument {
  const document = createDocument();
  document.slides[0]!.elements = elements;
  return document;
}

describe("layout audit", () => {
  it("reports a text whose measured height exceeds its frame", () => {
    // Nineteen full-width characters at 18pt need two lines; the frame holds one.
    const report = auditSlideLayout(
      page([
        text({
          text: "搜索与广告业务规模大利润率高是当前的现金牛",
          frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.3) },
          fontSizePt: 18,
          lineHeight: 1.25,
        }),
      ]),
    );
    expect(report.issues.map((issue) => issue.kind)).toEqual(["text-overflow"]);
    expect(report.issues[0]!.slideIndex).toBe(0);
  });

  it("accepts a text that fits its frame", () => {
    const report = auditSlideLayout(
      page([
        text({
          text: "利润率行业领先",
          frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.4) },
          fontSizePt: 18,
          lineHeight: 1.25,
        }),
      ]),
    );
    expect(report.issues).toEqual([]);
  });

  it("reports an object that leaves the page", () => {
    const report = auditSlideLayout(
      page([
        text({
          text: "标题",
          frame: { x: inches(12), y: inches(7), width: inches(4), height: inches(1) },
          fontSizePt: 18,
        }),
      ]),
    );
    expect(report.issues.map((issue) => issue.kind)).toContain("out-of-bounds");
  });

  it("reports two texts that claim the same space", () => {
    const frame: RectEmu = { x: inches(1), y: inches(1), width: inches(3), height: inches(0.5) };
    const report = auditSlideLayout(
      page([
        text({ text: "第一段", frame, fontSizePt: 18 }),
        text({ text: "第二段", frame, fontSizePt: 18 }),
      ]),
    );
    expect(report.issues.map((issue) => issue.kind)).toContain("text-overlap");
    expect(report.issues.find((issue) => issue.kind === "text-overlap")!.elementIds).toHaveLength(2);
  });

  it("does not judge an object the editor hid", () => {
    const report = auditSlideLayout(
      page([
        text({
          text: "搜索与广告业务规模大利润率高是当前的现金牛",
          frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.3) },
          fontSizePt: 18,
          lineHeight: 1.25,
          hidden: true,
        }),
      ]),
    );
    expect(report.issues).toEqual([]);
  });
});
