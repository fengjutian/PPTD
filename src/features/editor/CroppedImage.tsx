import type { CSSProperties } from "react";
import type { ImageElement } from "../../core/document-model";
import { cropGeometry } from "../../core/rendering/image-crop";

interface CroppedImageProps {
  element: ImageElement;
  className?: string;
  /** The thumbnail repeats the picture without describing it again. */
  alt?: string;
}

/**
 * Draws a picture with its crop applied. The visible region of the source is
 * stretched over the frame, the same way the exported picture fills its
 * shape, so the canvas and the PPTX show the same picture.
 */
export function CroppedImage({ element, className, alt }: CroppedImageProps) {
  const geometry = cropGeometry(element.crop);
  const style: CSSProperties = {
    width: `${geometry.width * 100}%`,
    height: `${geometry.height * 100}%`,
    left: `${geometry.left * 100}%`,
    top: `${geometry.top * 100}%`,
  };
  return (
    <img
      className={className}
      style={style}
      src={element.source.dataUrl}
      alt={alt ?? element.altText}
      draggable={false}
    />
  );
}
