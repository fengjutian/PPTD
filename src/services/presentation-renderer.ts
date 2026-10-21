import { formatChartValue, resolveChartData, type ChartElement, type PresentationDocument, type Slide, type TextElement } from "../core/document-model";

export interface PresentationRender { slides: string[]; contactSheet: string }
export interface RenderedContrastIssue { slideIndex: number; elementId: string; contrastRatio: number; /** The sampled artwork color that carries the text. */ backgroundColor: string }

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("VISUAL_RENDER_IMAGE_FAILED")); image.src = source; });
}

function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const character of paragraph) {
      if (line && context.measureText(line + character).width > width) { lines.push(line); line = character; } else line += character;
    }
    lines.push(line);
  }
  return lines;
}

async function renderSlide(document: PresentationDocument, slide: Slide, width: number, includeText = true): Promise<HTMLCanvasElement> {
  const height = Math.round(width * document.pageSize.height / document.pageSize.width);
  const canvas = window.document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d"); if (!context) throw new Error("VISUAL_RENDER_CONTEXT_UNAVAILABLE");
  context.fillStyle = slide.background; context.fillRect(0, 0, width, height);
  const sx = width / document.pageSize.width; const sy = height / document.pageSize.height;
  for (const element of slide.elements) {
    if (!includeText && element.type === "text") continue;
    const x = element.frame.x * sx; const y = element.frame.y * sy; const w = element.frame.width * sx; const h = element.frame.height * sy;
    context.save(); context.translate(x + w / 2, y + h / 2); context.rotate(element.rotationMilliDegree * Math.PI / 180_000); context.translate(-w / 2, -h / 2);
    if (element.type === "image") { const image = await loadImage(element.source.dataUrl); context.drawImage(image, 0, 0, w, h); }
    if (element.type === "shape") { context.fillStyle = element.style.fill; if (element.shape === "ellipse") { context.beginPath(); context.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); context.fill(); } else { context.beginPath(); context.roundRect(0, 0, w, h, element.style.radiusPt); context.fill(); } }
    if (element.type === "text") drawText(context, element, w, h, sx);
    if (element.type === "chart") drawChart(context, element, slide, w, h);
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

const relativeLuminance = ([red, green, blue]: [number, number, number]): number => [red, green, blue]
  .map((channel) => { const normalized = channel / 255; return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4; })
  .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0);

