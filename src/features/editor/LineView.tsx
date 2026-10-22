import { memo } from "react";
import type { LineElement } from "../../core/document-model";
import { ptToPx, type SceneScale } from "./scene-metrics";

export interface LineViewProps {
  element: LineElement;
  scale: SceneScale;
}

/**
 * 一条线条。
 *
 * 线条用 SVG 画，不用带边框的 div：箭头端点和虚线都是线条自己的属性，
 * 用 div 得靠伪元素硬凑，箭头还会被裁掉。SVG 画出来的线在画布、缩略图和
 * 导出结果里是同一套几何。
 */
export const LineView = memo(function LineView({ element, scale }: LineViewProps) {
  const width = Math.max(element.frame.width * scale, 1);
  const height = Math.max(element.frame.height * scale, 1);
  const strokeWidth = Math.max(ptToPx(element.style.strokeWidthPt, scale), 1);
  const arrowLength = Math.max(strokeWidth * 4, 6);

  // 起点和终点。斜线从左上到右下，其余居中穿过。
  const start = element.direction === "diagonal" ? { x: 0, y: 0 } : { x: 0, y: height / 2 };
  const end = element.direction === "diagonal" ? { x: width, y: height } : { x: width, y: height / 2 };

  const startMarker = element.style.startArrow === "arrow" ? "url(#pptd-line-arrow-start)" : undefined;
  const endMarker = element.style.endArrow === "arrow" ? "url(#pptd-line-arrow-end)" : undefined;

  return (
    <svg
      className="line-svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="pptd-line-arrow-end"
          markerWidth={arrowLength}
          markerHeight={arrowLength}
          refX={arrowLength}
          refY={arrowLength / 2}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d={`M 0 0 L ${arrowLength} ${arrowLength / 2} L 0 ${arrowLength} Z`} fill={element.style.stroke} />
        </marker>
        <marker
          id="pptd-line-arrow-start"
          markerWidth={arrowLength}
          markerHeight={arrowLength}
          refX={0}
          refY={arrowLength / 2}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d={`M ${arrowLength} 0 L 0 ${arrowLength / 2} L ${arrowLength} ${arrowLength} Z`} fill={element.style.stroke} />
        </marker>
      </defs>
      {/* 命中区：一条加宽的透明描边。线条本身只有几个像素宽，
          用户很难精确对准；这条描边让点击落在附近就算命中。 */}
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke="transparent"
        strokeWidth={Math.max(strokeWidth * 6, 10)}
        strokeLinecap="round"
      />
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke={element.style.stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        {...(element.style.dashed ? { strokeDasharray: `${strokeWidth * 3} ${strokeWidth * 2}` } : {})}
        {...(startMarker ? { markerStart: startMarker } : {})}
        {...(endMarker ? { markerEnd: endMarker } : {})}
      />
    </svg>
  );
});
