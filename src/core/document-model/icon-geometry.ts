import { BUILTIN_ICONS, type BuiltinIconName } from "./icons";

/**
 * A point on the editable outline of a built-in icon.
 *
 * The exporter turns these into a DrawingML custom-geometry shape, so an icon
 * stays a vector object in PowerPoint instead of becoming a picture. PptxGenJS
 * writes SVG pictures with a broken PNG fallback (the fallback part receives
 * the SVG bytes), which makes the exported package unreadable in PowerPoint.
 * Native geometry avoids that whole path: no image part, no rasterizer, and
 * the icon still scales with the slide.
 *
 * Coordinates are inches relative to the icon's own frame, not the page.
 */
export type IconPathPoint =
  | { x: number; y: number; moveTo?: boolean }
  | {
      x: number;
      y: number;
      curve: { type: "cubic"; x1: number; y1: number; x2: number; y2: number };
    }
  | { close: true };

const ICON_GRID = 24;
/** The cubic approximation of a quarter circle. */
const KAPPA = 0.5522847498307936;

interface Vec {
  x: number;
  y: number;
}

interface CubicSegment {
  c1: Vec;
  c2: Vec;
  to: Vec;
}

/**
 * The outline of an icon in the units of its frame.
 *
 * A frame is a square in inches on the page, but the page itself is wider than
 * it is tall; scaling x and y by the same factor would stretch the icon. The
 * two axes are therefore scaled independently.
 */
export function iconOutline(name: BuiltinIconName, width: number, height: number): IconPathPoint[] {
  const definition = BUILTIN_ICONS[name];
  const points: IconPathPoint[] = [];
  for (const path of definition.paths) points.push(...outlinePath(path));
  for (const circle of definition.circles ?? []) points.push(...circleOutline(circle.cx, circle.cy, circle.r));
  const scaleX = width / ICON_GRID;
  const scaleY = height / ICON_GRID;
  return points.map((point) => scalePoint(point, scaleX, scaleY));
}

function scalePoint(point: IconPathPoint, scaleX: number, scaleY: number): IconPathPoint {
  if ("close" in point) return point;
  if ("curve" in point) {
    return {
      x: point.x * scaleX,
      y: point.y * scaleY,
      curve: {
        type: "cubic",
        x1: point.curve.x1 * scaleX,
        y1: point.curve.y1 * scaleY,
        x2: point.curve.x2 * scaleX,
        y2: point.curve.y2 * scaleY,
      },
    };
  }
  return { ...point, x: point.x * scaleX, y: point.y * scaleY };
}

/**
 * Parses the path data of an icon into absolute cubic/line segments.
 *
 * The 12 built-in icons only use the ordinary SVG path commands, but they do
 * use them in relative form and with arcs, so this is a real (small) parser
 * rather than a set of string splits. Only the commands present in the icon
 * set are implemented; an unknown command throws instead of producing a
 * silently wrong drawing.
 */
