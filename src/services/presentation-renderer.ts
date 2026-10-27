import {
  formatChartValue,
  isElementVisible,
  resolveChartData,
  resolveFragmentStyle,
  resolveTableData,
  tableColumnAlignsRight,
  textFragments,
  type ChartElement,
  type IconElement,
  type LineElement,
  type PresentationDocument,
  type ResolvedChartData,
  type Slide,
  type TableElement,
  type TextElement,
} from "../core/document-model";
import { BUILTIN_ICONS } from "../core/document-model/icons";
import { breakAtoms } from "../core/rendering/cjk-linebreak";
import { chartPlotArea, chartValueY, niceChartDomain } from "../core/rendering/chart-geometry";
import { isLargeText } from "../core/rendering/contrast";
import { gradientLinePoints, rgba as gradientRgba } from "../core/design/shape-gradient";
import { cropGeometry } from "../core/rendering/image-crop";
import {
  DEFAULT_LINE_HEIGHT,
  fitTextToFrame,
  measureCharacterEm,
  runMetricsOf,
} from "../core/rendering/text-fit";
import { resolveImageUrl } from "./image-url-service";

export interface PresentationRender {
  slides: string[];
  contactSheet: string;
}
export interface RenderedContrastIssue {
  slideIndex: number;
  elementId: string;
  contrastRatio: number;
  /** The sampled artwork color that carries the text. */ backgroundColor: string;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("VISUAL_RENDER_IMAGE_FAILED"));
    image.src = source;
  });
}

/** 只有底图解码失败可以降级，其余渲染故障必须暴露出来。 */
function isImageRenderFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes("VISUAL_RENDER_IMAGE_FAILED");
}

async function renderSlide(
  document: PresentationDocument,
  slide: Slide,
  width: number,
  includeText = true,
  tolerateImageErrors = false,
): Promise<HTMLCanvasElement> {
  const height = Math.round((width * document.pageSize.height) / document.pageSize.width);
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("VISUAL_RENDER_CONTEXT_UNAVAILABLE");
  context.fillStyle = slide.background;
  context.fillRect(0, 0, width, height);
  const sx = width / document.pageSize.width;
  const sy = height / document.pageSize.height;
  for (const element of slide.elements) {
    // A hidden object is not on the page, so it must not appear in a review or
    // preview image either.
    if (!isElementVisible(element)) continue;
    if (!includeText && element.type === "text") continue;
    const x = element.frame.x * sx;
    const y = element.frame.y * sy;
    const w = element.frame.width * sx;
    const h = element.frame.height * sy;
    context.save();
    context.translate(x + w / 2, y + h / 2);
    context.rotate((element.rotationMilliDegree * Math.PI) / 180_000);
    context.translate(-w / 2, -h / 2);
    if (element.type === "image") {
      try {
        const url = await resolveImageUrl(element.source.dataUrl);
        // A reference that is not readable yet is the same kind of failure as
        // a picture that cannot be decoded: the page is drawn without it.
        if (!url) throw new Error("VISUAL_RENDER_IMAGE_FAILED");
        const image = await loadImage(url);
        // A crop is drawn the way the editor and the exporter draw it: the
        // visible source region is stretched over the frame and clipped to it.
        const crop = cropGeometry(element.crop);
        context.save();
        context.beginPath();
        context.rect(0, 0, w, h);
        context.clip();
        context.drawImage(image, crop.left * w, crop.top * h, crop.width * w, crop.height * h);
        context.restore();
      } catch (error) {
        // 评审图可以缺一张底图，整段质检不能因为一张图解码失败就中断。
        if (!tolerateImageErrors || !isImageRenderFailure(error)) throw error;
      }
    }
    if (element.type === "shape") {
      const fillGradient = element.style.fillGradient;
      if (fillGradient) {
        const points = gradientLinePoints(fillGradient.angleDeg, w, h);
        const gradient = context.createLinearGradient(points.x1, points.y1, points.x2, points.y2);
        for (const stop of [...fillGradient.stops].sort((first, second) => first.offset - second.offset)) {
          gradient.addColorStop(stop.offset, gradientRgba(stop.color, stop.transparency));
        }
        context.fillStyle = gradient;
      } else {
        context.fillStyle = element.style.fill;
      }
      if (element.shape === "ellipse") {
        context.beginPath();
        context.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        context.fill();
      } else {
        context.beginPath();
        // radiusPt is in points; the canvas works in pixels of this render.
        const radius = Math.min(element.style.radiusPt * 12_700 * sx, w / 2, h / 2);
        context.roundRect(0, 0, w, h, radius);
        context.fill();
      }
    }
    if (element.type === "line") drawLine(context, element, w, h, sx);
    if (element.type === "text") drawText(context, element, w, h, sx);
    if (element.type === "icon") drawIcon(context, element, w, h);
    if (element.type === "chart") drawChart(context, element, slide, w, h);
    if (element.type === "table") drawTable(context, element, slide, w, h, sx);
    context.restore();
  }
  return canvas;
}

