import { memo } from "react";
import { type Slide, type SlideElement } from "../../core/document-model";
import { SlideElementContent, SlideElementFrame } from "./SlideScene";

export interface ElementPreviewProps {
  element: SlideElement;
  slide: Slide;
  width?: number;
  height?: number;
  /** The name of the object, shown when the pointer rests on the picture. */
  label?: string;
}

/**
 * A small picture of the selected object.
 *
 * It is drawn with the same code the canvas uses, scaled into the box of the
 * panel, so the user sees the object as it is instead of a name for it.
 */
export const ElementPreview = memo(function ElementPreview({ element, slide, width = 56, height = 36, label }: ElementPreviewProps) {
  // An element without size would divide by zero, so the scale stays at zero
  // and the box simply shows the background.
  const ratio =
    element.frame.width > 0 && element.frame.height > 0
      ? Math.min(width / element.frame.width, height / element.frame.height)
      : 0;
  const scale = ratio;
  const drawnWidth = element.frame.width * scale;
  const drawnHeight = element.frame.height * scale;
  return (
    <span className="element-preview" title={label} style={{ width, height, background: slide.background }}>
      <span
        className="element-preview-canvas"
        style={{ width: drawnWidth, height: drawnHeight, left: (width - drawnWidth) / 2, top: (height - drawnHeight) / 2 }}
      >
        <SlideElementFrame element={element} scale={scale} style={{ left: 0, top: 0 }}>
          <SlideElementContent element={element} slide={slide} scale={scale} imageAlt="" />
        </SlideElementFrame>
      </span>
    </span>
  );
});