function outlinePath(data: string): IconPathPoint[] {
  const tokens = tokenizePath(data);
  const points: IconPathPoint[] = [];
  let index = 0;
  let command = "";
  let previous = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCubic: Vec | undefined;
  let lastQuad: Vec | undefined;

  const next = (): number => {
    const value = tokens[index];
    index += 1;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("ICON_PATH_INVALID");
    return value;
  };
  const lineTo = (nextX: number, nextY: number): void => {
    points.push({ x: nextX, y: nextY });
    x = nextX;
    y = nextY;
  };
  const cubicTo = (c1: Vec, c2: Vec, to: Vec): void => {
    points.push({ x: to.x, y: to.y, curve: { type: "cubic", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y } });
    x = to.x;
    y = to.y;
    lastCubic = c2;
    lastQuad = undefined;
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (typeof token === "string") {
      command = token;
      index += 1;
    } else if (!command) {
      break;
    }
    const relative = command === command.toLowerCase();
    const prior = previous;

    switch (command.toUpperCase()) {
      case "M": {
        const nextX = relative ? x + next() : next();
        const nextY = relative ? y + next() : next();
        x = nextX;
        y = nextY;
        startX = x;
        startY = y;
        points.push({ x, y, moveTo: true });
        lastCubic = undefined;
        lastQuad = undefined;
        previous = "M";
        // Further coordinate pairs after a moveto are implicit linetos.
        command = relative ? "l" : "L";
        break;
      }
      case "L": {
        const nextX = relative ? x + next() : next();
        const nextY = relative ? y + next() : next();
        lineTo(nextX, nextY);
        lastCubic = undefined;
        lastQuad = undefined;
        previous = "L";
        break;
      }
      case "H": {
        const nextX = relative ? x + next() : next();
        lineTo(nextX, y);
        lastCubic = undefined;
        lastQuad = undefined;
        previous = "H";
        break;
      }
      case "V": {
        const nextY = relative ? y + next() : next();
        lineTo(x, nextY);
        lastCubic = undefined;
        lastQuad = undefined;
        previous = "V";
        break;
      }
      case "C": {
        const c1 = { x: relative ? x + next() : next(), y: relative ? y + next() : next() };
        const c2 = { x: relative ? x + next() : next(), y: relative ? y + next() : next() };
        const to = { x: relative ? x + next() : next(), y: relative ? y + next() : next() };
        cubicTo(c1, c2, to);
        previous = "C";
        break;
      }
      case "S": {
        const c1 =
          prior === "C" || prior === "S"
            ? { x: 2 * x - lastCubic!.x, y: 2 * y - lastCubic!.y }
            : { x, y };
        const c2 = { x: relative ? x + next() : next(), y: relative ? y + next() : next() };
        const to = { x: relative ? x + next() : next(), y: relative ? y + next() : next() };
        cubicTo(c1, c2, to);
        previous = "S";
        break;
      }
      case "Q": {
        const control = { x: relative ? x + next() : next(), y: relative ? y + next() : next() };
        const to = { x: relative ? x + next() : next(), y: relative ? y + next() : next() };
        const c1 = { x: x + (2 / 3) * (control.x - x), y: y + (2 / 3) * (control.y - y) };
        const c2 = { x: to.x + (2 / 3) * (control.x - to.x), y: to.y + (2 / 3) * (control.y - to.y) };
        cubicTo(c1, c2, to);
        lastQuad = control;
        lastCubic = undefined;
        previous = "Q";
        break;
      }
      case "T": {
        const control =
          prior === "Q" || prior === "T" ? { x: 2 * x - lastQuad!.x, y: 2 * y - lastQuad!.y } : { x, y };
        const to = { x: relative ? x + next() : next(), y: relative ? y + next() : next() };
        const c1 = { x: x + (2 / 3) * (control.x - x), y: y + (2 / 3) * (control.y - y) };
        const c2 = { x: to.x + (2 / 3) * (control.x - to.x), y: to.y + (2 / 3) * (control.y - to.y) };
        cubicTo(c1, c2, to);
        lastQuad = control;
        lastCubic = undefined;
        previous = "T";
        break;
      }
      case "A": {
        const rx = Math.abs(next());
        const ry = Math.abs(next());
        const rotation = next();
        const largeArc = next() !== 0;
        const sweep = next() !== 0;
        const to = { x: relative ? x + next() : next(), y: relative ? y + next() : next() };
        const segments = arcToCubics({ x, y }, rx, ry, rotation, largeArc, sweep, to);
        if (segments.length === 0) {
          lineTo(to.x, to.y);
        } else {
          for (const segment of segments) {
            points.push({
              x: segment.to.x,
              y: segment.to.y,
              curve: {
                type: "cubic",
                x1: segment.c1.x,
                y1: segment.c1.y,
                x2: segment.c2.x,
                y2: segment.c2.y,
              },
            });
          }
          x = to.x;
          y = to.y;
        }
        lastCubic = undefined;
        lastQuad = undefined;
        previous = "A";
        break;
      }
      case "Z": {
        points.push({ close: true });
        x = startX;
        y = startY;
        lastCubic = undefined;
        lastQuad = undefined;
        previous = "Z";
        // A number after a closepath has no command to belong to.
        command = "";
        break;
      }
      default:
        throw new Error("ICON_PATH_COMMAND_UNSUPPORTED");
    }
  }
  return points;
}

/**
 * A parsing tokenizer for path data: a command letter or a number.
 *
 * Adjacent numbers such as `1.5.5` are two numbers, not one malformed one, so
 * the numeric branch cannot require whitespace between matches.
 */
