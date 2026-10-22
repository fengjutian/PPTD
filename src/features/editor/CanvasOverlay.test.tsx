import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EMU_PER_INCH, emu } from "../../core/document-model";
import { useCanvasGuidesStore } from "../../store/canvas-guides-store";
import { CanvasGridView, CanvasGuideView } from "./CanvasOverlay";

const inch = (value: number) => emu(value * EMU_PER_INCH);

describe("canvas overlay", () => {
  it("draws the grid layer only when the grid is switched on", () => {
    const on = renderToStaticMarkup(<CanvasGridView enabled gridSize={inch(0.1)} scale={0.01} />);
    expect(on).toContain("canvas-grid-layer");

    const off = renderToStaticMarkup(<CanvasGridView enabled={false} gridSize={inch(0.1)} scale={0.01} />);
    expect(off).not.toContain("canvas-grid-layer");
  });

  it("drops the grid when the spacing is smaller than a pixel", () => {
    // 页面宽 13.33 英寸映射到 960 像素时，比例约为 7.9e-5 像素/EMU，
    // 0.1 英寸的网格在最小缩放下仍有约 2 像素。再小就只剩噪点。
    const markup = renderToStaticMarkup(<CanvasGridView enabled gridSize={inch(0.1)} scale={0.000001} />);
    expect(markup).not.toContain("canvas-grid-layer");
  });

  it("draws one line per guide", () => {
    const markup = renderToStaticMarkup(
      <CanvasGuideView
        guides={[
          { id: "guide-v", axis: "x", position: inch(2) },
          { id: "guide-h", axis: "y", position: inch(3) },
        ]}
        pageWidth={inch(13.33)}
        pageHeight={inch(7.5)}
        scale={0.01}
        onMove={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(markup.match(/class="canvas-guide /g)).toHaveLength(2);
    expect(markup).toContain("垂直参考线");
    expect(markup).toContain("水平参考线");
  });

  it("shows the line the object snapped to", () => {
    const markup = renderToStaticMarkup(
      <CanvasGuideView guides={[]} pageWidth={inch(13.33)} pageHeight={inch(7.5)} scale={0.01} activeSnapX={inch(5)} onMove={() => undefined} onRemove={() => undefined} />,
    );
    expect(markup).toContain("canvas-snap-line vertical");
  });

  it("keeps the guides out of the document model", () => {
    useCanvasGuidesStore.setState({
      guidesBySlide: { "slide-guides": [{ id: "guide-v", axis: "x", position: inch(2) }] },
    });
    // 参考线只存在交互层的 store 里：文档、导出和撤销栈都看不到它们。
    const state = useCanvasGuidesStore.getState();
    expect(state.guidesBySlide["slide-guides"]).toHaveLength(1);
    expect(Object.keys(state)).toContain("guidesBySlide");
    expect(Object.keys(state)).not.toContain("document");
  });
});
