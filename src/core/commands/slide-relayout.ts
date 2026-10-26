import type {
  ElementOrigin,
  PresentationDocument,
  RectEmu,
  Slide,
  SlideElement,
  SlideLayoutSpec,
  TextElement,
} from "../document-model";
import { colorLuminance, readableTextColor, type BackgroundRange } from "../rendering/contrast";
import { LAYOUT_CAPACITY } from "./layout-capacity";
import type { AiLayoutKind, AiSlideDesign, AiTemplateLayout, AiTemplateRegion } from "./template-layouts";

export interface RelayoutContext {
  design: AiSlideDesign;
  templateLayout: AiTemplateLayout;
  fontFamily?: string;
  bodyFontFamily?: string;
}

export interface RelayoutElements {
  generated: SlideElement[];
  preserved: SlideElement[];
}

/** One entry of the page-layout picker, with the reason a layout cannot be used. */
export interface SlideLayoutOption {
  layout: SlideLayoutSpec;
  current: boolean;
  issue?: string;
}

const DEFAULT_TITLE = { x: 0.08, y: 0.08, width: 0.84, height: 0.12 };
const DEFAULT_BODY = { x: 0.08, y: 0.26, width: 0.84, height: 0.58 };
const NEUTRAL_COLORS = new Set([
  "#FFFFFF",
  "#F3F5F7",
  "#E2E7EC",
  "#000000",
  "#111111",
  "#171A1F",
  "#17181C",
  "#262626",
  "#293241",
  "#30343A",
  "#333333",
  "#3E4650",
  "#DCE3EA",
]);

function normalizedFrame(frame: RectEmu, pageSize: PresentationDocument["pageSize"]): AiTemplateRegion["frame"] {
  const x = Math.min(0.99, Math.max(0, frame.x / pageSize.width));
  const y = Math.min(0.99, Math.max(0, frame.y / pageSize.height));
  return {
    x,
    y,
    width: Math.max(0.01, Math.min(1 - x, frame.width / pageSize.width)),
    height: Math.max(0.01, Math.min(1 - y, frame.height / pageSize.height)),
  };
}

function unionFrames(frames: AiTemplateRegion["frame"][]): AiTemplateRegion["frame"] | undefined {
  if (frames.length === 0) return undefined;
  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
  return {
    x: Math.max(0, left),
    y: Math.max(0, top),
    width: Math.max(0.01, Math.min(1, right) - Math.max(0, left)),
    height: Math.max(0.01, Math.min(1, bottom) - Math.max(0, top)),
  };
}

