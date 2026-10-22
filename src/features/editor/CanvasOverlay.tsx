import { memo, useRef } from "react";
import { emu, type Emu, type SlideId } from "../../core/document-model";
import { useCanvasGuidesStore, type CanvasGuide, type GuideAxis } from "../../store/canvas-guides-store";

/**
 * 画布上的辅助层：网格和参考线。
 *
 * 这一层只在编辑时存在，不进入文档模型，也不会导出到 PPTX。导出的文件
 * 里不该出现编辑器的网格线，所以它必须画在文档之外。
 *
 * 视图和状态是分开的：CanvasGridView / CanvasGuideView 只按传进来的数据
 * 画，连接 store 的部分在外层。这样纯渲染可以被直接测试，不需要浏览器。
 */

export interface CanvasGridViewProps {
  enabled: boolean;
  /** 网格间距，EMU。 */
  gridSize: number;
  /** 每一 EMU 对应多少屏幕像素。 */
  scale: number;
}

/** 网格底纹。画在元素下面，只提示位置，不参与任何文档计算。 */
export const CanvasGridView = memo(function CanvasGridView({ enabled, gridSize, scale }: CanvasGridViewProps) {
  const step = gridSize * scale;
  if (!enabled || step <= 0.5) return null;
  return (
    <div
      className="canvas-grid-layer"
      aria-hidden="true"
      style={{
        backgroundImage:
          "repeating-linear-gradient(to right, rgba(120,130,150,.26) 0 1px, transparent 1px var(--grid-step)), repeating-linear-gradient(to bottom, rgba(120,130,150,.26) 0 1px, transparent 1px var(--grid-step))",
        ["--grid-step" as string]: `${step}px`,
      }}
    />
  );
});

export interface CanvasGuideViewProps {
  guides: readonly CanvasGuide[];
  /** 页面尺寸，EMU。 */
  pageWidth: number;
  pageHeight: number;
  /** 每一 EMU 对应多少屏幕像素。 */
  scale: number;
  /** 拖拽过程中命中的吸附线，页面坐标。 */
  activeSnapX?: number;
  activeSnapY?: number;
  onMove: (guideId: string, position: Emu) => void;
  onRemove: (guideId: string) => void;
}

/** 参考线层，画在元素之上，方便看见被对象盖住的线。 */
export const CanvasGuideView = memo(function CanvasGuideView({
  guides,
  pageWidth,
  pageHeight,
  scale,
  activeSnapX,
  activeSnapY,
  onMove,
  onRemove,
}: CanvasGuideViewProps) {
  return (
    <div className="canvas-guide-layer">
      {activeSnapX !== undefined && (
        <div className="canvas-snap-line vertical" style={{ left: activeSnapX * scale }} aria-hidden="true" />
      )}
      {activeSnapY !== undefined && (
        <div className="canvas-snap-line horizontal" style={{ top: activeSnapY * scale }} aria-hidden="true" />
      )}
      {guides.map((guide) => (
        <GuideLine
          key={guide.id}
          axis={guide.axis}
          position={guide.position}
          scale={scale}
          extent={guide.axis === "x" ? pageWidth : pageHeight}
          onMove={(position) => onMove(guide.id, position)}
          onRemove={() => onRemove(guide.id)}
        />
      ))}
    </div>
  );
});

export interface CanvasGridLayerProps {
  /** 每一 EMU 对应多少屏幕像素。 */
  scale: number;
}

/** 连接 store 的网格层。 */
export const CanvasGridLayer = memo(function CanvasGridLayer({ scale }: CanvasGridLayerProps) {
  const gridEnabled = useCanvasGuidesStore((state) => state.gridEnabled);
  const gridSize = useCanvasGuidesStore((state) => state.gridSize);
  return <CanvasGridView enabled={gridEnabled} gridSize={gridSize} scale={scale} />;
});

export interface CanvasGuideLayerProps {
  slideId: SlideId;
  /** 页面尺寸，EMU。 */
  pageWidth: number;
  pageHeight: number;
  /** 每一 EMU 对应多少屏幕像素。 */
  scale: number;
}

/** 连接 store 的参考线层。 */
export const CanvasGuideLayer = memo(function CanvasGuideLayer({
  slideId,
  pageWidth,
  pageHeight,
  scale,
}: CanvasGuideLayerProps) {
  const guides = useCanvasGuidesStore((state) => state.guidesBySlide[slideId]);
  const activeSnapX = useCanvasGuidesStore((state) => state.activeSnapX);
  const activeSnapY = useCanvasGuidesStore((state) => state.activeSnapY);
  const moveGuide = useCanvasGuidesStore((state) => state.moveGuide);
  const removeGuide = useCanvasGuidesStore((state) => state.removeGuide);
  return (
    <CanvasGuideView
      guides={guides ?? []}
      pageWidth={pageWidth}
      pageHeight={pageHeight}
      scale={scale}
      activeSnapX={activeSnapX}
      activeSnapY={activeSnapY}
      onMove={(guideId, position) => moveGuide(slideId, guideId, position)}
      onRemove={(guideId) => removeGuide(slideId, guideId)}
    />
  );
});

interface GuideLineProps {
  axis: GuideAxis;
  position: number;
  scale: number;
  extent: number;
  onMove: (position: Emu) => void;
  onRemove: () => void;
}

/**
 * 一条参考线。
 *
 * 线本身很细，但抓手比线宽，否则几乎点不中。拖动时线跟着指针走，双击
 * 删除。拖动只改交互状态，不产生撤销项——参考线不是文稿的一部分。
 */
const GuideLine = memo(function GuideLine({ axis, position, scale, extent, onMove, onRemove }: GuideLineProps) {
  const drag = useRef<{ startClient: number; startPosition: number } | null>(null);
  const vertical = axis === "x";
  const pixels = position * scale;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // 参考线在画布元素之上，如果不拦住，画布的取消选择会先执行。
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startClient: vertical ? event.clientX : event.clientY, startPosition: position };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const client = vertical ? event.clientX : event.clientY;
    const delta = (client - current.startClient) / scale;
    const next = Math.min(Math.max(current.startPosition + delta, 0), extent);
    onMove(emu(next));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };

  return (
    <div
      className={`canvas-guide ${vertical ? "vertical" : "horizontal"}`}
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={vertical ? "垂直参考线" : "水平参考线"}
      title={vertical ? "垂直参考线（双击删除）" : "水平参考线（双击删除）"}
      style={vertical ? { left: pixels } : { top: pixels }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
    >
      <i />
    </div>
  );
});
