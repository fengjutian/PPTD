import type { ElementId, Emu, PresentationDocument, RectEmu, SlideId, SupportedImageMimeType } from "../document-model";
import { createSlide, inches } from "../document-model";

export type ChangeDomain = "content" | "design" | "both";
export type AiContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "bullet-list"; items: string[] }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "metric"; label: string; value: string }
  | { type: "timeline"; items: Array<{ label: string; text: string }> }
  | { type: "comparison"; leftLabel: string; rightLabel: string; leftItems: string[]; rightItems: string[] }
  | { type: "process"; items: Array<{ label: string; text: string }> };
export interface AiSlideDraft { title: string; body: string; speakerNotes: string; blocks?: AiContentBlock[]; plan?: { visualIntent: "hero" | "quote" | "timeline" | "comparison" | "process" | "data-chart" | "image-story" | "summary" | "structured-text" } }
export type AiLayoutKind = "cover" | "title-body" | "split" | "cards" | "quote" | "section" | "summary";
export interface AiNormalizedRect { x: number; y: number; width: number; height: number }
export type AiElementRepair =
  | { action: "move" | "resize"; target: "title" | "body"; frame: AiNormalizedRect }
  | { action: "restyle"; target: "title" | "body"; fontScale?: number; color?: string }
  | { action: "changeLayout"; layout: AiLayoutKind };
export interface AiSlideDesign {
  layout: AiLayoutKind;
  background: string;
  accent: string;
  titleColor: string;
  bodyColor: string;
  safeRegion?: AiNormalizedRect;
  obstacleRegions?: AiNormalizedRect[];
  hierarchyAction?: "keep" | "strengthen-title" | "reduce-density" | "increase-whitespace";
  backgroundTreatment?: "none" | "content-panel" | "simplify";
  elementRepairs?: AiElementRepair[];
}
export interface AiTemplateRegion { role: "title" | "body" | "image"; frame: { x: number; y: number; width: number; height: number } }
export interface AiTemplateDecoration { shape: "rectangle" | "ellipse"; fill: string; frame: { x: number; y: number; width: number; height: number } }
export interface AiTemplateLayout { index: number; name?: string; backgroundColor?: string; backgroundImageDataUrl?: string; decorations?: AiTemplateDecoration[]; regions: AiTemplateRegion[] }

export type DocumentCommand =
  | { type: "add-slide" }
  | { type: "apply-ai-draft"; title: string; slides: AiSlideDraft[] }
  | { type: "apply-ai-designed-draft"; title: string; slides: AiSlideDraft[]; designs: AiSlideDesign[]; pageSize?: { width: Emu; height: Emu }; fontFamily?: string; templateDecorations?: AiTemplateDecoration[]; templateLayouts?: AiTemplateLayout[] }
  | { type: "duplicate-slide"; slideId: SlideId }
  | { type: "delete-slide"; slideId: SlideId }
  | { type: "move-slide"; slideId: SlideId; toIndex: number }
  | { type: "set-slide"; slideId: SlideId }
  | { type: "add-text"; slideId: SlideId }
  | { type: "add-image"; slideId: SlideId; dataUrl: string; mimeType: SupportedImageMimeType; altText: string }
  | { type: "add-shape"; slideId: SlideId; shape: "rectangle" | "ellipse" }
  | { type: "duplicate-element"; slideId: SlideId; elementId: ElementId }
  | { type: "delete-element"; slideId: SlideId; elementId: ElementId }
  | { type: "set-element-lock"; slideId: SlideId; elementId: ElementId; locked: boolean }
  | { type: "transform-element"; slideId: SlideId; elementId: ElementId; frame: RectEmu; rotationMilliDegree: number }
  | { type: "move-element"; slideId: SlideId; elementId: ElementId; x: Emu; y: Emu }
  | { type: "edit-text"; slideId: SlideId; elementId: ElementId; text: string };

export function commandDomain(command: DocumentCommand, document?: PresentationDocument): ChangeDomain | null {
  switch (command.type) {
    case "set-slide": return null;
    case "edit-text":
    case "delete-element": {
      if (!document) return command.type === "edit-text" ? "content" : "design";
      const slide = document.slides.find((item) => item.id === command.slideId);
      const element = slide?.elements.find((item) => item.id === command.elementId);
      return element?.type === "text" && (element.contentRef === "title" || element.contentRef === "body") ? "content" : "design";
    }
    case "add-text": return "design";
    case "add-image": return "design";
    case "add-slide": return "both";
    case "apply-ai-draft": return "both";
    case "apply-ai-designed-draft": return "both";
    case "duplicate-slide": return "both";
    case "delete-slide": return "both";
    case "move-slide": return "both";
    default: return "design";
  }
}