function contains(outer: RectEmu, inner: RectEmu): boolean {
  const tolerance = 9144; // 0.01 inch
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

function intersects(left: RectEmu, right: RectEmu): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function isLayoutBackground(element: SlideElement): boolean {
  return element.type === "image" && element.placement === "layout-background";
}

function fixedGeneratedText(value: string): boolean {
  return /^(?:\d{1,2}|[“”"'‘’「」『』]|关键摘录|项要点|本页要点|→|•)$/u.test(value.trim());
}

/** The reviewed copy of the page, without presentation prefixes such as "1. ". */
function reviewedText(slide: Slide): string {
  const values: string[] = [slide.content.title, slide.content.body];
  for (const block of slide.content.blocks ?? []) {
    if (block.type === "paragraph") values.push(block.text);
    else if (block.type === "bullet-list") values.push(...block.items);
    else if (block.type === "quote") values.push(block.text, block.attribution ?? "");
    else if (block.type === "metric") values.push(block.label, block.value);
    else if (block.type === "timeline" || block.type === "process")
      values.push(...block.items.flatMap((item) => [item.label, item.text]));
    else if (block.type === "comparison")
      values.push(block.leftLabel, block.rightLabel, ...block.leftItems, ...block.rightItems);
    else if (block.type === "table-data") values.push(...block.header, ...block.rows.flat());
    else if (block.type === "chart")
      values.push(
        ...block.categories,
        ...(block.values?.map((value) => String(value)) ?? []),
        ...(block.series?.flatMap((item) => [item.name, ...item.values.map((value) => String(value))]) ?? []),
        block.unit ?? "",
      );
  }
  return values.join("\n");
}

function textFromReviewedCopy(text: string, reviewed: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (reviewed.includes(trimmed)) return true;
  const withoutPrefix = trimmed.replace(/^[\s•·\-–—\d.、]+/u, "").trim();
  return withoutPrefix.length >= 2 && reviewed.includes(withoutPrefix);
}

/**
 * Older documents predate `origin`. Their generated decorative text sits inside
 * the generated cards/panels, while user copy is normally placed on the page
 * itself. This inference is deliberately conservative: an undecided object is
 * kept rather than silently deleted.
 */
export function classifyRelayoutElements(slide: Slide): RelayoutElements {
  const generated = new Set<string>();
  const preserved = new Set<string>();
  const reviewed = reviewedText(slide);
  const decide = (element: SlideElement, origin: ElementOrigin) => {
    if (generated.has(element.id) || preserved.has(element.id)) return;
    if (origin === "generated") generated.add(element.id);
    else preserved.add(element.id);
  };

  for (const element of slide.elements) {
    if (isLayoutBackground(element)) {
      decide(element, "generated");
      continue;
    }
    // A lock is a user's explicit request to protect an object.
    if (element.locked) {
      decide(element, "user");
      continue;
    }
    // The title/body placeholders are the content binding: relayout redraws
    // them from the reviewed content even when an older factory marked the
    // default title as user-owned.
    if (element.type === "text" && (element.contentRef === "title" || element.contentRef === "body")) {
      decide(element, "generated");
      continue;
    }
    // Content pictures are carried over rather than regenerated. The relayout
    // command has no visual assets to re-place them with, so trusting the
    // "generated" origin silently deleted every AI photo from the page.
    // Layout/slide backgrounds are handled above and stay generated.
    if (element.type === "image" && element.placement !== "slide-background") {
      decide(element, "user");
      continue;
    }
    if (element.origin) {
      decide(element, element.origin);
      continue;
    }
    if (element.type === "image") {
      decide(element, "user");
      continue;
    }
    if (element.type === "chart") {
      decide(element, "generated");
      continue;
    }
    if (element.type === "text" && fixedGeneratedText(element.text)) {
      decide(element, "generated");
      continue;
    }
    // Legacy editorial pages keep their list copy in decorative text boxes.
    // When the string is verbatim reviewed copy, it belongs to the generated
    // composition, not to a hand-written note.
    if (
      element.type === "text" &&
      element.contentRef === "decorative" &&
      textFromReviewedCopy(element.text, reviewed)
    ) {
      decide(element, "generated");
    }
  }

  // Decorative text that sits inside a shape belongs to a generated card,
  // metric, quote panel or process step. The shape is then generated too, and
  // rules/panels that overlap it follow in the next pass.
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of slide.elements) {
      if (generated.has(element.id) || preserved.has(element.id)) continue;
      if (element.type === "text" && element.contentRef === "decorative") {
        const insideShape = slide.elements.some(
          (candidate) => candidate.type === "shape" && contains(candidate.frame, element.frame),
        );
        if (insideShape) {
          generated.add(element.id);
          changed = true;
        }
      }
    }
    for (const element of slide.elements) {
      if (generated.has(element.id) || preserved.has(element.id)) continue;
      if (element.type !== "shape") continue;
      const containsGenerated = slide.elements.some(
        (candidate) => generated.has(candidate.id) && contains(element.frame, candidate.frame),
      );
      const overlapsGenerated = slide.elements.some(
        (candidate) =>
          generated.has(candidate.id) && candidate.type === "shape" && intersects(element.frame, candidate.frame),
      );
      if (containsGenerated || overlapsGenerated) {
        generated.add(element.id);
        changed = true;
      }
    }
  }

  const result: RelayoutElements = { generated: [], preserved: [] };
  for (const element of slide.elements) {
    if (generated.has(element.id)) result.generated.push(element);
    else result.preserved.push(element);
  }
  return result;
}

function layoutName(slide: Slide, document: PresentationDocument): string {
  return document.layouts?.find((layout) => layout.id === slide.layoutId)?.name ?? "";
}

/** The points the page actually carries, used to decide whether two columns fit. */
function contentItems(slide: Slide): string[] {
  const bulletItems = (slide.content.blocks ?? []).flatMap((block) =>
    block.type === "bullet-list" ? block.items : [],
  );
  if (bulletItems.length > 0) return bulletItems;
  return slide.content.body
    .split(/\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasBodyContent(slide: Slide): boolean {
  return slide.content.body.trim().length > 0 || (slide.content.blocks?.length ?? 0) > 0;
}

/** Blocks that draw across the page and cannot be split into two body columns. */
function hasFullWidthBlock(slide: Slide): boolean {
  return (slide.content.blocks ?? []).some(
    (block) =>
      block.type === "timeline" ||
      block.type === "process" ||
      block.type === "metric" ||
      block.type === "chart" ||
      block.type === "table-data" ||
      block.type === "quote",
  );
}

/**
 * Why a layout cannot be applied to this page.
 *
 * PowerPoint can move placeholders around because it keeps their geometry.
 * PPTD persists only what a layout means, so changing layout means rebuilding
 * the composition. A target that has no body placeholder would hide reviewed
 * copy, and a two-column target cannot carry a single point or a full-width
 * chart. Those cases are refused instead of producing a page that silently
 * drops content.
 */
export function slideLayoutApplicationIssue(
  document: PresentationDocument,
  slide: Slide,
  layout: SlideLayoutSpec,
): string | undefined {
  if (layout.id === slide.layoutId) return undefined;
  const capabilities = layout.capabilities;
  if (!capabilities) return "该版式缺少占位信息，无法安全切换";
  if (!capabilities.hasTitle) return "该版式没有标题占位";
  if (capabilities.free) {
    const current = document.layouts?.find((candidate) => candidate.id === slide.layoutId);
    if (current?.capabilities?.free) return undefined;
    return hasBodyContent(slide) ? "该页有正文，封面或空白版式会隐藏内容" : undefined;
  }
  if (!capabilities.hasBody) return "该版式没有正文占位";
  if (capabilities.columns >= 2) {
    if (hasFullWidthBlock(slide)) return "该页含整行内容或引用，不能改用双栏版式";
    const hasComparison = (slide.content.blocks ?? []).some((block) => block.type === "comparison");
    if (!hasComparison && contentItems(slide).length < LAYOUT_CAPACITY.splitMinItems) {
      return `双栏版式至少需要 ${LAYOUT_CAPACITY.splitMinItems} 条正文`;
    }
  }
  return undefined;
}

/** The layouts the ribbon can offer for this page, including the current one. */
export function slideLayoutOptions(document: PresentationDocument, slide: Slide): SlideLayoutOption[] {
  return (document.layouts ?? []).map((layout) => {
    const current = layout.id === slide.layoutId;
    const issue = current ? undefined : slideLayoutApplicationIssue(document, slide, layout);
    return { layout, current, ...(issue ? { issue } : {}) };
  });
}

/**
 * The composition family a target layout asks for.
 *
 * Only a free layout is treated as a cover or section: a layout that still
 * has a body placeholder carries content, even when its name says otherwise.
 * Keeping the name as a tie-breaker for quote/summary pages preserves the
 * template's intent without letting a label overrule the content.
 */
function layoutKindForTarget(layout: SlideLayoutSpec): AiLayoutKind {
  const capabilities = layout.capabilities;
  if (!capabilities) return "title-body";
  const name = layout.name.toLocaleLowerCase();
  if (capabilities.free) {
    return /(章节|section|过渡|分隔)/u.test(name) ? "section" : "cover";
  }
  if (capabilities.columns >= 2) return "split";
  if (/(引用|引言|金句|quote)/u.test(name)) return "quote";
  if (/(总结|summary)/u.test(name)) return "summary";
  if (/(卡片|cards)/u.test(name)) return "cards";
  return "title-body";
}

function targetBodyRegions(
  layout: SlideLayoutSpec,
  frame: AiTemplateRegion["frame"],
  textColor: string,
  fontSizePt?: number,
): AiTemplateRegion[] {
  const capabilities = layout.capabilities;
  if (!capabilities || capabilities.free) return [];
  const region = (bodyFrame: AiTemplateRegion["frame"]): AiTemplateRegion => ({
    role: "body",
    frame: bodyFrame,
    textColor,
    fontSizePt,
  });
  if (capabilities.columns < 2) return [region(frame)];
  const gap = Math.min(0.03, frame.width * 0.06);
  const width = (frame.width - gap) / 2;
  return [
    region({ ...frame, width }),
    region({ ...frame, x: frame.x + width + gap, width }),
  ];
}

/** Plain copy can be forced into columns; structured blocks draw their own page. */
function canForceColumns(slide: Slide): boolean {
  const blocks = slide.content.blocks ?? [];
  return blocks.length === 0 || blocks.every((block) => block.type === "paragraph" || block.type === "bullet-list");
}

function inferLayout(slide: Slide, document: PresentationDocument, generated: SlideElement[]): AiLayoutKind {
  const name = layoutName(slide, document).toLocaleLowerCase();
  if (/(封面|cover|title slide|扉页)/u.test(name)) return "cover";
  if (/(章节|section|过渡|分隔)/u.test(name)) return "section";
  // An explicit two-column name is a strong signal. A generic content name is
  // not: vendor templates call both a card grid and a plain two-column page
  // "内页", so the composition of the page has to win over that label.
  if (/(双栏|两栏|左右|对比|比较|split|two content|comparison)/u.test(name)) return "split";
  if (/(引用|引言|金句|quote)/u.test(name)) return "quote";
  if (/(总结|summary)/u.test(name)) return "summary";

  const texts = generated.filter(
    (element): element is TextElement => element.type === "text" && element.contentRef !== "title",
  );
  const bodyFrames = texts.map((element) => element.frame);
  if (bodyFrames.length >= 2) {
    const left = bodyFrames.filter((frame) => frame.x < document.pageSize.width * 0.5);
    const right = bodyFrames.filter((frame) => frame.x >= document.pageSize.width * 0.5);
    if (left.length > 0 && right.length > 0) return "split";
  }
  if (texts.length >= 3) return "cards";
  if (/(卡片|cards)/u.test(name)) return "cards";
  return "title-body";
}

function isNeutral(color: string): boolean {
  const normalized = color.toUpperCase();
  if (NEUTRAL_COLORS.has(normalized)) return true;
  const luminance = colorLuminance(normalized);
  return luminance !== undefined && (luminance > 0.9 || luminance < 0.05);
}

function inferAccent(generated: SlideElement[], titleColor: string): string {
  const counts = new Map<string, number>();
  for (const element of generated) {
    if (element.type !== "shape") continue;
    const color = element.style.fill.toUpperCase();
    if (isNeutral(color)) continue;
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const winner = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  if (winner) return winner;
  return isNeutral(titleColor) ? "#3366CC" : titleColor;
}

function backgroundRangeFor(textColor: string): BackgroundRange {
  const luminance = colorLuminance(textColor) ?? 0.5;
  // A dark title needs a light background range to stay dark. The previous
  // polarity forced every dark title onto a dark range, so the contrast repair
  // turned it white on a white page.
  return luminance < 0.45 ? { darkest: 0.68, lightest: 0.98 } : { darkest: 0.02, lightest: 0.32 };
}

/**
 * Builds the design input for a design-only relayout from the page that is
 * already on screen. It reuses the template artwork, title/body geometry, ink
 * and accent, so relayout is a composition change rather than a re-theme.
 *
 * With `targetLayout` the command is changing layouts. The target's persisted
 * capabilities decide whether the page becomes a cover, a two-column page or a
 * normal body page; its flat background and ink replace the current ones. The
 * original placeholder geometry is not persisted, so the composition is rebuilt
 * safely instead of pretending to reproduce the source template exactly.
 */
export function inferRelayoutContext(
  slide: Slide,
  document: PresentationDocument,
  targetLayout?: SlideLayoutSpec,
): RelayoutContext {
  const classified = classifyRelayoutElements(slide);
  const allText = slide.elements.filter((element): element is TextElement => element.type === "text");
  const generatedText = classified.generated.filter((element): element is TextElement => element.type === "text");
  const title =
    generatedText.find((element) => element.contentRef === "title") ??
    generatedText.find((element) => element.text.trim() === slide.content.title.trim()) ??
    generatedText[0] ??
    allText.find((element) => element.contentRef === "title") ??
    allText[0];
  const bodyTexts = (generatedText.length > 0 ? generatedText : allText).filter(
    (element) => element !== title && element.contentRef !== "title",
  );

  const titleFrame = title ? normalizedFrame(title.frame, document.pageSize) : { ...DEFAULT_TITLE };
  const bodyFrame = unionFrames(bodyTexts.map((element) => normalizedFrame(element.frame, document.pageSize))) ?? {
    ...DEFAULT_BODY,
  };
  const safe = unionFrames([titleFrame, bodyFrame]) ?? { ...DEFAULT_BODY };
  const safeRegion = {
    x: Math.max(0, safe.x - 0.02),
    y: Math.max(0, safe.y - 0.02),
    width: Math.min(1, safe.width + 0.04),
    height: Math.min(1, safe.height + 0.04),
  };

  const targetBackground = targetLayout?.backgroundColor;
  const targetLuminance = targetBackground ? colorLuminance(targetBackground) : undefined;
  const rawTitleColor = title?.style.color ?? "#171A1F";
  const rawBodyColor = bodyTexts[0]?.style.color ?? rawTitleColor;
  const rawAccent = inferAccent(classified.generated, rawTitleColor);
  // A different layout may be dark where the old one was light. Keeping the old
  // ink would put a dark title on a dark plate, so the ink is resolved against
  // the target background before the composition is built.
  const titleColor =
    targetLuminance === undefined ? rawTitleColor : readableTextColor(rawTitleColor, targetLuminance, true);
  const bodyColor =
    targetLuminance === undefined ? rawBodyColor : readableTextColor(rawBodyColor, targetLuminance, false, titleColor);
  const accent =
    targetLuminance === undefined ? rawAccent : readableTextColor(rawAccent, targetLuminance, true, titleColor);
  const background = targetBackground ?? slide.background;
  // Only the current layout keeps its artwork. A target layout's artwork was
  // never persisted; carrying the old image across would paint the wrong
  // template behind the new composition.
  const backgroundImage =
    !targetLayout || targetLayout.id === slide.layoutId
      ? classified.generated.find(isLayoutBackground)
      : undefined;
  const layout = targetLayout ? layoutKindForTarget(targetLayout) : inferLayout(slide, document, classified.generated);
  const range = { title: backgroundRangeFor(titleColor), body: backgroundRangeFor(bodyColor) };
  const targetColumns = targetLayout?.capabilities?.columns ?? 0;
  // A narrow source body leaves neither column enough room. A split target then
  // uses the standard body area instead of squeezing two columns into it.
  const regionBodyFrame = targetColumns >= 2 && bodyFrame.width < 0.5 ? { ...DEFAULT_BODY } : bodyFrame;
  const regions: AiTemplateRegion[] = [
    { role: "title", frame: titleFrame, textColor: titleColor, fontSizePt: title?.style.fontSizePt },
    ...(targetLayout
      ? targetBodyRegions(targetLayout, regionBodyFrame, bodyColor, bodyTexts[0]?.style.fontSizePt)
      : [
          {
            role: "body" as const,
            frame: bodyFrame,
            textColor: bodyColor,
            fontSizePt: bodyTexts[0]?.style.fontSizePt,
          },
        ]),
  ];

  return {
    design: {
      layout,
      background,
      accent,
      titleColor,
      bodyColor,
      safeRegion,
      backgroundTreatment: "none",
      inkOverride: true,
      ...(targetColumns >= 2 && canForceColumns(slide) ? { composition: "columns" as const } : {}),
    },
    templateLayout: {
      index: 0,
      name: targetLayout?.name.trim() || layoutName(slide, document) || "现有版式",
      backgroundColor: background,
      ...(backgroundImage?.type === "image" ? { backgroundImageDataUrl: backgroundImage.source.dataUrl } : {}),
      backgroundLuminance: range,
      regions,
    },
    fontFamily: title?.style.fontFamily,
    bodyFontFamily: bodyTexts[0]?.style.fontFamily,
  };
}
