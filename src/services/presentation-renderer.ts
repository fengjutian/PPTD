import {
  formatChartValue,
  resolveChartData,
  resolveFragmentStyle,
  resolveTableData,
  textFragments,
  type ChartElement,
  type PresentationDocument,
  type Slide,
  type TableElement,
  type TextElement,
} from "../core/document-model";
import { breakAtoms } from "../core/rendering/cjk-linebreak";
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
        context.drawImage(image, 0, 0, w, h);
      } catch (error) {
        // 评审图可以缺一张底图，整段质检不能因为一张图解码失败就中断。
        if (!tolerateImageErrors || !isImageRenderFailure(error)) throw error;
      }
    }
    if (element.type === "shape") {
      context.fillStyle = element.style.fill;
      if (element.shape === "ellipse") {
        context.beginPath();
        context.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        context.fill();
      } else {
        context.beginPath();
        context.roundRect(0, 0, w, h, element.style.radiusPt);
        context.fill();
      }
    }
    if (element.type === "text") drawText(context, element, w, h, sx);
    if (element.type === "chart") drawChart(context, element, slide, w, h);
    if (element.type === "table") drawTable(context, element, slide, w, h);
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
      if (element.type !== "text") continue;
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
      const requiredRatio = element.style.fontSizePt >= 24 || element.style.bold ? 3 : 4.5;
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
 * Draws a native chart as bars for the visual review.
 *
 * The review sees a picture of the page, so a chart has to be drawn here as
 * well. The numbers come from the same reviewed metric blocks the export
 * reads, so the reviewer judges the numbers that will be in the file.
 */
function drawChart(
  context: CanvasRenderingContext2D,
  element: ChartElement,
  slide: Slide,
  width: number,
  height: number,
): void {
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
    if (element.style.showValueLabels)
      context.fillText(
        formatChartValue(datum.value, resolved.unit),
        x + barWidth / 2,
        height - plotHeight - barHeight - 2,
      );
    context.fillText(datum.category.slice(0, 6), x + barWidth / 2, height);
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
): void {
  const resolved = resolveTableData(slide, element);
  if (!resolved) return;
  const columnCount = resolved.header.length;
  const rowCount = resolved.rows.length + 1;
  const columnWidth = width / columnCount;
  const rowHeight = height / rowCount;
  const fontSize = Math.max(9, Math.min(rowHeight * 0.6, (element.style.fontSizePt * height) / 400));
  context.font = `${fontSize}px "${element.style.fontFamily}"`;
  context.textBaseline = "middle";
  context.textAlign = "left";
  const cell = (text: string, x: number, y: number, fill: string, ink: string, bold: boolean) => {
    context.fillStyle = fill;
    context.fillRect(x, y, columnWidth, rowHeight);
    context.strokeStyle = element.style.borderColor;
    context.lineWidth = Math.max(1, height * 0.002);
    context.strokeRect(x, y, columnWidth, rowHeight);
    context.fillStyle = ink;
    context.font = `${bold ? 700 : 400} ${fontSize}px "${element.style.fontFamily}"`;
    context.fillText(text.slice(0, 12), x + columnWidth * 0.05, y + rowHeight / 2);
  };
  resolved.header.forEach((text, index) =>
    cell(text, index * columnWidth, 0, element.style.headerFill, element.style.headerTextColor, true),
  );
  resolved.rows.forEach((row, rowIndex) => {
    row
      .slice(0, columnCount)
      .forEach((text, cellIndex) =>
        cell(
          text,
          cellIndex * columnWidth,
          (rowIndex + 1) * rowHeight,
          "#FFFFFF",
          element.style.bodyTextColor,
          element.style.firstColumnBold && cellIndex === 0,
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
 */
function drawText(
  context: CanvasRenderingContext2D,
  element: TextElement,
  width: number,
  height: number,
  scale: number,
): void {
  const fontSize = (element.style.fontSizePt * scale * 914_400) / 72;
  const fontFor = (bold: boolean) => `${bold ? 700 : 400} ${fontSize}px "${element.style.fontFamily}"`;
  const characters = styledCharacters(element);
  // The same line breaker the layout engine uses, so the picture the reviewer
  // looks at breaks exactly where the quality gate counted the lines.
  const lines: StyledCharacter[][] = [];
  for (const paragraph of splitStyledParagraphs(characters)) {
    const atoms = paragraph.map((styled) => {
      context.font = fontFor(styled.bold);
      return { value: styled, text: styled.character, width: context.measureText(styled.character).width };
    });
    if (atoms.length === 0) continue;
    for (const line of breakAtoms(atoms, width)) lines.push(line.map((atom) => atom.value));
  }
  const lineHeight = fontSize * 1.25;
  context.textBaseline = "top";
  context.textAlign = "left";
  lines.slice(0, Math.max(1, Math.floor(height / lineHeight))).forEach((lineCharacters, lineIndex) => {
    const measure = (charactersOnLine: StyledCharacter[]) =>
      charactersOnLine.reduce((sum, styled) => {
        context.font = fontFor(styled.bold);
        return sum + context.measureText(styled.character).width;
      }, 0);
    const total = measure(lineCharacters);
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