export function applyCommand(document: PresentationDocument, command: DocumentCommand): void {
  if (command.type === "set-slide") return;
  if (command.type === "add-slide") {
    document.slides.push(createSlide(document.slides.length + 1));
    return;
  }
  if (command.type === "apply-ai-draft") {
    if (!command.title.trim() || command.slides.length < 1 || command.slides.length > 20) throw new Error("AI_DRAFT_INVALID");
    document.title = command.title.trim();
    document.slides = command.slides.map((draft, index) => {
      const slide = createSlide(index + 1);
      slide.content = { title: draft.title, body: draft.body, speakerNotes: draft.speakerNotes, status: "approved" };
      const title = slide.elements[0];
      if (title?.type === "text") title.text = draft.title;
      if (draft.body.trim()) slide.elements.push({ id: crypto.randomUUID() as ElementId, type: "text", contentRef: "body", frame: { x: inches(0.9), y: inches(1.8), width: inches(10.8), height: inches(4.6) }, rotationMilliDegree: 0, locked: false, text: draft.body, style: { fontFamily: "Microsoft YaHei", fontSizePt: 20, color: "#262626", bold: false, align: "left" } });
      return slide;
    });
    return;
  }
  if (command.type === "apply-ai-designed-draft") {
    if (!command.title.trim() || command.slides.length < 1 || command.slides.length > 20 || command.designs.length !== command.slides.length) throw new Error("AI_DESIGN_INVALID");
    if (command.pageSize) document.pageSize = command.pageSize;
    const pageWidth = document.pageSize.width;
    const pageHeight = document.pageSize.height;
    const frame = (x: number, y: number, width: number, height: number): RectEmu => ({ x: Math.round(x * pageWidth) as Emu, y: Math.round(y * pageHeight) as Emu, width: Math.round(width * pageWidth) as Emu, height: Math.round(height * pageHeight) as Emu });
    const fittedFontSize = (value: string, box: RectEmu, preferredPt: number, minimumPt = 12): number => {
      const widthPt = box.width / 12_700;
      const heightPt = box.height / 12_700;
      const paragraphs = value.split("\n");
      for (let size = preferredPt; size >= minimumPt; size -= 1) {
        const unitsPerLine = Math.max(1, widthPt / (size * 0.92));
        const lineCount = paragraphs.reduce((total, paragraph) => {
          if (!paragraph) return total + 0.55;
          const units = [...paragraph].reduce((sum, character) => sum + (/^[\u0000-\u00ff]$/.test(character) ? 0.55 : 1), 0);
          return total + Math.max(1, Math.ceil(units / unitsPerLine));
        }, 0);
        if (lineCount * size * 1.2 <= heightPt) return size;
      }
      return minimumPt;
    };
    const text = (value: string, box: RectEmu, fontSizePt: number, color: string, bold: boolean, align: "left" | "center" | "right", contentRef?: "title" | "body" | "decorative") => ({ id: crypto.randomUUID() as ElementId, type: "text" as const, contentRef, frame: box, rotationMilliDegree: 0, locked: false, text: value, style: { fontFamily: command.fontFamily || "Microsoft YaHei", fontSizePt: fittedFontSize(value, box, fontSizePt), color, bold, align } });
    const shape = (box: RectEmu, fill: string, kind: "rectangle" | "ellipse" = "rectangle") => ({ id: crypto.randomUUID() as ElementId, type: "shape" as const, frame: box, rotationMilliDegree: 0, locked: false, shape: kind, style: { fill, stroke: fill, strokeWidthPt: 0, radiusPt: kind === "ellipse" ? 999 : 8 } });
    const points = (body: string) => body.split(/\n+|(?=\d+[.、]\s*)/).map((value) => value.trim()).filter(Boolean);
    document.title = command.title.trim();
    document.slides = command.slides.map((content, index) => {
      const design = command.designs[index]!;
      const slide = createSlide(index + 1);
      slide.background = design.background;
      slide.content = { ...content, status: "approved" };
      const items = points(content.body);
      const bodySize = content.body.length > 260 ? 15 : content.body.length > 150 ? 17 : 20;
      const blocks = content.blocks ?? [];
      const timelineBlock = blocks.find((block): block is Extract<AiContentBlock, { type: "timeline" }> => block.type === "timeline");
      const comparisonBlock = blocks.find((block): block is Extract<AiContentBlock, { type: "comparison" }> => block.type === "comparison");
      const processBlock = blocks.find((block): block is Extract<AiContentBlock, { type: "process" }> => block.type === "process");
      const metricBlocks = blocks.filter((block): block is Extract<AiContentBlock, { type: "metric" }> => block.type === "metric");
      const hasDeterministicBlock = Boolean(timelineBlock || comparisonBlock || processBlock || metricBlocks.length > 0);
      const visualLayouts = command.templateLayouts ?? [];
      const rankedLayouts = visualLayouts.filter((layout) => layout.regions.some((region) => region.role === "title"));
      const layoutIsCompatible = (layout: AiTemplateLayout): boolean => {
        const title = layout.regions.find((region) => region.role === "title")?.frame;
        const bodies = layout.regions.filter((region) => region.role === "body").map((region) => region.frame);
        const overlaps = (left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }) => left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
        if (!title || bodies.some((body) => overlaps(title, body))) return false;
        if (design.layout === "cover" || design.layout === "section") return true;
        if (bodies.length === 0) return false;
        return !((design.layout === "split" || comparisonBlock) && bodies.length < 2);
      };
      const layoutScore = (layout: AiTemplateLayout): number => {
        const name = (layout.name ?? "").toLowerCase();
        const bodies = layout.regions.filter((region) => region.role === "body").length;
        const images = layout.regions.filter((region) => region.role === "image").length;
        const keyword = (...values: string[]) => values.some((value) => name.includes(value));
        if (design.layout === "cover") return (keyword("title slide", "cover", "封面", "标题幻灯片") ? 100 : 0) + (bodies === 0 ? 20 : 0) + images * 5;
        if (design.layout === "section") return (keyword("section", "章节", "节标题") ? 100 : 0) + (bodies <= 1 ? 15 : 0);
        if (design.layout === "split" || comparisonBlock) return (keyword("comparison", "two content", "双栏", "比较", "对比") ? 100 : 0) + Math.min(bodies, 2) * 20;
        if (design.layout === "cards" || timelineBlock || processBlock || metricBlocks.length > 0) return (keyword("content", "卡片", "流程", "时间线") ? 30 : 0) + bodies * 15;
        if (design.layout === "quote") return (keyword("quote", "引言", "引用") ? 100 : 0) + (bodies === 1 ? 15 : 0);
        return (keyword("title and content", "标题和内容", "正文") ? 60 : 0) + (bodies === 1 ? 20 : 0);
      };
      const layoutHasSemanticGeometry = (layout: AiTemplateLayout): boolean => {
        const bodyCount = layout.regions.filter((region) => region.role === "body").length;
        if (design.layout === "cover" || design.layout === "section") return true;
        if (design.layout === "split" || comparisonBlock) return bodyCount >= 2;
        return bodyCount >= 1;
      };
      const chooseLayout = (layouts: AiTemplateLayout[], diversify = false) => {
        const sorted = [...layouts].sort((left, right) => layoutScore(right) - layoutScore(left) || left.index - right.index);
        if (!diversify || sorted.length < 2) return sorted[0];
        const bestScore = layoutScore(sorted[0]!);
        // Only rotate layouts with the same semantic score. This produces visual
        // rhythm without mixing cover, section and content artwork arbitrarily.
        const alignedVariants = sorted.filter((layout) => layoutScore(layout) === bestScore).slice(0, 3);
        return alignedVariants[index % alignedVariants.length];
      };
      const visualRecipe = chooseLayout(visualLayouts.filter(layoutHasSemanticGeometry), true) ?? chooseLayout(visualLayouts);
      // Rendered template backgrounds preserve complex master artwork, but OOXML placeholder
      // geometry is not reliable enough for editable text until inheritance is fully resolved.
      // Keep all editable text on deterministic, non-overlapping grids in that case.
      const recipe = visualRecipe?.backgroundImageDataUrl ? undefined : chooseLayout(rankedLayouts.filter(layoutIsCompatible));
      slide.background = visualRecipe?.backgroundColor ?? design.background;
      const contentTitleColor = visualRecipe?.backgroundImageDataUrl && design.backgroundTreatment !== "content-panel" ? "#FFFFFF" : design.titleColor;
      const recipeTitle = recipe?.regions.find((region) => region.role === "title")?.frame;
      const recipeBodies = recipe?.regions.filter((region) => region.role === "body").map((region) => region.frame) ?? [];
      const isSafeRegion = (candidate: { x: number; y: number; width: number; height: number } | undefined, minimumWidth: number, minimumHeight: number) => Boolean(candidate && candidate.x >= 0 && candidate.y >= 0 && candidate.width >= minimumWidth && candidate.height >= minimumHeight && candidate.x + candidate.width <= 1 && candidate.y + candidate.height <= 1);
      const safeFrame = (candidate: { x: number; y: number; width: number; height: number } | undefined, fallback: [number, number, number, number], minimumWidth = 0.25, minimumHeight = 0.08) => isSafeRegion(candidate, minimumWidth, minimumHeight) ? frame(candidate!.x, candidate!.y, candidate!.width, candidate!.height) : frame(...fallback);
      const [leftRecipe, rightRecipe] = recipeBodies;
      const hasSafeColumns = isSafeRegion(leftRecipe, 0.25, 0.25) && isSafeRegion(rightRecipe, 0.25, 0.25) && leftRecipe!.x + leftRecipe!.width <= rightRecipe!.x && Math.abs(leftRecipe!.y - rightRecipe!.y) < 0.18;
      const intersects = (left: AiNormalizedRect, right: AiNormalizedRect) => left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
      const insetObstacle = (region: AiNormalizedRect): AiNormalizedRect => ({ x: Math.max(0, region.x - 0.015), y: Math.max(0, region.y - 0.015), width: Math.min(1, region.width + 0.03), height: Math.min(1, region.height + 0.03) });
      const obstacles = (design.obstacleRegions ?? []).filter((region) => isSafeRegion(region, 0.001, 0.001)).map(insetObstacle);
      const largestFreeRegion = (source: AiNormalizedRect): AiNormalizedRect => {
        let candidates = [source];
        for (const obstacle of obstacles) {
          candidates = candidates.flatMap((candidate) => {
            if (!intersects(candidate, obstacle)) return [candidate];
            const right = candidate.x + candidate.width; const bottom = candidate.y + candidate.height;
            const obstacleRight = obstacle.x + obstacle.width; const obstacleBottom = obstacle.y + obstacle.height;
            return [
              { x: candidate.x, y: candidate.y, width: Math.max(0, obstacle.x - candidate.x), height: candidate.height },
              { x: Math.min(right, obstacleRight), y: candidate.y, width: Math.max(0, right - Math.max(candidate.x, obstacleRight)), height: candidate.height },
              { x: candidate.x, y: candidate.y, width: candidate.width, height: Math.max(0, obstacle.y - candidate.y) },
              { x: candidate.x, y: Math.min(bottom, obstacleBottom), width: candidate.width, height: Math.max(0, bottom - Math.max(candidate.y, obstacleBottom)) },
            ].filter((region) => region.width >= 0.28 && region.height >= 0.20);
          });
        }
        return candidates.sort((left, right) => right.width * right.height - left.width * left.height)[0] ?? source;
      };
      const requestedSafe = design.safeRegion && isSafeRegion(design.safeRegion, 0.30, 0.25) ? design.safeRegion : { x: 0.07, y: 0.12, width: 0.86, height: 0.75 };
      const visualSafe = largestFreeRegion(requestedSafe);
      const safeLeft = visualSafe?.x ?? 0.07; const safeRight = visualSafe ? visualSafe.x + visualSafe.width : 0.93; const safeTop = visualSafe?.y ?? 0.20; const safeBottom = visualSafe ? visualSafe.y + visualSafe.height : 0.87;
      const alignmentGrid = { left: safeLeft, right: safeRight, titleY: safeTop, titleHeight: Math.min(0.10, (safeBottom - safeTop) * 0.18), ruleY: safeTop + Math.min(0.12, (safeBottom - safeTop) * 0.22), contentY: safeTop + Math.min(0.17, (safeBottom - safeTop) * 0.30), contentBottom: safeBottom } as const;
      slide.elements = [];
      if (visualRecipe?.backgroundImageDataUrl) slide.elements.push({ id: crypto.randomUUID() as ElementId, type: "image", frame: frame(0, 0, 1, 1), rotationMilliDegree: 0, locked: true, source: { kind: "embedded", dataUrl: visualRecipe.backgroundImageDataUrl, mimeType: "image/png" }, altText: `模板版式背景：${visualRecipe.name ?? visualRecipe.index}` });
      if (design.backgroundTreatment === "content-panel") slide.elements.push(shape(frame(Math.max(0, safeLeft - 0.025), Math.max(0, safeTop - 0.035), Math.min(1 - Math.max(0, safeLeft - 0.025), safeRight - safeLeft + 0.05), Math.min(1 - Math.max(0, safeTop - 0.035), safeBottom - safeTop + 0.07)), "#F7F8FA"));
      const decorations = visualRecipe?.backgroundImageDataUrl ? [] : [...(command.templateDecorations ?? []), ...(visualRecipe?.decorations ?? [])];
      decorations.forEach((decoration) => {
        if (isSafeRegion(decoration.frame, 0.001, 0.001)) slide.elements.push(shape(frame(decoration.frame.x, decoration.frame.y, decoration.frame.width, decoration.frame.height), decoration.fill, decoration.shape));
      });
      if (design.layout === "cover" && !hasDeterministicBlock) {
        slide.elements.push(shape(frame(0, 0, 0.035, 1), design.accent), shape(frame(0.08, 0.70, 0.18, 0.018), design.accent));
        slide.elements.push(text(content.title, frame(0.10, 0.24, 0.78, 0.28), 42, design.titleColor, true, "left"));
        if (content.body.trim()) slide.elements.push(text(content.body, frame(0.10, 0.56, 0.72, 0.16), 19, design.bodyColor, false, "left"));
      } else if (design.layout === "section" && !hasDeterministicBlock) {
        slide.elements.push(shape(frame(0, 0, 0.32, 1), design.accent));
        slide.elements.push(text(String(index + 1).padStart(2, "0"), frame(0.07, 0.17, 0.16, 0.18), 52, "#FFFFFF", true, "left"));
        slide.elements.push(text(content.title, frame(0.39, 0.30, 0.50, 0.22), 36, design.titleColor, true, "left"));
        if (content.body.trim()) slide.elements.push(text(content.body, frame(0.39, 0.56, 0.47, 0.20), 18, design.bodyColor, false, "left"));
      } else if (timelineBlock) {
        const timelineItems = timelineBlock.items.slice(0, 6);
        slide.elements.push(text(content.title, frame(0.07, 0.07, 0.86, 0.12), 30, design.titleColor, true, "left"), shape(frame(0.07, 0.22, 0.12, 0.012), design.accent));
        const startX = 0.10; const endX = 0.90; const lineY = 0.48;
        slide.elements.push(shape(frame(startX, lineY, endX - startX, 0.008), design.accent));
        timelineItems.forEach((item, itemIndex) => {
          const x = timelineItems.length === 1 ? 0.50 : startX + itemIndex * ((endX - startX) / (timelineItems.length - 1));
          const above = itemIndex % 2 === 0;
          slide.elements.push(shape(frame(x - 0.012, lineY - 0.016, 0.024, 0.04), design.accent, "ellipse"));
          slide.elements.push(text(item.label, frame(x - 0.075, above ? 0.31 : 0.55, 0.15, 0.07), 15, design.accent, true, "center"));
          slide.elements.push(text(item.text, frame(x - 0.075, above ? 0.38 : 0.63, 0.15, 0.14), 13, design.bodyColor, false, "center"));
        });
      } else if (comparisonBlock) {
        slide.elements.push(text(content.title, frame(0.07, 0.07, 0.86, 0.12), 30, design.titleColor, true, "left"));
        const columns = [
          { x: 0.07, label: comparisonBlock.leftLabel, items: comparisonBlock.leftItems },
          { x: 0.53, label: comparisonBlock.rightLabel, items: comparisonBlock.rightItems },
        ];
        columns.forEach((column) => {
          slide.elements.push(shape(frame(column.x, 0.25, 0.40, 0.62), "#F3F5F7"), shape(frame(column.x, 0.25, 0.40, 0.075), design.accent));
          slide.elements.push(text(column.label, frame(column.x + 0.025, 0.263, 0.35, 0.05), 18, "#FFFFFF", true, "center"));
          slide.elements.push(text(column.items.slice(0, 7).map((item) => `• ${item}`).join("\n\n"), frame(column.x + 0.035, 0.36, 0.33, 0.44), 16, design.bodyColor, false, "left"));
        });
      } else if (metricBlocks.length > 0) {
        const metrics = metricBlocks.slice(0, 6); const columns = metrics.length > 3 ? 3 : metrics.length; const rows = Math.ceil(metrics.length / columns);
        slide.elements.push(text(content.title, frame(0.07, 0.07, 0.86, 0.12), 30, design.titleColor, true, "left"), shape(frame(0.07, 0.22, 0.12, 0.012), design.accent));
        metrics.forEach((metric, metricIndex) => {
          const column = metricIndex % columns; const row = Math.floor(metricIndex / columns); const width = 0.84 / columns - 0.025; const height = 0.56 / rows - 0.035; const x = 0.08 + column * (0.84 / columns); const y = 0.29 + row * (0.56 / rows);
          slide.elements.push(shape(frame(x, y, width, height), "#F3F5F7"), text(metric.value, frame(x + 0.025, y + 0.055, width - 0.05, height * 0.42), 30, design.accent, true, "center"), text(metric.label, frame(x + 0.025, y + height * 0.58, width - 0.05, height * 0.25), 15, design.bodyColor, false, "center"));
        });
      } else if (processBlock) {
        const processItems = processBlock.items.slice(0, 6); const width = 0.78 / Math.max(processItems.length, 1);
        slide.elements.push(text(content.title, frame(0.07, 0.07, 0.86, 0.12), 30, design.titleColor, true, "left"), shape(frame(0.07, 0.22, 0.12, 0.012), design.accent));
        processItems.forEach((item, itemIndex) => {
          const x = 0.07 + itemIndex * (0.86 / processItems.length);
          slide.elements.push(shape(frame(x, 0.35, width, 0.38), "#F3F5F7"), shape(frame(x + 0.02, 0.29, 0.055, 0.075), design.accent, "ellipse"));
          slide.elements.push(text(String(itemIndex + 1), frame(x + 0.025, 0.302, 0.045, 0.04), 15, "#FFFFFF", true, "center"), text(item.label, frame(x + 0.025, 0.40, width - 0.05, 0.08), 17, design.titleColor, true, "center"), text(item.text, frame(x + 0.025, 0.51, width - 0.05, 0.15), 14, design.bodyColor, false, "center"));
          if (itemIndex < processItems.length - 1) slide.elements.push(text("→", frame(x + width, 0.48, 0.86 / processItems.length - width, 0.08), 22, design.accent, true, "center"));
        });
      } else if (design.layout === "quote") {
        slide.elements.push(shape(frame(0.08, 0.16, 0.025, 0.68), design.accent));
        slide.elements.push(text(content.title, safeFrame(recipeTitle, [0.15, 0.12, 0.72, 0.13], 0.35, 0.08), 28, design.titleColor, true, "left"));
        if (content.body.trim()) slide.elements.push(text(content.body, safeFrame(recipeBodies[0], [0.15, 0.31, 0.68, 0.46], 0.35, 0.28), Math.max(18, bodySize), design.bodyColor, false, "left"));
      } else if (design.layout === "cards" && items.length > 1) {
        slide.elements.push(text(content.title, frame(alignmentGrid.left, alignmentGrid.titleY, Math.max(0.40, alignmentGrid.right - alignmentGrid.left - 0.10), alignmentGrid.titleHeight), 32, contentTitleColor, true, "left"), text(String(index + 1).padStart(2, "0"), frame(alignmentGrid.right - 0.07, alignmentGrid.titleY, 0.07, alignmentGrid.titleHeight), 14, contentTitleColor, true, "right"), shape(frame(alignmentGrid.left, alignmentGrid.ruleY, Math.min(0.12, (alignmentGrid.right - alignmentGrid.left) * 0.20), 0.009), design.accent));
        const visible = items.slice(0, 6);
        const columns = visible.length === 3 || visible.length >= 5 ? 3 : 2;
        const rows = Math.ceil(visible.length / columns);
        const contentWidth = alignmentGrid.right - alignmentGrid.left; const contentHeight = alignmentGrid.contentBottom - alignmentGrid.contentY;
        const columnGap = 0.022; const rowGap = 0.040;
        const cardWidth = (contentWidth - columnGap * (columns - 1)) / columns; const cardHeight = rows === 1 ? 0.19 : 0.18;
        const gridHeight = rows * cardHeight + (rows - 1) * rowGap; const gridTop = alignmentGrid.contentY + (contentHeight - gridHeight) / 2;
        visible.forEach((item, itemIndex) => {
          const row = Math.floor(itemIndex / columns); const column = itemIndex % columns;
          const rowItemCount = Math.min(columns, visible.length - row * columns);
          const rowWidth = rowItemCount * cardWidth + (rowItemCount - 1) * columnGap;
          const rowStart = alignmentGrid.left + (contentWidth - rowWidth) / 2;
          const x = rowStart + column * (cardWidth + columnGap); const y = gridTop + row * (cardHeight + rowGap);
          const cleanItem = item.replace(/^\d+[.、]\s*/, "");
          slide.elements.push(shape(frame(x, y, cardWidth, cardHeight), "#FFFFFF"), shape(frame(x, y, cardWidth, 0.008), design.accent), shape(frame(x + 0.025, y + 0.061, 0.032, 0.057), design.accent, "ellipse"));
          slide.elements.push(text(String(itemIndex + 1), frame(x + 0.027, y + 0.073, 0.028, 0.030), 12, "#FFFFFF", true, "center"), text(cleanItem, frame(x + 0.075, y + 0.045, cardWidth - 0.105, 0.095), 16, "#293241", true, "left"));
        });
      } else if (design.layout === "split" && items.length > 1) {
        slide.elements.push(text(content.title, safeFrame(recipeTitle, [0.07, 0.07, 0.84, 0.13], 0.35, 0.08), 30, design.titleColor, true, "left"), shape(frame(0.50, 0.25, 0.012, 0.60), design.accent));
        const middle = Math.ceil(items.length / 2); slide.elements.push(text(items.slice(0, middle).join("\n\n"), hasSafeColumns ? frame(leftRecipe!.x, leftRecipe!.y, leftRecipe!.width, leftRecipe!.height) : frame(0.08, 0.28, 0.36, 0.54), bodySize, design.bodyColor, false, "left"), text(items.slice(middle).join("\n\n"), hasSafeColumns ? frame(rightRecipe!.x, rightRecipe!.y, rightRecipe!.width, rightRecipe!.height) : frame(0.57, 0.28, 0.35, 0.54), bodySize, design.bodyColor, false, "left"));
      } else {
        slide.elements.push(text(content.title, safeFrame(recipeTitle, [alignmentGrid.left, alignmentGrid.titleY, alignmentGrid.right - alignmentGrid.left, alignmentGrid.titleHeight], 0.35, 0.08), 30, contentTitleColor, true, "left"), shape(frame(alignmentGrid.left, alignmentGrid.ruleY, Math.min(0.11, (alignmentGrid.right - alignmentGrid.left) * 0.20), 0.012), design.accent));
        if (content.body.trim()) slide.elements.push(text(content.body, safeFrame(recipeBodies[0], [alignmentGrid.left + 0.01, alignmentGrid.contentY, alignmentGrid.right - alignmentGrid.left - 0.02, alignmentGrid.contentBottom - alignmentGrid.contentY], 0.35, 0.28), bodySize, design.bodyColor, false, "left"));
      }
      // Link rendered title/body text back to semantic content. Structured\n      // layouts (cards, timeline items, metrics) stay decorative because one\n      // visual element cannot safely overwrite a multi-field content block.\n      for (const element of slide.elements) {\n        if (element.type !== "text") continue;\n        if (element.text === content.title) element.contentRef = "title";\n        else if (content.body.trim() && element.text === content.body) element.contentRef = "body";\n        else element.contentRef = "decorative";\n      }\n      const titleRepair = design.elementRepairs?.find((repair) => repair.action !== "changeLayout" && repair.target === "title");
      const bodyRepair = design.elementRepairs?.find((repair) => repair.action !== "changeLayout" && repair.target === "body");
      for (const element of slide.elements) {
        if (element.type !== "text") continue;
        const repair = element.text === content.title ? titleRepair : element.text === content.body ? bodyRepair : undefined;
        if (!repair) continue;
        if (repair.action === "move" || repair.action === "resize") {
          const collisionFreeFrame = obstacles.some((obstacle) => intersects(repair.frame, obstacle))
            ? repair.target === "title"
              ? { x: visualSafe.x, y: visualSafe.y, width: visualSafe.width, height: Math.min(0.14, visualSafe.height * 0.22) }
              : { x: visualSafe.x, y: visualSafe.y + Math.min(0.18, visualSafe.height * 0.28), width: visualSafe.width, height: Math.max(0.08, visualSafe.height - Math.min(0.18, visualSafe.height * 0.28)) }
            : repair.frame;
          element.frame = frame(collisionFreeFrame.x, collisionFreeFrame.y, collisionFreeFrame.width, collisionFreeFrame.height);
        }
        if (repair.action === "restyle") element.style = { ...element.style, fontSizePt: Math.max(12, element.style.fontSizePt * (repair.fontScale ?? 1)), color: repair.color ?? element.style.color };
      }
      if (design.hierarchyAction === "strengthen-title") {
        const title = slide.elements.find((element) => element.type === "text" && element.text === content.title);
        if (title?.type === "text") title.style = { ...title.style, fontSizePt: Math.min(44, title.style.fontSizePt * 1.15), bold: true };
      }
      if (design.hierarchyAction === "reduce-density") {
        const body = slide.elements.find((element) => element.type === "text" && element.text === content.body);
        if (body?.type === "text") body.frame = { ...body.frame, height: Math.max(body.frame.height, Math.round(pageHeight * 0.42)) as Emu };
      }
      if (design.hierarchyAction === "increase-whitespace") {
        const body = slide.elements.find((element) => element.type === "text" && element.text === content.body);
        if (body?.type === "text") body.frame = { ...body.frame, x: (body.frame.x + Math.round(pageWidth * 0.025)) as Emu, width: Math.max(Math.round(pageWidth * 0.30), body.frame.width - Math.round(pageWidth * 0.05)) as Emu };
      }
      return slide;
    });
    return;
  }
  if (command.type === "duplicate-slide") {
    const sourceIndex = document.slides.findIndex((item) => item.id === command.slideId);
    if (sourceIndex < 0) throw new Error("SLIDE_NOT_FOUND");
    const source = document.slides[sourceIndex]!;
    const duplicate = {
      ...source,
      id: crypto.randomUUID() as SlideId,
      content: { ...source.content },
      elements: source.elements.map((element) => element.type === "text"
        ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame }, style: { ...element.style } }
        : element.type === "shape"
          ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame }, style: { ...element.style } }
          : { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame }, source: { ...element.source } }),
    };
    document.slides.splice(sourceIndex + 1, 0, duplicate);
    return;
  }
  if (command.type === "delete-slide") {
    if (document.slides.length === 1) throw new Error("LAST_SLIDE_CANNOT_BE_DELETED");
    const sourceIndex = document.slides.findIndex((item) => item.id === command.slideId);
    if (sourceIndex < 0) throw new Error("SLIDE_NOT_FOUND");
    document.slides.splice(sourceIndex, 1);
    return;
  }
  if (command.type === "move-slide") {
    const sourceIndex = document.slides.findIndex((item) => item.id === command.slideId);
    if (sourceIndex < 0) throw new Error("SLIDE_NOT_FOUND");
    if (!Number.isInteger(command.toIndex) || command.toIndex < 0 || command.toIndex >= document.slides.length) {
      throw new Error("SLIDE_INDEX_OUT_OF_RANGE");
    }
    if (sourceIndex === command.toIndex) return;
    const [slide] = document.slides.splice(sourceIndex, 1);
    document.slides.splice(command.toIndex, 0, slide!);
    return;
  }
  const slide = document.slides.find((item) => item.id === command.slideId);
  if (!slide) throw new Error("SLIDE_NOT_FOUND");

  if (command.type === "add-text") {
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "text",
      frame: { x: inches(1), y: inches(1.8), width: inches(4), height: inches(0.65) },
      rotationMilliDegree: 0,
      locked: false,
      text: "新文本",
      contentRef: "decorative",
      style: { fontFamily: "Microsoft YaHei", fontSizePt: 20, color: "#17181c", bold: false, align: "left" },
    });
    return;
  }
  if (command.type === "add-image") {
    const expectedPrefix = `data:${command.mimeType};base64,`;
    const payload = command.dataUrl.slice(expectedPrefix.length);
    if (!command.dataUrl.startsWith(expectedPrefix) || command.dataUrl.length > 360_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload) || command.altText.length > 500) {
      throw new Error("INVALID_IMAGE_SOURCE");
    }
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "image",
      frame: { x: inches(2), y: inches(1.7), width: inches(4), height: inches(3) },
      rotationMilliDegree: 0,
      locked: false,
      source: { kind: "embedded", dataUrl: command.dataUrl, mimeType: command.mimeType },
      altText: command.altText,
    });
    return;
  }
  if (command.type === "add-shape") {
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "shape",
      shape: command.shape,
      frame: { x: inches(4), y: inches(2.4), width: inches(2.4), height: inches(1.4) },
      rotationMilliDegree: 0,
      locked: false,
      style: { fill: "#d35230", stroke: "#7f2f1d", strokeWidthPt: 1.5, radiusPt: 12 },
    });
    return;
  }

  const element = slide.elements.find((item) => item.id === command.elementId);
  if (!element) throw new Error("ELEMENT_NOT_FOUND");
  if (command.type === "set-element-lock") {
    element.locked = command.locked;
    return;
  }
  if (element.locked) throw new Error("ELEMENT_LOCKED");
  if (command.type === "duplicate-element") {
    const sourceIndex = slide.elements.findIndex((item) => item.id === command.elementId);
    const offset = inches(0.2);
    const duplicate = element.type === "text"
      ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame, x: (element.frame.x + offset) as Emu, y: (element.frame.y + offset) as Emu }, style: { ...element.style } }
      : element.type === "shape"
        ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame, x: (element.frame.x + offset) as Emu, y: (element.frame.y + offset) as Emu }, style: { ...element.style } }
        : { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame, x: (element.frame.x + offset) as Emu, y: (element.frame.y + offset) as Emu }, source: { ...element.source } };
    slide.elements.splice(sourceIndex + 1, 0, duplicate);
    return;
  }
  if (command.type === "delete-element") {
    if (element.type === "text") {
      if (element.contentRef === "title") slide.content.title = "";
      if (element.contentRef === "body") slide.content.body = "";
    }
    slide.elements.splice(slide.elements.findIndex((item) => item.id === command.elementId), 1);
    return;
  }
  if (command.type === "move-element") {
    if (!Number.isSafeInteger(command.x) || !Number.isSafeInteger(command.y)) throw new Error("INVALID_ELEMENT_TRANSFORM");
    element.frame = { ...element.frame, x: command.x, y: command.y };
  }
  if (command.type === "transform-element") {
    const values = [command.frame.x, command.frame.y, command.frame.width, command.frame.height, command.rotationMilliDegree];
    if (!values.every(Number.isSafeInteger) || command.frame.width <= 0 || command.frame.height <= 0) {
      throw new Error("INVALID_ELEMENT_TRANSFORM");
    }
    element.frame = { ...command.frame };
    element.rotationMilliDegree = command.rotationMilliDegree;
  }
  if (command.type === "edit-text") {
    if (element.type !== "text") throw new Error("ELEMENT_NOT_TEXT");
    element.text = command.text;
    const contentBound = element.contentRef === "title" || element.contentRef === "body" || (!element.contentRef && slide.elements[0]?.id === element.id);
    if (element.contentRef === "title" || (!element.contentRef && slide.elements[0]?.id === element.id)) slide.content.title = command.text;
    if (element.contentRef === "body") slide.content.body = command.text;
    if (contentBound && slide.content.status === "approved") slide.content.status = "changed";
  }
}
