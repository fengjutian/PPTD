import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand } from "./commands";
import { createDocument, emu, inches, type PresentationDocument, type TextElement } from "../document-model";
import { auditSlideLayout } from "../layout/layout-audit";

/** A page carrying one top-aligned text with the given copy. */
function pageWith(text: string, heightIn: number): { document: PresentationDocument; element: TextElement } {
  const document = createDocument();
  const base = document.slides[0]!.elements[0]!;
  if (base.type !== "text") throw new Error("expected a text element");
  const element: TextElement = {
    ...base,
    id: crypto.randomUUID() as TextElement["id"],
    text,
    frame: { x: inches(1), y: inches(1), width: inches(4), height: emu(heightIn * 914_400) },
    style: { ...base.style, fontSizePt: 18, lineHeight: 1.25 },
  };
  document.slides[0]!.elements = [element];
  return { document, element };
}

const LONG_COPY =
  "搜索与广告业务规模大、利润率高，是公司当前的现金牛，但增速持续放缓；云业务增速更快，营业利润率首次转正。";

describe("editing copy", () => {
  it("grows the box so the new copy fits, without touching the type size", () => {
    const { document, element: title } = pageWith("利润率行业领先", 0.5);
    const result = produce(document, (draft) =>
      applyCommand(draft, {
        type: "edit-text",
        slideId: draft.slides[0]!.id,
        elementId: title.id,
        text: LONG_COPY,
      }),
    );
    const edited = result.slides[0]!.elements[0]!;
    if (edited.type !== "text") throw new Error("expected a text element");
    expect(edited.text).toBe(LONG_COPY);
    expect(edited.style.fontSizePt).toBe(18);
    expect(edited.frame.height).toBeGreaterThan(emu(0.5 * 914_400));
    // The page the writer now sees has no overflow left to report.
    expect(auditSlideLayout(result).issues).toEqual([]);
  });

  it("leaves the frame alone when the new copy is still short", () => {
    const { document, element: title } = pageWith("利润率行业领先", 2);
    const result = produce(document, (draft) =>
      applyCommand(draft, {
        type: "edit-text",
        slideId: draft.slides[0]!.id,
        elementId: title.id,
        text: "持平",
      }),
    );
    expect(result.slides[0]!.elements[0]!.frame).toEqual(title.frame);
  });

  it("keeps an overflow that has no room to grow as a reported problem", () => {
    // A block right below the box leaves no space: the frame cannot grow, so the
    // audit still reports the overflow instead of the copy being cut silently.
    const { document, element: title } = pageWith("利润率行业领先", 0.5);
    document.slides[0]!.elements.push({
      ...title,
      id: crypto.randomUUID() as TextElement["id"],
      text: "下方说明",
      frame: { x: inches(1), y: inches(1.55), width: inches(4), height: inches(0.4) },
    });
    const result = produce(document, (draft) =>
      applyCommand(draft, {
        type: "edit-text",
        slideId: draft.slides[0]!.id,
        elementId: title.id,
        text: LONG_COPY,
      }),
    );
    expect(result.slides[0]!.elements[0]!.frame).toEqual(title.frame);
    expect(auditSlideLayout(result).issues.map((issue) => issue.kind)).toContain("text-overflow");
  });
});
