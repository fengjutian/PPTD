import type { PresentationDocument, Slide, TextElement } from "../core/document-model";

export interface PresentationRender { slides: string[]; contactSheet: string }
export interface RenderedContrastIssue { slideIndex: number; elementId: string; contrastRatio: number }

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
      const ratios: number[] = [];
      for (const xFactor of [0.15, 0.5, 0.85]) for (const yFactor of [0.2, 0.5, 0.8]) {
        const sampleX = Math.max(0, Math.min(canvas.width - 1, Math.round(x + boxWidth * xFactor)));
        const sampleY = Math.max(0, Math.min(canvas.height - 1, Math.round(y + boxHeight * yFactor)));
        const pixel = context.getImageData(sampleX, sampleY, 1, 1).data;
        ratios.push(renderedContrastRatio(foreground, [pixel[0]!, pixel[1]!, pixel[2]!]));
      }
      ratios.sort((left, right) => left - right);
      const representativeRatio = ratios[Math.floor(ratios.length * 0.25)]!;
      const requiredRatio = element.style.fontSizePt >= 24 || element.style.bold ? 3 : 4.5;
      if (representativeRatio < requiredRatio) issues.push({ slideIndex, elementId: element.id, contrastRatio: representativeRatio });
    }
  }
  return issues;
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
