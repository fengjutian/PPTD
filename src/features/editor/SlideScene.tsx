import { useMemo, type CSSProperties, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { visibleElements, type ImageFrameShape, type Slide, type SlideElement } from "../../core/document-model";
import { textOverflowsFrame } from "../../core/rendering/text-fit";
import { ChartView } from "./ChartView";
import { CroppedImage } from "./CroppedImage";
import { LineView } from "./LineView";
import { IconView } from "./IconView";
import { RichText } from "./RichText";
import { TableView } from "./TableView";
import { ShapeView } from "./ShapeView";
import { type SceneScale } from "./scene-metrics";

export interface SlideElementContentProps {
  element: SlideElement;
  slide: Slide;
  scale: SceneScale;
  /** The alternative text of a picture. The thumbnail leaves it empty. */
  imageAlt?: string;
}

/**
 * The body of one element.
 *
 * The canvas and the thumbnail draw the same element with the same code, so a
 * page looks the same in the preview as it does on the canvas. Everything that
 * is drawn here is scaled by the scale of the surface, never by a constant of
 * its own, which is what kept the preview and the canvas apart.
 */
export function SlideElementContent({ element, slide, scale, imageAlt }: SlideElementContentProps) {
  if (element.type === "text") return <RichText element={element} scale={scale} />;
  if (element.type === "shape") return <ShapeView element={element} scale={scale} />;
  if (element.type === "line") return <LineView element={element} scale={scale} />;
  if (element.type === "icon") return <IconView element={element} />;
  if (element.type === "image") return <CroppedImage element={element} className="image-fill" alt={imageAlt} />;
  if (element.type === "chart") return <ChartView element={element} slide={slide} scale={scale} />;
  return <TableView element={element} slide={slide} scale={scale} />;
}

export interface SlideElementFrameProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  element: SlideElement;
  scale: SceneScale;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/**
 * How the frame of a picture is clipped.
 *
 * The canvas clips with the same two geometries the exporter writes: a
 * roundRect whose corner is 16.667% of the shorter side (the `roundRect` preset's
 * default adjustment, so PowerPoint draws the same radius) and an ellipse.
 */
function pictureClip(shape: ImageFrameShape | undefined, width: number, height: number): CSSProperties | undefined {
  if (shape === "ellipse") return { borderRadius: "50%", overflow: "hidden" };
  if (shape === "roundRect") {
    return { borderRadius: Math.min(width, height) * 0.16667, overflow: "hidden" };
  }
  return undefined;
}

/**
 * The frame of one element on the page.
 *
 * The frame is placed in pixels of the surface it is drawn on, so the same
 * element keeps the same place on the canvas and in the thumbnail.
 *
 * A text whose copy needs more height than its frame carries `text-overflow`:
 * the canvas draws a dashed edge around it instead of letting the box quietly
 * cut the last line. The preview and the file shrink such a text, so the editor
 * is the one place where the problem has to be visible to be fixed.
 */
export function SlideElementFrame({ element, scale, children, className, style, ...rest }: SlideElementFrameProps) {
  const width = element.frame.width * scale;
  const height = element.frame.height * scale;
  const clip = element.type === "image" ? pictureClip(element.frameShape, width, height) : undefined;
  // The measurement is size independent (points), so it only has to run when the
  // element itself changes — not on every pan, zoom or selection of the canvas.
  const overflows = useMemo(() => element.type === "text" && textOverflowsFrame(element), [element]);
  return (
    <div
      {...rest}
      className={`slide-element ${element.type}${overflows ? " text-overflow" : ""}${className ? ` ${className}` : ""}`}
      style={{
        left: element.frame.x * scale,
        top: element.frame.y * scale,
        width,
        height,
        transform: `rotate(${element.rotationMilliDegree / 1000}deg)`,
        ...clip,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export interface SlideSceneProps {
  slide: Slide;
  pageWidth: number;
  pageHeight: number;
  scale: SceneScale;
  className?: string;
  style?: CSSProperties;
  imageAlt?: string;
}

/**
 * A whole page, drawn at the given scale.
 *
 * The background of the page and the place of every element come from the
 * document, so the preview shows the page as the canvas draws it.
 */
export function SlideScene({ slide, pageWidth, pageHeight, scale, className, style, imageAlt }: SlideSceneProps) {
  return (
    <div
      className={className}
      style={{ width: pageWidth * scale, height: pageHeight * scale, background: slide.background, ...style }}
    >
      {visibleElements(slide).map((element) => (
        <SlideElementFrame key={element.id} element={element} scale={scale}>
          <SlideElementContent element={element} slide={slide} scale={scale} imageAlt={imageAlt} />
        </SlideElementFrame>
      ))}
    </div>
  );
}
