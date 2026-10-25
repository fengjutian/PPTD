import type { ShapeElement, ShapeKind } from "../../core/document-model";
import { shadowSpec } from "../../core/design/effects";
import { gradientCss, gradientLinePoints } from "../../core/design/shape-gradient";
import { ptToPx, type SceneScale } from "./scene-metrics";

/**
 * A preset shape drawn from the same geometry the importer reads and the
 * exporter writes.
 *
 * Rectangle and ellipse keep the CSS path: their border radius is a style, and
 * a rounded rectangle is still a rectangle. The other presets need a real
 * outline, so they are drawn as an SVG path scaled to the element frame.
 */
export function ShapeView({ element, scale }: { element: ShapeElement; scale: SceneScale }) {
  const width = element.frame.width * scale;
  const height = element.frame.height * scale;
  const fillGradient = element.style.fillGradient;
  // The canvas shows the same three levels the exporter writes, converted with
  // the scene scale so a zoomed canvas does not get a shadow that belongs to a
  // larger page.
  const shadow = shadowSpec(element.style.shadow);
  const shadowCss = shadow
    ? `0 ${ptToPx(shadow.distancePt, scale)}px ${ptToPx(shadow.blurPt, scale)}px rgba(0, 0, 0, ${shadow.opacity})`
    : undefined;
  if (element.shape === "rectangle" || element.shape === "ellipse") {
    return (
      <div
        className={`shape-fill ${element.shape}`}
        style={{
          background: fillGradient ? gradientCss(fillGradient) : element.style.fill,
          borderColor: element.style.stroke,
          borderWidth: ptToPx(element.style.strokeWidthPt, scale),
          borderRadius: element.shape === "ellipse" ? "50%" : ptToPx(element.style.radiusPt, scale),
          ...(shadowCss ? { boxShadow: shadowCss } : {}),
        }}
      />
    );
  }
  const strokeWidth = ptToPx(element.style.strokeWidthPt, scale);
  const gradientId = fillGradient ? `shape-gradient-${element.id}` : undefined;
  const gradientPoints = fillGradient ? gradientLinePoints(fillGradient.angleDeg, width, height) : undefined;
  return (
    <svg
      className="shape-vector"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
      // A vector outline cannot take a box-shadow; drop-shadow follows the path.
      style={
        shadow
          ? {
              filter: `drop-shadow(0 ${ptToPx(shadow.distancePt, scale)}px ${ptToPx(shadow.blurPt, scale)}px rgba(0, 0, 0, ${shadow.opacity}))`,
            }
          : undefined
      }
    >
      {fillGradient && gradientId && gradientPoints && (
        <defs>
          <linearGradient
            id={gradientId}
            x1={gradientPoints.x1}
            y1={gradientPoints.y1}
            x2={gradientPoints.x2}
            y2={gradientPoints.y2}
            gradientUnits="userSpaceOnUse"
          >
            {fillGradient.stops.map((stop) => (
              <stop
                key={`${stop.offset}-${stop.color}`}
                offset={stop.offset}
                stopColor={stop.color}
                stopOpacity={1 - (stop.transparency ?? 0) / 100}
              />
            ))}
          </linearGradient>
        </defs>
      )}
      <path
        d={pathFor(element.shape, width, height)}
        fill={gradientId ? `url(#${gradientId})` : element.style.fill}
        stroke={strokeWidth > 0 ? element.style.stroke : "none"}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Outline of one preset in the element's pixel frame. */
export function pathFor(shape: Exclude<ShapeKind, "rectangle" | "ellipse">, width: number, height: number): string {
  const points = (values: Array<[number, number]>) =>
    values.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x * width} ${y * height}`).join(" ") + " Z";
  if (shape === "triangle") {
    return points([
      [0.5, 0],
      [1, 1],
      [0, 1],
    ]);
  }
  if (shape === "diamond") {
    return points([
      [0.5, 0],
      [1, 0.5],
      [0.5, 1],
      [0, 0.5],
    ]);
  }
  if (shape === "pentagon") {
    return points([
      [0.5, 0],
      [1, 0.38],
      [0.82, 1],
      [0.18, 1],
      [0, 0.38],
    ]);
  }
  if (shape === "hexagon") {
    return points([
      [0.25, 0],
      [0.75, 0],
      [1, 0.5],
      [0.75, 1],
      [0.25, 1],
      [0, 0.5],
    ]);
  }
  if (shape === "chevron") {
    return points([
      [0, 0],
      [0.7, 0],
      [1, 0.5],
      [0.7, 1],
      [0, 1],
      [0.3, 0.5],
    ]);
  }
  if (shape === "arrow") {
    return points([
      [0, 0.25],
      [0.6, 0.25],
      [0.6, 0],
      [1, 0.5],
      [0.6, 1],
      [0.6, 0.75],
      [0, 0.75],
    ]);
  }
  if (shape === "parallelogram") {
    return points([
      [0.2, 0],
      [1, 0],
      [0.8, 1],
      [0, 1],
    ]);
  }
  if (shape === "trapezoid") {
    return points([
      [0.2, 0],
      [0.8, 0],
      [1, 1],
      [0, 1],
    ]);
  }
  // Five-point star: outer and inner radius alternating, starting at the top.
  const outer = 0.5;
  const inner = outer * 0.382;
  const star: Array<[number, number]> = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    star.push([0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius]);
  }
  return points(star);
}
