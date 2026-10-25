import { memo } from "react";
import type { Slide } from "../../core/document-model";
import { sceneScale } from "./scene-metrics";
import { useMeasuredWidth } from "./use-measured-width";
import { SlideElementContent, SlideElementFrame } from "./SlideScene";

export const SlideThumbnail = memo(function SlideThumbnail({
  slide,
  pageWidth,
  pageHeight,
}: {
  slide: Slide;
  pageWidth: number;
  pageHeight: number;
}) {
  // The thumbnail is the canvas drawn smaller, so it needs the size of its own
  // box: the text of a page is only the same text when it is drawn with the
  // scale of the box it is drawn in.
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  const scale = sceneScale(width, pageWidth);
  return (
    <div className="thumbnail" ref={ref} style={{ aspectRatio: `${pageWidth} / ${pageHeight}` }}>
      <div className="thumbnail-scene" style={{ background: slide.background }}>
        {slide.elements.map((element) => (
          <SlideElementFrame key={element.id} element={element} scale={scale}>
            <SlideElementContent element={element} slide={slide} scale={scale} imageAlt="" />
          </SlideElementFrame>
        ))}
        {slide.elements.length === 0 && <div className="thumbnail-fallback-title">{slide.content.title}</div>}
      </div>
    </div>
  );
});
