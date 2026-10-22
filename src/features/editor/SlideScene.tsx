import { type CSSProperties, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { type Slide, type SlideElement } from "../../core/document-model";
import { ChartView } from "./ChartView";
import { CroppedImage } from "./CroppedImage";
import { LineView } from "./LineView";
import { RichText } from "./RichText";
import { TableView } from "./TableView";
import { ptToPx, type SceneScale } from "./scene-metrics";

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
  if (element.type === "shape") {
    return (
      <div
        className={`shape-fill ${element.shape}`}
        style={{
          background: element.style.fill,
          borderColor: element.style.stroke,
          borderWidth: ptToPx(element.style.strokeWidthPt, scale),
          borderRadius: element.shape === "ellipse" ? "50%" : ptToPx(element.style.radiusPt, scale),
        }}
      />
    );
  }
  if (element.type === "line") return <LineView element={element} scale={scale} />;
  if (element.type === "image") return <CroppedImage element={element} className="image-fill" alt={imageAlt} />;  if (element.type === "chart") return <ChartView element={element} slide={slide} scale={scale} />;
  return <TableView element={element} slide={slide} scale={scale} />;
}

export interface SlideElementFrameProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  element: SlideElement;
  scale: SceneScale;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/**
 * The frame of one element on the page.
 *
 * The frame is placed in pixels of the surface it is drawn on, so the same
 * element keeps the same place on the canvas and in the thumbnail.
 */
export function SlideElementFrame({ element, scale, children, className, style, ...rest }: SlideElementFrameProps) {
  return (
    <div
      {...rest}
      className={`slide-element ${element.type}${className ? ` ${className}` : ""}`}
      style={{
        left: element.frame.x * scale,
        top: element.frame.y * scale,
        width: element.frame.width * scale,
        height: element.frame.height * scale,
        transform: `rotate(${element.rotationMilliDegree / 1000}deg)`,
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
      {slide.elements.map((element) => (
        <SlideElementFrame key={element.id} element={element} scale={scale}>
          <SlideElementContent element={element} slide={slide} scale={scale} imageAlt={imageAlt} />
        </SlideElementFrame>
      ))}
    </div>
  );
}