function tokenizePath(data: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  const pattern = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(data)) !== null) {
    if (match[1] !== undefined) tokens.push(match[1]);
    else if (match[2] !== undefined) tokens.push(Number(match[2]));
  }
  return tokens;
}

/**
 * Approximates an SVG elliptical arc with cubic Bézier segments.
 *
 * The endpoint-to-centre conversion follows the SVG implementation notes. The
 * arc is split into quarter-turn segments, which keeps the cubic error far
 * below what a 0.24-inch icon can show.
 */
function arcToCubics(
  from: Vec,
  rx: number,
  ry: number,
  rotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
  to: Vec,
): CubicSegment[] {
  if (from.x === to.x && from.y === to.y) return [];
  if (rx === 0 || ry === 0) return [];
  const phi = ((rotationDegrees % 360) * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cosPhi * dx + sinPhi * dy;
  const y1 = -sinPhi * dx + cosPhi * dy;

  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * (rx * y1)) / ry;
  const cyp = (coefficient * (-ry * x1)) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;

  const startAngle = vectorAngle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let delta = vectorAngle(
    (x1 - cxp) / rx,
    (y1 - cyp) / ry,
    (-x1 - cxp) / rx,
    (-y1 - cyp) / ry,
  );
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / count;
  const segments: CubicSegment[] = [];
  for (let segment = 0; segment < count; segment += 1) {
    const start = startAngle + segment * step;
    const end = start + step;
    const alpha = (4 / 3) * Math.tan(step / 4);
    const startPoint = ellipsePoint(cx, cy, rx, ry, cosPhi, sinPhi, start);
    const endPoint = ellipsePoint(cx, cy, rx, ry, cosPhi, sinPhi, end);
    const startDerivative = ellipseDerivative(rx, ry, cosPhi, sinPhi, start);
    const endDerivative = ellipseDerivative(rx, ry, cosPhi, sinPhi, end);
    segments.push({
      c1: { x: startPoint.x + alpha * startDerivative.x, y: startPoint.y + alpha * startDerivative.y },
      c2: { x: endPoint.x - alpha * endDerivative.x, y: endPoint.y - alpha * endDerivative.y },
      to: endPoint,
    });
  }
  return segments;
}

function ellipsePoint(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  cosPhi: number,
  sinPhi: number,
  angle: number,
): Vec {
  const cosAngle = Math.cos(angle);
  const sinAngle = Math.sin(angle);
  return {
    x: cx + rx * cosAngle * cosPhi - ry * sinAngle * sinPhi,
    y: cy + rx * cosAngle * sinPhi + ry * sinAngle * cosPhi,
  };
}

function ellipseDerivative(
  rx: number,
  ry: number,
  cosPhi: number,
  sinPhi: number,
  angle: number,
): Vec {
  const cosAngle = Math.cos(angle);
  const sinAngle = Math.sin(angle);
  return {
    x: -rx * sinAngle * cosPhi - ry * cosAngle * sinPhi,
    y: -rx * sinAngle * sinPhi + ry * cosAngle * cosPhi,
  };
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (length === 0) return 0;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot / length)));
  return ux * vy - uy * vx < 0 ? -angle : angle;
}

/** A circle as four cubic segments, in icon-grid units. */
function circleOutline(cx: number, cy: number, radius: number): IconPathPoint[] {
  const k = KAPPA * radius;
  return [
    { x: cx + radius, y: cy, moveTo: true },
    {
      x: cx,
      y: cy + radius,
      curve: { type: "cubic", x1: cx + radius, y1: cy + k, x2: cx + k, y2: cy + radius },
    },
    {
      x: cx - radius,
      y: cy,
      curve: { type: "cubic", x1: cx - k, y1: cy + radius, x2: cx - radius, y2: cy + k },
    },
    {
      x: cx,
      y: cy - radius,
      curve: { type: "cubic", x1: cx - radius, y1: cy - k, x2: cx - k, y2: cy - radius },
    },
    {
      x: cx + radius,
      y: cy,
      curve: { type: "cubic", x1: cx + k, y1: cy - radius, x2: cx + radius, y2: cy - k },
    },
    { close: true },
  ];
}
