import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { createDocument, inches, type PresentationDocument } from "../document-model";

/**
 * 线条元素与整组复制。
 *
 * 这两条命令都碰文档结构：线条是新的元素类型，复制是新的批量命令。它们
 * 的共同要求是"一次意图一个撤销项"和"不静默改内容"。
 */
describe("line element", () => {
  it("adds a line as a design change", () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    const next = produce(document, (draft) => {
      applyCommand(draft, { type: "add-line", slideId, direction: "horizontal" });
    });
    const line = next.slides[0]!.elements.at(-1)!;
    expect(line.type).toBe("line");
    expect(line.type === "line" && line.direction).toBe("horizontal");
    expect(commandDomain({ type: "add-line", slideId, direction: "horizontal" }, next)).toBe("design");
  });

  it("gives a diagonal line an arrow head", () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    const next = produce(document, (draft) => {
      applyCommand(draft, { type: "add-line", slideId, direction: "diagonal" });
    });
    const line = next.slides[0]!.elements.at(-1)!;
    expect(line.type === "line" && line.style.endArrow).toBe("arrow");
  });

  it("changes the line style without touching the reviewed content", () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    const withLine = produce(document, (draft) => {
      applyCommand(draft, { type: "add-line", slideId, direction: "horizontal" });
    });
    const line = withLine.slides[0]!.elements.at(-1)!;
    const hashBefore = withLine.slides[0]!.content.contentHash;
    const next = produce(withLine, (draft) => {
      applyCommand(
        draft,
        { type: "set-line-style", slideId, elementId: line.id, style: { stroke: "#3366CC", dashed: true, endArrow: "arrow" } },
      );
    });
    const styled = next.slides[0]!.elements.at(-1)!;
    expect(styled.type === "line" && styled.style.stroke).toBe("#3366CC");
    expect(styled.type === "line" && styled.style.dashed).toBe(true);
    expect(styled.type === "line" && styled.style.endArrow).toBe("arrow");
    // 线条是纯设计对象，动了它，已审核内容不能变。
    expect(next.slides[0]!.content.contentHash).toBe(hashBefore);
  });

  it("rejects a style the exporter could not round-trip", () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    const withLine = produce(document, (draft) => {
      applyCommand(draft, { type: "add-line", slideId, direction: "horizontal" });
    });
    const line = withLine.slides[0]!.elements.at(-1)!;
    expect(() =>
      produce(withLine, (draft) => {
        applyCommand(draft, { type: "set-line-style", slideId, elementId: line.id, style: { stroke: "not-a-color" } });
      }),
    ).toThrow();
  });

  it("swaps the frame extents and keeps the center when an axis line turns vertical", () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    const withLine = produce(document, (draft) => {
      applyCommand(draft, { type: "add-line", slideId, direction: "horizontal" });
    });
    const line = withLine.slides[0]!.elements.at(-1)!;
    if (line.type !== "line") throw new Error("expected a line");
    const center = { x: line.frame.x + line.frame.width / 2, y: line.frame.y + line.frame.height / 2 };
    const before = { ...line.frame };

    const next = produce(withLine, (draft) => {
      applyCommand(draft, { type: "set-line-direction", slideId, elementId: line.id, direction: "vertical" });
    });
    const vertical = next.slides[0]!.elements.at(-1)!;
    if (vertical.type !== "line") throw new Error("expected a line");
    // 只改 direction 不换宽高，竖线的框仍然是很宽的横框，画出来只有一个点。
    expect(vertical.frame.width).toBe(before.height);
    expect(vertical.frame.height).toBe(before.width);
    expect(vertical.frame.x + vertical.frame.width / 2).toBeCloseTo(center.x, 0);
    expect(vertical.frame.y + vertical.frame.height / 2).toBeCloseTo(center.y, 0);
  });
});

describe("duplicate a group of elements", () => {
  function withThreeElements(): PresentationDocument {
    const document = createDocument();
    const slide = document.slides[0]!;
    for (let index = 0; index < 2; index += 1) {
      slide.elements.push({
        id: crypto.randomUUID() as never,
        type: "shape",
        shape: "rectangle",
        frame: { x: inches(1 + index), y: inches(1), width: inches(1), height: inches(1) },
        rotationMilliDegree: 0,
        locked: false,
        origin: "user",
        style: { fill: "#ffffff", stroke: "#000000", strokeWidthPt: 1, radiusPt: 0 },
      });
    }
    return document;
  }

  it("copies every selected element and keeps their order", () => {
    const document = withThreeElements();
    const slideId = document.slides[0]!.id;
    const sourceIds = document.slides[0]!.elements.slice(1).map((element) => element.id);
    const next = produce(document, (draft) => {
      applyCommand(draft, { type: "duplicate-elements", slideId, elementIds: sourceIds });
    });
    expect(next.slides[0]!.elements).toHaveLength(5);
    const copies = next.slides[0]!.elements.slice(3);
    expect(copies.map((element) => element.type)).toEqual(["shape", "shape"]);
    // 副本比原件往后挪一点，一眼能看出是新的一份。
    expect(copies[0]!.frame.x).toBe(document.slides[0]!.elements[1]!.frame.x + inches(0.2));
    expect(copies[1]!.frame.x).toBe(document.slides[0]!.elements[2]!.frame.x + inches(0.2));
  });

  it("treats the copy as one design transaction", () => {
    const document = withThreeElements();
    const slideId = document.slides[0]!.id;
    const sourceIds = document.slides[0]!.elements.slice(1).map((element) => element.id);
    expect(commandDomain({ type: "duplicate-elements", slideId, elementIds: sourceIds }, document)).toBe("design");
  });

  it("does not copy a locked element", () => {
    const document = withThreeElements();
    const slide = document.slides[0]!;
    slide.elements[1]!.locked = true;
    const sourceIds = slide.elements.slice(1).map((element) => element.id);
    const next = produce(document, (draft) => {
      applyCommand(draft, { type: "duplicate-elements", slideId: slide.id, elementIds: sourceIds });
    });
    expect(next.slides[0]!.elements).toHaveLength(4);
  });

  it("turns a copied title into decorative text so the page keeps one title", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const titleId = slide.elements[0]!.id;
    const next = produce(document, (draft) => {
      applyCommand(draft, { type: "duplicate-elements", slideId: slide.id, elementIds: [titleId] });
    });
    const copy = next.slides[0]!.elements.at(-1)!;
    expect(copy.type === "text" && copy.contentRef).toBe("decorative");
  });
});
