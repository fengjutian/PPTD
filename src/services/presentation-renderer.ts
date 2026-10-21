import type { PresentationDocument, Slide, TextElement } from "../core/document-model";

export interface PresentationRender { slides: string[]; contactSheet: string }

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

async function renderSlide(document: PresentationDocument, slide: Slide, width: number): Promise<HTMLCanvasElement> {
  const height = Math.round(width * document.pageSize.height / document.pageSize.width);
  const canvas = window.document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d"); if (!context) throw new Error("VISUAL_RENDER_CONTEXT_UNAVAILABLE");
  context.fillStyle = slide.background; context.fillRect(0, 0, width, height);
  const sx = width / document.pageSize.width; const sy = height / document.pageSize.height;
  for (const element of slide.elements) {
    const x = element.frame.x * sx; const y = element.frame.y * sy; const w = element.frame.width * sx; const h = element.frame.height * sy;
    context.save(); context.translate(x + w / 2, y + h / 2); context.rotate(element.rotationMilliDegree * Math.PI / 180_000); context.translate(-w / 2, -h / 2);
    if (element.type === "image") { const image = await loadImage(element.source.dataUrl); context.drawImage(image, 0, 0, w, h); }
    if (element.type === "shape") { context.fillStyle = element.style.fill; if (element.shape === "ellipse") { context.beginPath(); context.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); context.fill(); } else { context.beginPath(); context.roundRect(0, 0, w, h, element.style.radiusPt); context.fill(); } }
    if (element.type === "text") drawText(context, element, w, h, sx);
    context.restore();
  }
  return canvas;
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
