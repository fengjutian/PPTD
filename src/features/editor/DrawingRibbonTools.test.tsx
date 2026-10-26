import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { renderToStaticMarkup } from "react-dom/server";

import { applyCommand } from "../../core/commands";
import { createDocument, type SlideElement, type SlideId } from "../../core/document-model";
import { DrawingRibbonTools } from "./DrawingRibbonTools";

function shapes(): { slideId: SlideId; elements: SlideElement[] } {
  const source = createDocument();
  const slideId = source.slides[0]!.id;
  const document = produce(source, (draft) => {
    applyCommand(draft, { type: "add-shape", slideId, shape: "rectangle" });
    applyCommand(draft, { type: "add-shape", slideId, shape: "ellipse" });
  });
  return { slideId, elements: document.slides[0]!.elements.filter((element) => element.type === "shape") };
}

function inputTag(markup: string, label: string): string {
  return markup.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";
}

describe("drawing ribbon tools", () => {
  it("disables fill and outline without an editable shape", () => {
    const { slideId } = shapes();
    const markup = renderToStaticMarkup(
      <DrawingRibbonTools
        slideId={slideId}
        selected={[]}
        onCommand={() => undefined}
        onOpenArrange={() => undefined}
      />,
    );
    expect(inputTag(markup, "形状填充")).toContain("disabled");
    expect(inputTag(markup, "形状轮廓")).toContain("disabled");
    expect(markup).toContain("排列");
  });

  it("enables fill and outline for an unlocked shape", () => {
    const { slideId, elements } = shapes();
    const markup = renderToStaticMarkup(
      <DrawingRibbonTools
        slideId={slideId}
        selected={elements}
        onCommand={() => undefined}
        onOpenArrange={() => undefined}
      />,
    );
    expect(inputTag(markup, "形状填充")).not.toContain("disabled");
    expect(inputTag(markup, "形状轮廓")).not.toContain("disabled");
  });

  it("does not expose styling for a locked shape", () => {
    const { slideId, elements } = shapes();
    const locked = elements.map((element) => ({ ...element, locked: true }));
    const markup = renderToStaticMarkup(
      <DrawingRibbonTools
        slideId={slideId}
        selected={locked}
        onCommand={() => undefined}
        onOpenArrange={() => undefined}
      />,
    );
    expect(inputTag(markup, "形状填充")).toContain("disabled");
    expect(inputTag(markup, "形状轮廓")).toContain("disabled");
  });
});