const parseHexColor = (value: string): [number, number, number] | undefined => {
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  if (!match) return undefined;
  const color = Number.parseInt(match[1]!, 16);
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
};

const relativeLuminance = ([red, green, blue]: [number, number, number]): number =>
  [red, green, blue]
    .map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    })
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0);

export function renderedContrastRatio(
  foreground: [number, number, number],
  background: [number, number, number],
): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export interface RenderedContrastReport {
  issues: RenderedContrastIssue[];
  /** 底图无法渲染、无法采样对比度的页面。 */ unreadableSlides: number[];
}

/** Samples the actual rendered pixels beneath text, including template artwork and panels. */
export async function inspectRenderedTextContrast(
  document: PresentationDocument,
  width = 640,
): Promise<RenderedContrastReport> {
  const issues: RenderedContrastIssue[] = [];
  const unreadableSlides: number[] = [];
  for (let slideIndex = 0; slideIndex < document.slides.length; slideIndex += 1) {
    const slide = document.slides[slideIndex]!;
    let canvas: HTMLCanvasElement;
    try {
      canvas = await renderSlide(document, slide, width, false);
    } catch (error) {
      // 底图解码失败的页面跳过对比度检查，而不是让整段质检失败。
      if (!isImageRenderFailure(error)) throw error;
      unreadableSlides.push(slideIndex);
      continue;
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("VISUAL_RENDER_CONTEXT_UNAVAILABLE");
    const sx = canvas.width / document.pageSize.width;
    const sy = canvas.height / document.pageSize.height;
    for (const element of slide.elements) {
      if (element.type !== "text" || !isElementVisible(element)) continue;
      const foreground = parseHexColor(element.style.color);
      if (!foreground) continue;
      const x = element.frame.x * sx;
      const y = element.frame.y * sy;
      const boxWidth = element.frame.width * sx;
      const boxHeight = element.frame.height * sy;
      const samples: Array<{ ratio: number; rgb: [number, number, number] }> = [];
      for (const xFactor of [0.15, 0.5, 0.85])
        for (const yFactor of [0.2, 0.5, 0.8]) {
          const sampleX = Math.max(0, Math.min(canvas.width - 1, Math.round(x + boxWidth * xFactor)));
          const sampleY = Math.max(0, Math.min(canvas.height - 1, Math.round(y + boxHeight * yFactor)));
          const pixel = context.getImageData(sampleX, sampleY, 1, 1).data;
          const rgb: [number, number, number] = [pixel[0]!, pixel[1]!, pixel[2]!];
          samples.push({ ratio: renderedContrastRatio(foreground, rgb), rgb });
        }
      samples.sort((left, right) => left.ratio - right.ratio);
      const worst = samples[Math.floor(samples.length * 0.25)]!;
      const requiredRatio = isLargeText(element.style.fontSizePt, element.style.bold) ? 3 : 4.5;
      if (worst.ratio < requiredRatio) {
        const backgroundColor =
          `#${worst.rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
        issues.push({ slideIndex, elementId: element.id, contrastRatio: worst.ratio, backgroundColor });
      }
    }
  }
  return { issues, unreadableSlides };
}

/**
 * Draws a line for the visual review.
 *
 * The line has its own geometry: horizontal/vertical lines run through the
 * middle of their frame, a diagonal one uses the frame corners. Arrow heads
 * are drawn here too, otherwise a review of an arrow page sees a plain stroke.
 */
function drawLine(
  context: CanvasRenderingContext2D,
  element: LineElement,
  width: number,
  height: number,
  scale: number,
): void {
  const start =
    element.direction === "diagonal"
      ? { x: 0, y: 0 }
      : element.direction === "vertical"
        ? { x: width / 2, y: 0 }
        : { x: 0, y: height / 2 };
  const end =
    element.direction === "diagonal"
      ? { x: width, y: height }
      : element.direction === "vertical"
        ? { x: width / 2, y: height }
        : { x: width, y: height / 2 };
  const strokeWidth = Math.max(1, element.style.strokeWidthPt * 12_700 * scale);
  context.strokeStyle = element.style.stroke;
  context.fillStyle = element.style.stroke;
  context.lineWidth = strokeWidth;
  context.setLineDash(element.style.dashed ? [strokeWidth * 3, strokeWidth * 2] : []);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.setLineDash([]);

  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const arrow = (x: number, y: number, direction: number) => {
    const size = Math.max(strokeWidth * 4, 6);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - Math.cos(direction - 0.45) * size, y - Math.sin(direction - 0.45) * size);
    context.lineTo(x - Math.cos(direction + 0.45) * size, y - Math.sin(direction + 0.45) * size);
    context.closePath();
    context.fill();
  };
  if (element.style.startArrow === "arrow") arrow(start.x, start.y, angle + Math.PI);
  if (element.style.endArrow === "arrow") arrow(end.x, end.y, angle);
}

/**
 * Draws a native chart for the visual review.
 *
 * The review sees a picture of the page, so every chart kind the editor can
 * show has to be drawn here as well. The numbers come from the same reviewed
 * metric blocks the export reads, so the reviewer judges the numbers that will
 * be in the file.
 */
function drawChart(
  context: CanvasRenderingContext2D,
  element: ChartElement,
  slide: Slide,
  width: number,
  height: number,
): void {
  const resolved = resolveChartData(slide, element);
  if (!resolved || resolved.categories.length === 0 || resolved.series.length === 0) return;
  const fontSize = Math.max(9, Math.min(18, height * 0.055));
  const color = (index: number) => chartSeriesColor(element, index);

  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";
  if (element.kind === "pie") {
    drawPieChart(context, element, resolved, width, height, fontSize);
  } else if (element.kind === "bar") {
    drawBarChart(context, element, resolved, width, height, fontSize);
  } else {
    drawCartesianChart(context, element, resolved, width, height, fontSize, color, slide.background);
  }
  context.restore();
}

function chartSeriesColor(element: ChartElement, index: number): string {
  const colors = element.style.seriesColors;
  return colors[index % colors.length] ?? "#3366CC";
}

/** Canvas has no alpha-aware hex parser; charts only ever carry #RRGGBB. */
function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1]!, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function fitLabel(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && context.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
  return `${value}…`;
}

function drawCartesianChart(
  context: CanvasRenderingContext2D,
  element: ChartElement,
  resolved: ResolvedChartData,
  width: number,
  height: number,
  fontSize: number,
  color: (index: number) => string,
  background: string,
): void {
  const family = element.style.fontFamily;
  const ink = element.style.textColor;
  const plot = chartPlotArea(width, height, fontSize);
  const values = resolved.series.flatMap((series) => series.values);
  const domain = niceChartDomain(Math.min(...values, 0), Math.max(...values, 1));
  const valueLabel = (value: number) => formatChartValue(value, resolved.unit);
  const axisLabel = (value: number) => formatChartValue(value, "");
  const slot = plot.width / resolved.categories.length;
  // A line uses the full plot width; columns sit at the centre of their slot so
  // every bar has equal air on both sides.
  const xAt = (index: number) =>
    element.kind === "line"
      ? plot.left +
        (resolved.categories.length === 1 ? plot.width / 2 : (index / (resolved.categories.length - 1)) * plot.width)
      : plot.left + slot * (index + 0.5);

  // Value grid and its labels. The baseline is the only line strong enough to
  // read as an axis; the rest stay faint so the data marks remain the focus.
  for (let tick = 0; tick <= 3; tick += 1) {
    const value = domain.max - ((domain.max - domain.min) * tick) / 3;
    const y = chartValueY(value, domain, plot);
    context.strokeStyle = withAlpha(ink, tick === 3 ? 0.3 : 0.11);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
    context.fillStyle = withAlpha(ink, 0.62);
    context.font = `${fontSize * 0.9}px "${family}"`;
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(fitLabel(context, axisLabel(value), plot.left - fontSize * 0.6), plot.left - fontSize * 0.55, y);
  }

  // Category labels live in the bottom gutter, not on the plot baseline.
  context.strokeStyle = withAlpha(ink, 0.06);
  context.lineWidth = 1;
  resolved.categories.forEach((_category, index) => {
    context.beginPath();
    context.moveTo(xAt(index), plot.top);
    context.lineTo(xAt(index), plot.bottom);
    context.stroke();
  });
  context.fillStyle = withAlpha(ink, 0.78);
  context.font = `${fontSize}px "${family}"`;
  context.textBaseline = "top";
  resolved.categories.forEach((category, index) => {
    // On a line chart the first and last labels sit on the plot edges; aligning
    // them inward keeps them off the value axis and inside the frame.
    const atEdge = element.kind === "line" && resolved.categories.length > 1;
    context.textAlign =
      atEdge && index === 0 ? "left" : atEdge && index === resolved.categories.length - 1 ? "right" : "center";
    context.fillText(fitLabel(context, category, slot - fontSize * 0.5), xAt(index), plot.bottom + fontSize * 0.6);
  });

  // Multi-series charts carry their names in the top gutter: a second line
  // without a legend is a guess, not a chart.
  if (element.style.showLegend && resolved.series.length > 1) {
    context.font = `${fontSize * 0.9}px "${family}"`;
    context.textBaseline = "middle";
    context.textAlign = "right";
    const legendY = Math.max(fontSize * 0.55, plot.top - fontSize * 0.95);
    let cursor = plot.right;
    for (let index = resolved.series.length - 1; index >= 0; index -= 1) {
      const label = resolved.series[index]!.name || `系列 ${index + 1}`;
      const labelWidth = context.measureText(label).width;
      context.fillStyle = withAlpha(ink, 0.85);
      context.fillText(label, cursor, legendY);
      const swatchRight = cursor - labelWidth - fontSize * 0.35;
      const swatchLeft = swatchRight - fontSize * 1.2;
      context.strokeStyle = color(index);
      context.lineWidth = Math.max(2, fontSize * 0.18);
      context.beginPath();
      context.moveTo(swatchLeft, legendY);
      context.lineTo(swatchRight, legendY);
      context.stroke();
      cursor = swatchLeft - fontSize * 0.8;
    }
  }

  if (element.kind === "line") {
    resolved.series.forEach((series, seriesIndex) => {
      const points = series.values.map((value, index) => ({ x: xAt(index), y: chartValueY(value, domain, plot) }));
      const seriesColor = color(seriesIndex);
      // A single series gets a soft area below the line so three points do not
      // float in an empty rectangle. Multi-series stays line-only.
      if (resolved.series.length === 1 && points.length > 1) {
        const area = context.createLinearGradient(0, plot.top, 0, plot.bottom);
        area.addColorStop(0, withAlpha(seriesColor, 0.2));
        area.addColorStop(1, withAlpha(seriesColor, 0));
        context.beginPath();
        context.moveTo(points[0]!.x, plot.bottom);
        for (const point of points) context.lineTo(point.x, point.y);
        context.lineTo(points[points.length - 1]!.x, plot.bottom);
        context.closePath();
        context.fillStyle = area;
        context.fill();
      }
      context.beginPath();
      points.forEach((point, index) =>
        index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y),
      );
      context.strokeStyle = seriesColor;
      context.lineWidth = Math.max(2, fontSize * 0.18);
      context.stroke();
      for (const point of points) {
        context.beginPath();
        context.arc(point.x, point.y, Math.max(3, fontSize * 0.3), 0, Math.PI * 2);
        context.fillStyle = background;
        context.fill();
        context.strokeStyle = seriesColor;
        context.lineWidth = Math.max(2, fontSize * 0.16);
        context.stroke();
      }
      if (element.style.showValueLabels && resolved.series.length === 1) {
        context.fillStyle = ink;
        context.font = `600 ${fontSize * 0.95}px "${family}"`;
        context.textAlign = "center";
        context.textBaseline = "bottom";
        points.forEach((point, index) => {
          const text = valueLabel(series.values[index] ?? 0);
          context.fillText(text, point.x, Math.max(plot.top + fontSize, point.y - fontSize * 0.55));
        });
      }
    });
    return;
  }

  // Column chart: bars grow from the zero baseline and are capped so three
  // months do not become three full-width blocks.
  const baseline = chartValueY(0, domain, plot);
  const groupWidth = Math.min(slot * 0.62, fontSize * 7);
  const barWidth = groupWidth / resolved.series.length;
  const gap = resolved.series.length > 1 ? Math.min(3, barWidth * 0.12) : 0;
  resolved.categories.forEach((_category, categoryIndex) => {
    resolved.series.forEach((series, seriesIndex) => {
      const value = series.values[categoryIndex] ?? 0;
      const valueY = chartValueY(value, domain, plot);
      const x = xAt(categoryIndex) - groupWidth / 2 + seriesIndex * barWidth;
      context.fillStyle = color(seriesIndex);
      context.fillRect(
        x,
        Math.min(valueY, baseline),
        Math.max(1, barWidth - gap),
        Math.max(1, Math.abs(baseline - valueY)),
      );
    });
  });
  if (element.style.showValueLabels && resolved.series.length === 1) {
    context.fillStyle = ink;
    context.font = `600 ${fontSize * 0.95}px "${family}"`;
    context.textAlign = "center";
    context.textBaseline = "bottom";
    resolved.categories.forEach((_category, index) => {
      const value = resolved.series[0]!.values[index] ?? 0;
      const valueY = chartValueY(value, domain, plot);
      const labelY =
        value >= 0
          ? Math.max(plot.top + fontSize, valueY - fontSize * 0.35)
          : Math.min(plot.bottom - fontSize * 0.2, valueY + fontSize * 1.1);
      context.fillText(valueLabel(value), xAt(index), labelY);
    });
  }
}

function drawBarChart(
  context: CanvasRenderingContext2D,
  element: ChartElement,
  resolved: ResolvedChartData,
  width: number,
  height: number,
  fontSize: number,
): void {
  const family = element.style.fontFamily;
  const ink = element.style.textColor;
  const base = chartPlotArea(width, height, fontSize);
  context.font = `${fontSize}px "${family}"`;
  const widest = Math.max(...resolved.categories.map((category) => context.measureText(category).width));
  const labelWidth = Math.min(width * 0.36, Math.max(fontSize * 3, widest + fontSize * 0.8));
  const plot = { ...base, left: labelWidth, width: Math.max(1, base.right - labelWidth) };
  const values = resolved.series.flatMap((series) => series.values);
  const domain = niceChartDomain(Math.min(...values, 0), Math.max(...values, 1));
  const span = domain.max - domain.min || 1;
  const zeroX = plot.left + (-domain.min / span) * plot.width;
  const valueLabel = (value: number) => formatChartValue(value, resolved.unit);
  const slot = plot.height / resolved.categories.length;
  const groupHeight = Math.min(slot * 0.62, fontSize * 3.2);
  const barHeight = groupHeight / resolved.series.length;
  const gap = resolved.series.length > 1 ? Math.min(3, barHeight * 0.12) : 0;

  context.font = `${fontSize}px "${family}"`;
  context.strokeStyle = withAlpha(ink, 0.22);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(zeroX, plot.top);
  context.lineTo(zeroX, plot.bottom);
  context.stroke();

  resolved.categories.forEach((category, categoryIndex) => {
    const center = plot.top + slot * (categoryIndex + 0.5);
    context.fillStyle = withAlpha(ink, 0.78);
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(fitLabel(context, category, labelWidth - fontSize * 0.8), plot.left - fontSize * 0.55, center);
    const groupTop = center - groupHeight / 2;
    resolved.series.forEach((series, seriesIndex) => {
      const value = series.values[categoryIndex] ?? 0;
      const barWidth = (value / span) * plot.width;
      const x = barWidth >= 0 ? zeroX : zeroX + barWidth;
      const y = groupTop + seriesIndex * barHeight;
      context.fillStyle = chartSeriesColor(element, seriesIndex);
      context.fillRect(x, y, Math.max(1, Math.abs(barWidth)), Math.max(1, barHeight - gap));
      if (element.style.showValueLabels && resolved.series.length === 1) {
        const text = valueLabel(value);
        const textX = x + Math.abs(barWidth) + fontSize * 0.4;
        const fits = textX + context.measureText(text).width <= width - fontSize * 0.4;
        context.fillStyle = fits ? ink : "#FFFFFF";
        context.textAlign = fits ? "left" : "right";
        context.textBaseline = "middle";
        context.fillText(text, fits ? textX : x + Math.abs(barWidth) - fontSize * 0.3, y + barHeight / 2);
        context.font = `${fontSize}px "${family}"`;
      }
    });
  });
}

function drawPieChart(
  context: CanvasRenderingContext2D,
  element: ChartElement,
  resolved: ResolvedChartData,
  width: number,
  height: number,
  fontSize: number,
): void {
  const values = (resolved.series[0]?.values ?? []).map((value) => Math.abs(value));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return;
  const family = element.style.fontFamily;
  const ink = element.style.textColor;
  const radius = Math.min(height * 0.36, width * 0.24);
  const inner = radius * 0.58;
  const centerX = width * 0.3;
  const centerY = height * 0.5;
  let angle = -Math.PI / 2;
  values.forEach((value, index) => {
    const sweep = (value / total) * Math.PI * 2;
    const gap = values.length > 1 ? Math.min(0.012, sweep * 0.08) : 0;
    context.beginPath();
    context.arc(centerX, centerY, radius, angle + gap / 2, angle + sweep - gap / 2);
    context.arc(centerX, centerY, inner, angle + sweep - gap / 2, angle + gap / 2, true);
    context.closePath();
    context.fillStyle = chartSeriesColor(element, index);
    context.fill();
    angle += sweep;
  });

  const legendX = Math.min(width * 0.56, centerX + radius + fontSize * 1.8);
  const itemHeight = fontSize * 1.8;
  const startY = centerY - (resolved.categories.length * itemHeight) / 2;
  context.font = `${fontSize}px "${family}"`;
  context.textAlign = "left";
  context.textBaseline = "middle";
  resolved.categories.forEach((category, index) => {
    const y = startY + itemHeight * index + itemHeight / 2;
    context.fillStyle = chartSeriesColor(element, index);
    context.fillRect(legendX, y - fontSize * 0.35, fontSize * 0.7, fontSize * 0.7);
    context.fillStyle = ink;
    const label = `${category}  ${formatChartValue(values[index] ?? 0, resolved.unit)}`;
    context.fillText(fitLabel(context, label, width - legendX - fontSize * 1.6), legendX + fontSize * 1.1, y);
  });
}

/**
 * Draws a native table as a grid for the visual review.
 *
 * The review sees a picture of the page, so a table has to be drawn here as
 * well. The cells come from the same reviewed table block the export reads, so
 * the reviewer judges the cells that will be in the file.
 */
function drawTable(
  context: CanvasRenderingContext2D,
  element: TableElement,
  slide: Slide,
  width: number,
  height: number,
  scale: number,
): void {
  const resolved = resolveTableData(slide, element);
  if (!resolved) return;
  const columnCount = resolved.header.length;
  const rowCount = resolved.rows.length + 1;
  const columnWidth = width / columnCount;
  const rowHeight = height / rowCount;
  // Points become the pixels of this render; the row height still caps the font
  // so a short table cannot grow text past its own cells.
  const fontSize = Math.max(9, Math.min(rowHeight * 0.45, (element.style.fontSizePt * scale * 914_400) / 72));
  const alignsRight = (column: number) => tableColumnAlignsRight(resolved.rows, column);
  context.font = `${fontSize}px "${element.style.fontFamily}"`;
  context.textBaseline = "middle";
  const cell = (text: string, x: number, y: number, fill: string, ink: string, bold: boolean, column: number) => {
    context.fillStyle = fill;
    context.fillRect(x, y, columnWidth, rowHeight);
    context.strokeStyle = element.style.borderColor;
    context.lineWidth = Math.max(1, height * 0.002);
    context.strokeRect(x, y, columnWidth, rowHeight);
    context.fillStyle = ink;
    context.font = `${bold ? 700 : 400} ${fontSize}px "${element.style.fontFamily}"`;
    // A number column lines up on the right, the way the exporter writes it.
    const right = alignsRight(column);
    context.textAlign = right ? "right" : "left";
    const padding = columnWidth * 0.06;
    context.fillText(text.slice(0, 12), right ? x + columnWidth - padding : x + padding, y + rowHeight / 2);
  };
  resolved.header.forEach((text, index) =>
    cell(text, index * columnWidth, 0, element.style.headerFill, element.style.headerTextColor, true, index),
  );
  resolved.rows.forEach((row, rowIndex) => {
    row
      .slice(0, columnCount)
      .forEach((text, cellIndex) =>
        cell(
          text,
          cellIndex * columnWidth,
          (rowIndex + 1) * rowHeight,
          rowIndex % 2 === 1 && element.style.bandingFill ? element.style.bandingFill : "#FFFFFF",
          element.style.bodyTextColor,
          element.style.firstColumnBold && cellIndex === 0,
          cellIndex,
        ),
      );
  });
}

/** A character of a text with the style it is drawn with. */
interface StyledCharacter {
  character: string;
  bold: boolean;
  color: string;
}

/** The characters of the text with the style of the fragment they belong to. */
function styledCharacters(element: TextElement): StyledCharacter[] {
  const characters: StyledCharacter[] = [];
  for (const fragment of textFragments(element.text, element.runs)) {
    const style = resolveFragmentStyle(element.style, fragment.style);
    for (const character of fragment.text) {
      characters.push({ character, bold: style.bold, color: style.color });
    }
  }
  return characters;
}

/**
 * The characters of a text, split into the paragraphs a line break in the
 * copy starts.
 */
function splitStyledParagraphs(characters: StyledCharacter[]): StyledCharacter[][] {
  const paragraphs: StyledCharacter[][] = [];
  let current: StyledCharacter[] = [];
  for (const styled of characters) {
    if (styled.character === "\n") {
      paragraphs.push(current);
      current = [];
      continue;
    }
    current.push(styled);
  }
  paragraphs.push(current);
  return paragraphs;
}

/**
 * Draws a text with its styled fragments.
 *
 * The review sees a picture of the page, so a text with emphasised words has
 * to be drawn here as well. The fragments come from the same runs the export
 * reads, so the reviewer judges the emphasis that will be in the file.
 *
 * Two rules keep the picture honest:
 *
 * - The line breaking uses the measurer the layout engine used, not the canvas
 *   metrics of this particular font size. A frame the layout measured as one
 *   line must not be painted as two: the second line used to be dropped, which
 *   silently cut the last characters of a sentence out of the preview.
 * - A block that still does not fit is set smaller, the way the exported
 *   `normAutofit` shrinks it, instead of being truncated at the frame edge. A
 *   page has to lose neither words nor their parity with the file.
 */
function drawText(
  context: CanvasRenderingContext2D,
  element: TextElement,
  width: number,
  height: number,
  scale: number,
): void {
  const nominal = (element.style.fontSizePt * scale * 914_400) / 72;
  const lineHeightRatio = element.style.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const metrics = runMetricsOf(element);
  const fit = fitTextToFrame(element.text, {
    width,
    height,
    fontSize: nominal,
    lineHeight: lineHeightRatio,
    fontFamily: element.style.fontFamily,
    bold: metrics.bold,
    letterSpacingPt: element.style.letterSpacingPt,
  });
  const fontSize = fit.fontSize;
  const fontFor = (bold: boolean) => `${bold ? 700 : 400} ${fontSize}px "${element.style.fontFamily}"`;
  const characters = styledCharacters(element);
  // Tracking the export writes as `charSpacing`. Chromium applies it between
  // glyphs, and `measureText` includes it, so the picture keeps the spacing the
  // file has instead of setting the title tighter than PowerPoint will.
  const trackingPx =
    element.style.letterSpacingPt === undefined || element.style.letterSpacingPt === 0
      ? 0
      : (element.style.letterSpacingPt * fontSize) / element.style.fontSizePt;
  if ("letterSpacing" in context) context.letterSpacing = trackingPx === 0 ? "0px" : `${trackingPx}px`;
  // Widths in em and the limit in em: the same numbers the fit above used, so
  // the two cannot disagree about where a line ends.
  const widthEm = Math.max(1, width / fontSize);
  const lines: StyledCharacter[][] = [];
  for (const paragraph of splitStyledParagraphs(characters)) {
    const atoms = paragraph.map((styled) => ({
      value: styled,
      text: styled.character,
      width: measureCharacterEm(
        styled.character,
        fontSize,
        { bold: styled.bold, ...metrics },
        element.style.fontFamily,
      ),
    }));
    if (atoms.length === 0) continue;
    for (const line of breakAtoms(atoms, widthEm)) lines.push(line.map((atom) => atom.value));
  }
  // The export honours an explicit leading; the review picture must use the
  // same one, or a page that fits in the file looks like it overflows here.
  const lineHeight = fontSize * lineHeightRatio;
  // The same two percent of slack the fit used, so the line it counted as
  // fitting is actually painted.
  const maxLines = Math.max(1, Math.floor((height + lineHeight * 0.02) / lineHeight));
  context.textBaseline = "top";
  context.textAlign = "left";
  lines.slice(0, maxLines).forEach((lineCharacters, lineIndex) => {
    // The alignment is measured with the advances the canvas actually paints:
    // the breaks come from the shared table above, but a line that is centred
    // must be centred on the glyphs the reader sees.
    const total = lineCharacters.reduce((sum, styled) => {
      context.font = fontFor(styled.bold);
      return sum + context.measureText(styled.character).width;
    }, 0);
    let x =
      element.style.align === "center" ? (width - total) / 2 : element.style.align === "right" ? width - total : 0;
    const y = lineIndex * lineHeight;
    let buffer = "";
    let bufferStyle = lineCharacters[0]!;
    const flush = () => {
      if (!buffer) return;
      context.font = fontFor(bufferStyle.bold);
      context.fillStyle = bufferStyle.color;
      context.fillText(buffer, x, y);
      x += context.measureText(buffer).width;
      buffer = "";
    };
    for (const styled of lineCharacters) {
      if (styled.bold !== bufferStyle.bold || styled.color !== bufferStyle.color) {
        flush();
        bufferStyle = styled;
      }
      buffer += styled.character;
    }
    flush();
  });
}

/**
 * Draws a built-in icon.
 *
 * Icons are their own element type, and the export writes them as an SVG
 * picture. The preview used to skip the type entirely, so a numbered badge that
 * the builder had replaced with an icon came out as an empty disc — the file had
 * a glyph, the page the user was looking at had none.
 */
function drawIcon(context: CanvasRenderingContext2D, element: IconElement, width: number, height: number): void {
  const definition = BUILTIN_ICONS[element.name];
  if (!definition) return;
  // The icon sits on a 24×24 grid. Scaling by the shorter side keeps it round in
  // a frame that is not square instead of stretching the drawing to the frame.
  const side = Math.min(width, height);
  context.save();
  context.translate((width - side) / 2, (height - side) / 2);
  context.scale(side / 24, side / 24);
  context.strokeStyle = element.style.color;
  context.lineWidth = element.style.strokeWidth ?? 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const path of definition.paths) {
    context.stroke(new Path2D(path));
  }
  for (const circle of definition.circles ?? []) {
    context.beginPath();
    context.arc(circle.cx, circle.cy, circle.r, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

/**
 * 把逐页评审图拼成一张缩略图墙。
 *
 * 评审模型需要一张能看完整册节奏的图：只给单页，它看不出相邻两页是不是
 * 长得一模一样。画布渲染和真实 PPTX 渲染共用这一段拼图逻辑，两条路给出的
 * 缩略图墙才是可比的。
 */
export function composeContactSheet(
  sources: Array<HTMLImageElement | HTMLCanvasElement>,
  pageSize: { width: number; height: number },
): string | undefined {
  if (sources.length === 0) return undefined;
  const thumbWidth = 320;
  const thumbHeight = Math.round((thumbWidth * pageSize.height) / pageSize.width);
  const columns = Math.min(4, Math.max(1, sources.length));
  const rows = Math.ceil(sources.length / columns);
  const sheet = window.document.createElement("canvas");
  sheet.width = columns * thumbWidth;
  sheet.height = rows * thumbHeight;
  const context = sheet.getContext("2d");
  if (!context) return undefined;
  sources.forEach((source, index) =>
    context.drawImage(
      source,
      (index % columns) * thumbWidth,
      Math.floor(index / columns) * thumbHeight,
      thumbWidth,
      thumbHeight,
    ),
  );
  return sheet.toDataURL("image/jpeg", 0.84);
}

/**
 * 用一组 data URL 重新拼缩略图墙。
 *
 * 增量渲染时只有变化页拿到了新图，未变化页沿用上一轮的 data URL；缩略图必须
 * 反映合并后的整册画面，不能停留在上一轮。
 */
export async function composeContactSheetFromDataUrls(
  slides: string[],
  pageSize: { width: number; height: number },
): Promise<string | undefined> {
  if (slides.length === 0) return undefined;
  const images = await Promise.all(slides.map(loadImage));
  return composeContactSheet(images, pageSize);
}

/**
 * 整册逐页渲染，不拼缩略图墙。
 *
 * 画廊预览只要每一页的画面；缩略图墙是给评审模型看整册节奏用的，打开预览不该
 * 为它多付一次拼图成本。逐页仍走 renderSlide，预览看到的就是质检看到的画面。
 */
export async function renderPresentationPages(document: PresentationDocument, width = 960): Promise<string[]> {
  const canvases = await Promise.all(document.slides.map((slide) => renderSlide(document, slide, width, true, true)));
  return canvases.map((canvas) => canvas.toDataURL("image/jpeg", 0.88));
}

export async function renderPresentationForVisualReview(
  document: PresentationDocument,
  width = 1280,
): Promise<PresentationRender> {
  const canvases = await Promise.all(document.slides.map((slide) => renderSlide(document, slide, width, true, true)));
  const slides = canvases.map((canvas) => canvas.toDataURL("image/jpeg", 0.88));
  const contactSheet = composeContactSheet(canvases, document.pageSize);
  if (!contactSheet) throw new Error("VISUAL_RENDER_CONTEXT_UNAVAILABLE");
  return { slides, contactSheet };
}
