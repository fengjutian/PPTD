import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { createDocument, inches, type ChartElement, type SlideElement, type TextElement } from "../document-model";

function textElement(document = createDocument()): TextElement {
  const element = document.slides[0]!.elements[0]!;
  if (element.type !== "text") throw new Error("expected a text element");
  return element;
}

describe("clipboard paste command", () => {
  it("pastes a snapshot with fresh ids and one diagonal offset", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const snapshot = structuredClone(textElement(source));
    // The clipboard must survive deleting the object it came from.
    applyCommand(source, { type: "delete-element", slideId: slide.id, elementId: snapshot.id });
    const contentHash = slide.content.contentHash;

    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "paste-elements", slideId: slide.id, elements: [snapshot] }),
    );
    const pasted = result.slides[0]!.elements.find((element) => element.id !== snapshot.id)!;
    expect(pasted.id).not.toBe(snapshot.id);
    expect(pasted.frame.x).toBe((snapshot.frame.x + inches(0.2)) as never);
    expect(pasted.frame.y).toBe((snapshot.frame.y + inches(0.2)) as never);
    expect(pasted.locked).toBe(false);
    expect(pasted.origin).toBe("user");
    expect(result.slides[0]!.content.contentHash).toBe(contentHash);
    if (pasted.type === "text") {
      // A pasted card is user copy, not another view of the reviewed block.
      expect(pasted.text).toBe(snapshot.text);
      expect(pasted.contentRef).toBe("decorative");
    }
  });

  it("offsets each paste by the requested amount and keeps the existing z-order", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const snapshot = structuredClone(textElement(source));
    const original = slide.elements[0]!;

    const first = produce(source, (draft) =>
      applyCommand(draft, { type: "paste-elements", slideId: slide.id, elements: [snapshot], offsetEmu: inches(0.4) }),
    );
    expect(first.slides[0]!.elements).toHaveLength(2);
    expect(first.slides[0]!.elements[0]!.id).toBe(original.id);

    const second = produce(first, (draft) =>
      applyCommand(draft, {
        type: "paste-elements",
        slideId: slide.id,
        elements: [snapshot],
        offsetEmu: inches(0.8),
      }),
    );
    expect(second.slides[0]!.elements).toHaveLength(3);
    const last = second.slides[0]!.elements.at(-1)!;
    expect(last.frame.x).toBe((snapshot.frame.x + inches(0.8)) as never);
    expect(commandDomain({ type: "paste-elements", slideId: slide.id, elements: [] })).toBe("design");
  });

  it("refuses a table or chart on a page that does not carry its content block", () => {
    const source = createDocument();
    applyCommand(source, { type: "add-slide" });
    const targetSlide = source.slides[1]!;
    const chart: ChartElement = {
      id: crypto.randomUUID() as never,
      type: "chart",
      contentBlockIds: [crypto.randomUUID()],
      kind: "bar",
      frame: { x: 0 as never, y: 0 as never, width: inches(2), height: inches(2) },
      rotationMilliDegree: 0,
      locked: false,
      origin: "user",
      style: {
        fontFamily: "Microsoft YaHei",
        fontSizePt: 12,
        textColor: "#17181c",
        seriesColors: ["#3366CC"],
        showLegend: false,
        showValueLabels: true,
      },
    };

    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, { type: "paste-elements", slideId: targetSlide.id, elements: [chart] }),
      ),
    ).toThrow("PASTE_REQUIRES_CONTENT_BLOCK");
  });

  it("accepts the same chart on the page that owns its metric block", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const block = { id: crypto.randomUUID(), type: "metric" as const, label: "收入", value: "38万" };
    slide.content.blocks = [block];
    const chart: SlideElement = {
      id: crypto.randomUUID() as never,
      type: "chart",
      contentBlockIds: [block.id],
      kind: "bar",
      frame: { x: 0 as never, y: 0 as never, width: inches(2), height: inches(2) },
      rotationMilliDegree: 0,
      locked: false,
      origin: "user",
      style: {
        fontFamily: "Microsoft YaHei",
        fontSizePt: 12,
        textColor: "#17181c",
        seriesColors: ["#3366CC"],
        showLegend: false,
        showValueLabels: true,
      },
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "paste-elements", slideId: slide.id, elements: [chart], offsetEmu: inches(0.2) }),
    );
    expect(result.slides[0]!.elements).toHaveLength(2);
    expect(result.slides[0]!.elements[1]!.type).toBe("chart");
  });

  it("rejects an empty clipboard and an absurd offset", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    expect(() =>
      produce(source, (draft) => applyCommand(draft, { type: "paste-elements", slideId: slide.id, elements: [] })),
    ).toThrow("PASTE_ELEMENTS_INVALID");
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "paste-elements",
          slideId: slide.id,
          elements: [structuredClone(textElement(source))],
          offsetEmu: inches(20),
        }),
      ),
    ).toThrow("PASTE_ELEMENTS_INVALID");
  });
});