export function renderedContrastRatio(foreground: [number, number, number], background: [number, number, number]): number {
  const first = relativeLuminance(foreground); const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Samples the actual rendered pixels beneath text, including template artwork and panels. */
export async function inspectRenderedTextContrast(document: PresentationDocument, width = 640): Promise<RenderedContrastIssue[]> {
  const issues: RenderedContrastIssue[] = [];
  for (let slideIndex = 0; slideIndex < document.slides.length; slideIndex += 1) {
    const slide = document.slides[slideIndex]!;
    const canvas = await renderSlide(document, slide, width, false);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("VISUAL_RENDER_CONTEXT_UNAVAILABLE");
    const sx = canvas.width / document.pageSize.width; const sy = canvas.height / document.pageSize.height;
    for (const element of slide.elements) {
      if (element.type !== "text") continue;
      const foreground = parseHexColor(element.style.color); if (!foreground) continue;
      const x = element.frame.x * sx; const y = element.frame.y * sy; const boxWidth = element.frame.width * sx; const boxHeight = element.frame.height * sy;
      const samples: Array<{ ratio: number; rgb: [number, number, number] }> = [];
      for (const xFactor of [0.15, 0.5, 0.85]) for (const yFactor of [0.2, 0.5, 0.8]) {
        const sampleX = Math.max(0, Math.min(canvas.width - 1, Math.round(x + boxWidth * xFactor)));
        const sampleY = Math.max(0, Math.min(canvas.height - 1, Math.round(y + boxHeight * yFactor)));
        const pixel = context.getImageData(sampleX, sampleY, 1, 1).data;
        const rgb: [number, number, number] = [pixel[0]!, pixel[1]!, pixel[2]!];
        samples.push({ ratio: renderedContrastRatio(foreground, rgb), rgb });
      }
      samples.sort((left, right) => left.ratio - right.ratio);
      const worst = samples[Math.floor(samples.length * 0.25)]!;
      const requiredRatio = element.style.fontSizePt >= 24 || element.style.bold ? 3 : 4.5;
      if (worst.ratio < requiredRatio) {
        const backgroundColor = `#${worst.rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
        issues.push({ slideIndex, elementId: element.id, contrastRatio: worst.ratio, backgroundColor });
      }
    }
  }
  return issues;
}

/**
 * Draws a native chart as bars for the visual review.
 *
 * The review sees a picture of the page, so a chart has to be drawn here as
 * well. The numbers come from the same reviewed metric blocks the export
 * reads, so the reviewer judges the numbers that will be in the file.
 */
function drawChart(context: CanvasRenderingContext2D, element: ChartElement, slide: Slide, width: number, height: number): void {
  const resolved = resolveChartData(slide, element);
  if (!resolved) return;
  const max = Math.max(...resolved.data.map((datum) => Math.abs(datum.value)), 1);
  const slot = width / resolved.data.length;
  const plotHeight = height * 0.72;
  const labelSize = Math.max(9, height * 0.06);
  context.font = `${labelSize}px "${element.style.fontFamily}"`;
  context.textBaseline = "bottom";
  context.textAlign = "center";
  resolved.data.forEach((datum, index) => {
    const barWidth = slot * 0.56;
    const barHeight = (Math.abs(datum.value) / max) * plotHeight;
    const x = index * slot + (slot - barWidth) / 2;
    context.fillStyle = element.style.seriesColors[index % element.style.seriesColors.length] ?? "#3366CC";
    context.fillRect(x, height - plotHeight - barHeight, barWidth, barHeight);
    context.fillStyle = element.style.textColor;
    if (element.style.showValueLabels) context.fillText(formatChartValue(datum.value, resolved.unit), x + barWidth / 2, height - plotHeight - barHeight - 2);
    context.fillText(datum.category.slice(0, 6), x + barWidth / 2, height);
  });
}

function drawText(context: CanvasRenderingContext2D, element: TextElement, width: number, height: number, scale: number): void {
  const fontSize = element.style.fontSizePt * scale * 914_400 / 72;
  context.font = `${element.style.bold ? 700 : 400} ${fontSize}px "${element.style.fontFamily}"`;
  context.fillStyle = element.style.color; context.textBaseline = "top"; context.textAlign = element.style.align;
  const x = element.style.align === "center" ? width / 2 : element.style.align === "right" ? width : 0;
  const lineHeight = fontSize * 1.25;
  wrapText(context, element.text, width).slice(0, Math.max(1, Math.floor(height / lineHeight))).forEach((line, index) => context.fillText(line, x, index * lineHeight));
}

export async function renderPresentationForVisualReview(document: PresentationDocument, width = 1280): Promise<PresentationRender> {
  const canvases = await Promise.all(document.slides.map((slide) => renderSlide(document, slide, width)));
  const slides = canvases.map((canvas) => canvas.toDataURL("image/jpeg", 0.88));
  const thumbWidth = 320; const thumbHeight = Math.round(thumbWidth * document.pageSize.height / document.pageSize.width); const columns = Math.min(4, canvases.length); const rows = Math.ceil(canvases.length / columns);
  const sheet = window.document.createElement("canvas"); sheet.width = columns * thumbWidth; sheet.height = rows * thumbHeight;
  const context = sheet.getContext("2d"); if (!context) throw new Error("VISUAL_RENDER_CONTEXT_UNAVAILABLE");
  canvases.forEach((canvas, index) => context.drawImage(canvas, index % columns * thumbWidth, Math.floor(index / columns) * thumbHeight, thumbWidth, thumbHeight));
  return { slides, contactSheet: sheet.toDataURL("image/jpeg", 0.84) };
}
