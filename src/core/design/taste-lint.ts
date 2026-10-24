/**
 * Deterministic design review ("taste lint").
 *
 * The visual quality gate answers "is anything broken": overflow, overlap,
 * contrast. This module answers a different question: does the page look like a
 * template that happened to receive text. Its findings are advisory and never
 * block generation or export (ADR 0015); the geometry gate keeps that job.
 *
 * Every rule is pure and thresholded. No model is involved, so the same document
 * always produces the same report and a red/green run can be trusted in CI.
 */

import type {
  ContentBlock,
  ElementId,
  PresentationDocument,
  Slide,
  SlideElement,
  TextElement,
} from "../document-model";
import { isNeutralColor, normalizeHexColor } from "../rendering/color-analysis";

export type TasteSeverity = "hard" | "soft";

export type TasteIssueCode =
  | "BODY_TEXT_TOO_SMALL"
  | "LABEL_TEXT_TOO_SMALL"
  | "TITLE_BODY_RATIO_LOW"
  | "FONT_FAMILY_COUNT"
  | "COLOR_COUNT"
  | "DECORATION_KICKER"
  | "DECORATION_INDEX_NUMBER"
  | "DECORATION_EMOJI"
  | "DECORATION_ACCENT_WORD"
  | "RHYTHM_REPEAT"
  | "WHITESPACE_IMBALANCE";

export const TASTE_ISSUE_CODES: readonly TasteIssueCode[] = [
  "BODY_TEXT_TOO_SMALL",
  "LABEL_TEXT_TOO_SMALL",
  "TITLE_BODY_RATIO_LOW",
  "FONT_FAMILY_COUNT",
  "COLOR_COUNT",
  "DECORATION_KICKER",
  "DECORATION_INDEX_NUMBER",
  "DECORATION_EMOJI",
  "DECORATION_ACCENT_WORD",
  "RHYTHM_REPEAT",
  "WHITESPACE_IMBALANCE",
];

const SEVERITY: Readonly<Record<TasteIssueCode, TasteSeverity>> = {
  BODY_TEXT_TOO_SMALL: "hard",
  LABEL_TEXT_TOO_SMALL: "hard",
  TITLE_BODY_RATIO_LOW: "hard",
  FONT_FAMILY_COUNT: "soft",
  COLOR_COUNT: "soft",
  DECORATION_KICKER: "soft",
  DECORATION_INDEX_NUMBER: "soft",
  DECORATION_EMOJI: "soft",
  DECORATION_ACCENT_WORD: "soft",
  RHYTHM_REPEAT: "soft",
  WHITESPACE_IMBALANCE: "soft",
};

export interface TasteIssue {
  code: TasteIssueCode;
  severity: TasteSeverity;
  slideIndex: number;
  slideId: string;
  elementIds: string[];
  /** User-facing explanation; the code stays the stable identifier. */
  message: string;
  /** Measured values behind the finding, for the report and for tuning. */
  metrics?: Record<string, number | string>;
  suggestion?: string;
}

export interface TasteReport {
  issues: TasteIssue[];
  counts: Record<TasteIssueCode, number>;
  /**
   * Checks that could not run on this document, with a fixed reason string.
   * The UI must show these as "not run", never fold them into "passed".
   */
  skipped: string[];
}

export interface TasteLintOptions {
  /** Absolute floor in points; the page-relative floor is applied on top. */
  minBodyPt?: number;
  minLabelPt?: number;
  /** Body copy shorter than this is a caption, not a paragraph. */
  minBodyLength?: number;
  /** Title size divided by body size. */
  minTitleBodyRatio?: number;
  maxFontFamilies?: number;
  maxAccentColors?: number;
}

const DEFAULTS = {
  minBodyPt: 12,
  minLabelPt: 9,
  minBodyLength: 20,
  minTitleBodyRatio: 2.5,
  maxFontFamilies: 2,
  maxAccentColors: 4,
} as const;

/** Body floor as the larger of an absolute pt value and a share of page width. */
export function minimumBodyPt(document: PresentationDocument, options: TasteLintOptions = {}): number {
  const pageWidthPt = document.pageSize.width / 12_700;
  return Math.max(options.minBodyPt ?? DEFAULTS.minBodyPt, pageWidthPt * 0.0125);
}

export function minimumLabelPt(document: PresentationDocument, options: TasteLintOptions = {}): number {
  const pageWidthPt = document.pageSize.width / 12_700;
  return Math.max(options.minLabelPt ?? DEFAULTS.minLabelPt, pageWidthPt * 0.008);
}

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const INDEX_NUMBER_PATTERN = /^0?\d{1,2}$/;
const PAGE_NUMBER_PATTERN = /^\d+\s*\/\s*\d+$/;
const TERMINAL_PUNCTUATION = /[。！？；.!?;]$/;

/** Font aliases that render the same family under a different name. */
const FAMILY_ALIASES: Readonly<Record<string, string>> = {
  "microsoft yahei": "yahei",
  微软雅黑: "yahei",
  simsun: "song",
  宋体: "song",
  simhei: "hei",
  黑体: "hei",
  华文中宋: "stzhongsong",
  等线: "dengxian",
};

function normalizedFamily(name: string): string {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, "");
  return FAMILY_ALIASES[key] ?? key;
}

function textElements(slide: Slide): TextElement[] {
  return slide.elements.filter((element): element is TextElement => element.type === "text");
}

function isBackgroundElement(element: SlideElement): boolean {
  return (
    element.type === "image" && (element.placement === "layout-background" || element.placement === "slide-background")
  );
}

/**
 * A shape or picture that fills the page is a deliberate surface, not content
 * that happens to reach the edges. Whitespace and colour counts must not read it
 * as a page crammed with elements.
 */
function hasFullBleedArtwork(slide: Slide, pageWidth: number, pageHeight: number): boolean {
  return slide.elements.some(
    (element) =>
      (element.type === "image" || element.type === "shape") &&
      element.frame.width >= pageWidth * 0.98 &&
      element.frame.height >= pageHeight * 0.98,
  );
}

function isFooter(element: TextElement, pageHeight: number): boolean {
  if (element.frame.y / pageHeight > 0.9) return true;
  return PAGE_NUMBER_PATTERN.test(element.text.trim());
}

/** The title the reader sees: the explicit content role, else the largest text. */
function titleOf(slide: Slide): TextElement | undefined {
  const texts = textElements(slide);
  const explicit = texts.find((element) => element.contentRef === "title");
  if (explicit) return explicit;
  // A metric value is a display number, not the page title.
  const candidates = texts.filter((element) => element.contentBlockRef?.field !== "value");
  let largest: TextElement | undefined;
  for (const element of candidates.length > 0 ? candidates : texts) {
    if (!largest || element.style.fontSizePt > largest.style.fontSizePt) largest = element;
  }
  return largest;
}

/**
 * Body copy: the explicit role first. Imported decks and legacy documents may
 * carry no role at all, so a long paragraph away from the footer is also body.
 */
function bodyOf(slide: Slide, title: TextElement | undefined, pageHeight: number): TextElement[] {
  const texts = textElements(slide);
  const explicit = texts.filter((element) => element.contentRef === "body");
  if (explicit.length > 0) return explicit;
  return texts.filter(
    (element) => element !== title && !isFooter(element, pageHeight) && element.text.trim().length >= 40,
  );
}

function labelsOf(
  slide: Slide,
  title: TextElement | undefined,
  body: TextElement[],
  pageHeight: number,
): TextElement[] {
  return textElements(slide).filter((element) => {
    if (element === title || body.includes(element)) return false;
    if (isFooter(element, pageHeight)) return false;
    // A metric value is a display number, not a label.
    if (element.contentBlockRef?.field === "value") return false;
    if (element.style.fontSizePt >= 24) return false;
    return element.text.trim().length > 0;
  });
}

function colorOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "none" || trimmed.toLowerCase() === "transparent") return undefined;
  return normalizeHexColor(trimmed);
}

function accentColors(slide: Slide, pageWidth: number, pageHeight: number): string[] {
  const colors = new Set<string>();
  const add = (value: string | undefined) => {
    const color = colorOf(value);
    if (color && !isNeutralColor(color)) colors.add(color);
  };
  for (const element of slide.elements) {
    if (element.type === "text") {
      add(element.style.color);
      for (const run of element.runs ?? []) add(run.color);
    } else if (element.type === "shape") {
      // A full-bleed panel is the page surface, not an accent.
      if (element.frame.width >= pageWidth * 0.98 && element.frame.height >= pageHeight * 0.98) continue;
      add(element.style.fill);
      add(element.style.stroke);
    } else if (element.type === "line") {
      add(element.style.stroke);
    }
  }
  return [...colors].sort();
}

/** Coarse skeleton: element kinds and content roles in reading order. */
function structureSignature(slide: Slide, pageHeight: number): string {
  return slide.elements
    .filter((element) => !isBackgroundElement(element))
    .filter((element) => !(element.type === "text" && isFooter(element, pageHeight)))
    .slice()
    .sort((left, right) => left.frame.y - right.frame.y || left.frame.x - right.frame.x)
    .map((element) => {
      if (element.type === "text") {
        if (element.contentRef) return `text:${element.contentRef}`;
        if (element.contentBlockRef) return `text:${element.contentBlockRef.field}`;
        return "text:note";
      }
      if (element.type === "shape") return `shape:${element.shape}`;
      return element.type;
    })
    .join("|");
}

function hasSequenceBlock(slide: Slide): boolean {
  const blocks = slide.content.blocks ?? [];
  const sequenceTypes = new Set<ContentBlock["type"]>(["process", "timeline"]);
  return blocks.some((block) => sequenceTypes.has(block.type));
}

function hasNumberedText(slide: Slide): boolean {
  return textElements(slide).some((element) => element.style.bullet === "number");
}

function containsEmoji(value: string): boolean {
  return EMOJI_PATTERN.test(value);
}

function accentWordRuns(title: TextElement): { length: number; colors: string[] } {
  const base = colorOf(title.style.color);
  let length = 0;
  const colors = new Set<string>();
  for (const run of title.runs ?? []) {
    const color = colorOf(run.color);
    if (!color || color === base) continue;
    const from = Math.max(0, run.start);
    const to = Math.min(title.text.length, run.end);
    if (to <= from) continue;
    length += to - from;
    colors.add(color);
  }
  return { length, colors: [...colors] };
}

function emptyCounts(): Record<TasteIssueCode, number> {
  return Object.fromEntries(TASTE_ISSUE_CODES.map((code) => [code, 0])) as Record<TasteIssueCode, number>;
}

function severityRank(severity: TasteSeverity): number {
  return severity === "hard" ? 0 : 1;
}

export function lintTaste(document: PresentationDocument, options: TasteLintOptions = {}): TasteReport {
  const issues: TasteIssue[] = [];
  const skipped = new Set<string>();
  const pageHeight = document.pageSize.height;
  const pageWidth = document.pageSize.width;
  const bodyFloor = minimumBodyPt(document, options);
  const labelFloor = minimumLabelPt(document, options);
  const minBodyLength = options.minBodyLength ?? DEFAULTS.minBodyLength;
  const minTitleBodyRatio = options.minTitleBodyRatio ?? DEFAULTS.minTitleBodyRatio;
  const maxFontFamilies = options.maxFontFamilies ?? DEFAULTS.maxFontFamilies;
  const maxAccentColors = options.maxAccentColors ?? DEFAULTS.maxAccentColors;

  const report = (
    code: TasteIssueCode,
    slideIndex: number,
    slide: Slide,
    elementIds: ElementId[],
    message: string,
    metrics?: Record<string, number | string>,
    suggestion?: string,
  ) => {
    issues.push({
      code,
      severity: SEVERITY[code],
      slideIndex,
      slideId: slide.id,
      elementIds: elementIds.map(String),
      message,
      ...(metrics ? { metrics } : {}),
      ...(suggestion ? { suggestion } : {}),
    });
  };

  const signatures: string[] = [];

  document.slides.forEach((slide, slideIndex) => {
    const hasArtwork = slide.elements.some(
      (element) => element.type === "image" && element.placement === "layout-background",
    );
    const fullBleed = hasFullBleedArtwork(slide, pageWidth, pageHeight);
    if (hasArtwork) skipped.add("template-artwork:color-whitespace");
    else if (fullBleed) skipped.add("full-bleed-artwork:color-whitespace");

    const title = titleOf(slide);
    const body = bodyOf(slide, title, pageHeight);
    const labels = labelsOf(slide, title, body, pageHeight);

    if (!title) skipped.add("typography:no-title");

    if (body.length === 0) {
      skipped.add("typography:no-body");
    } else {
      const smallestBody = Math.min(...body.map((element) => element.style.fontSizePt));
      if (smallestBody < bodyFloor) {
        report(
          "BODY_TEXT_TOO_SMALL",
          slideIndex,
          slide,
          body.filter((element) => element.style.fontSizePt < bodyFloor).map((element) => element.id),
          `正文字号 ${smallestBody.toFixed(1)}pt 低于下限 ${bodyFloor.toFixed(1)}pt`,
          { fontSizePt: smallestBody, minimumPt: bodyFloor },
          "把正文提高到下限以上，或删减内容而不是缩小字号。",
        );
      }
    }

    if (labels.length > 0) {
      const smallestLabel = Math.min(...labels.map((element) => element.style.fontSizePt));
      if (smallestLabel < labelFloor) {
        report(
          "LABEL_TEXT_TOO_SMALL",
          slideIndex,
          slide,
          labels.filter((element) => element.style.fontSizePt < labelFloor).map((element) => element.id),
          `标签字号 ${smallestLabel.toFixed(1)}pt 低于下限 ${labelFloor.toFixed(1)}pt`,
          { fontSizePt: smallestLabel, minimumPt: labelFloor },
          "标签也要能看清；不要用缩小字号来腾空间。",
        );
      }
    }

    if (title && body.length > 0) {
      const longestBody = Math.max(...body.map((element) => element.text.trim().length));
      if (longestBody >= minBodyLength) {
        const bodySize = Math.max(...body.map((element) => element.style.fontSizePt));
        const ratio = title.style.fontSizePt / bodySize;
        if (ratio < minTitleBodyRatio) {
          report(
            "TITLE_BODY_RATIO_LOW",
            slideIndex,
            slide,
            [title.id, ...body.map((element) => element.id)],
            `标题与正文的字号比只有 ${ratio.toFixed(2)}，低于 ${minTitleBodyRatio}`,
            { ratio, titlePt: title.style.fontSizePt, bodyPt: bodySize },
            "拉开标题与正文的字阶；层级靠字号和字重，不靠颜色。",
          );
        }
      }
    }

    // A one-glyph text is a quote mark or an icon, not a third typographic voice.
    const families = new Set(
      textElements(slide)
        .filter((element) => element.text.trim().length > 1)
        .map((element) => normalizedFamily(element.style.fontFamily)),
    );
    if (families.size > maxFontFamilies) {
      report(
        "FONT_FAMILY_COUNT",
        slideIndex,
        slide,
        [],
        `本页使用了 ${families.size} 种字体，建议不超过 ${maxFontFamilies} 种`,
        { count: families.size, families: [...families].sort().join(", ") },
        "正文与标题各一种即可，用字重和字号制造变化。",
      );
    }

    const colors = accentColors(slide, pageWidth, pageHeight);
    if (!hasArtwork && colors.length > maxAccentColors) {
      report(
        "COLOR_COUNT",
        slideIndex,
        slide,
        [],
        `本页使用了 ${colors.length} 种非中性色，建议不超过 ${maxAccentColors} 种`,
        { count: colors.length, colors: colors.join(", ") },
        "收敛到主色 + 一个强调色；其余交给灰阶。",
      );
    }

    if (title) {
      const kicker = textElements(slide).find((element) => {
        if (element === title || body.includes(element) || isFooter(element, pageHeight)) return false;
        if (element.contentBlockRef) return false;
        const text = element.text.trim();
        if (!text || text.length > 24 || TERMINAL_PUNCTUATION.test(text)) return false;
        if (element.style.fontSizePt >= title.style.fontSizePt * 0.45) return false;
        const titleHeight = title.frame.height;
        const bottom = element.frame.y + element.frame.height;
        const gap = title.frame.y - bottom;
        if (gap < 0 || gap > titleHeight * 1.8) return false;
        return Math.abs(element.frame.x - title.frame.x) <= pageWidth * 0.05;
      });
      if (kicker) {
        report(
          "DECORATION_KICKER",
          slideIndex,
          slide,
          [kicker.id],
          `标题上方有一行小标签「${kicker.text.trim()}」`,
          { fontSizePt: kicker.style.fontSizePt, titlePt: title.style.fontSizePt },
          "标题已经能说明页面；没有新信息就删掉这行标签。",
        );
      }

      const runs = accentWordRuns(title);
      if (title.text.trim().length >= 6 && runs.length > 0 && runs.length < title.text.length / 2) {
        report(
          "DECORATION_ACCENT_WORD",
          slideIndex,
          slide,
          [title.id],
          "标题里只有一个词被单独换色",
          { highlightedChars: runs.length, totalChars: title.text.length },
          "强调靠整句的字重或位置；单字变色是模板装饰。",
        );
      }
    }

    const indexNumbers = textElements(slide).filter(
      (element) =>
        INDEX_NUMBER_PATTERN.test(element.text.trim()) &&
        !isFooter(element, pageHeight) &&
        !element.contentBlockRef &&
        element.style.fontSizePt < 40,
    );
    // One bare number is a decorative page marker. Several are an index the
    // layout is actually using, which is a sequence the content shows.
    if (indexNumbers.length === 1 && !hasSequenceBlock(slide) && !hasNumberedText(slide)) {
      const indexed = indexNumbers[0]!;
      report(
        "DECORATION_INDEX_NUMBER",
        slideIndex,
        slide,
        [indexed.id],
        `页码式编号「${indexed.text.trim()}」出现在没有序列的页面上`,
        { text: indexed.text.trim() },
        "编号只有在内容确实是步骤或序列时才使用。",
      );
    }

    for (const element of textElements(slide)) {
      if (containsEmoji(element.text)) {
        report(
          "DECORATION_EMOJI",
          slideIndex,
          slide,
          [element.id],
          "文本里出现了 emoji 图标",
          { text: element.text.slice(0, 24) },
          "用内置图标库或直接删掉；emoji 不是设计元素。",
        );
      }
    }

    // Whitespace is judged on copy and pictures, not on panels, rules or edge
    // bands: a cover made of two full-height colour panels is a composition, and
    // its bounding box says nothing about how much air the page has.
    const painted = slide.elements.filter(
      (element) =>
        (element.type === "text" || element.type === "image" || element.type === "chart" || element.type === "table") &&
        !isBackgroundElement(element) &&
        !(element.type === "text" && isFooter(element, pageHeight)),
    );
    if (!hasArtwork && !fullBleed && painted.length > 0 && body.length > 0) {
      let left = Number.POSITIVE_INFINITY;
      let top = Number.POSITIVE_INFINITY;
      let right = 0;
      let bottom = 0;
      for (const element of painted) {
        left = Math.min(left, element.frame.x);
        top = Math.min(top, element.frame.y);
        right = Math.max(right, element.frame.x + element.frame.width);
        bottom = Math.max(bottom, element.frame.y + element.frame.height);
      }
      const widthRatio = (right - left) / pageWidth;
      const heightRatio = (bottom - top) / pageHeight;
      const areaRatio = widthRatio * heightRatio;
      if ((widthRatio > 0.92 && heightRatio > 0.9) || areaRatio < 0.12) {
        report(
          "WHITESPACE_IMBALANCE",
          slideIndex,
          slide,
          [],
          areaRatio < 0.12 ? "页面内容只占很小一块，留白不像构图" : "页面几乎被填满，没有留白",
          { widthRatio, heightRatio, areaRatio },
          areaRatio < 0.12 ? "把内容放大或重新分布，让留白成为构图的一部分。" : "删掉不承载信息的元素，留出呼吸空间。",
        );
      }
    }

    signatures.push(body.length > 0 ? structureSignature(slide, pageHeight) : "");
  });

  // Three consecutive content pages with the same skeleton read as a template
  // applied three times, even when the copy differs. The cover and the closing
  // page are allowed to be statements, so a run that touches them is not flagged.
  // A longer run is one finding, not one per window: the user fixes the stretch,
  // not every pair inside it.
  for (let index = 1; index + 2 < signatures.length - 1; index += 1) {
    const signature = signatures[index]!;
    if (!signature) continue;
    if (signatures[index + 1] !== signature || signatures[index + 2] !== signature) continue;
    let end = index + 2;
    while (end + 1 < signatures.length - 1 && signatures[end + 1] === signature) end += 1;
    report(
      "RHYTHM_REPEAT",
      index,
      document.slides[index]!,
      [],
      `连续 ${end - index + 1} 页使用了同一套骨架`,
      { pages: end - index + 1 },
      "换一页的构图，或把其中一页合并到相邻页。",
    );
    index = end;
  }

  issues.sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      left.slideIndex - right.slideIndex ||
      left.code.localeCompare(right.code) ||
      left.elementIds.join(",").localeCompare(right.elementIds.join(",")),
  );

  const counts = emptyCounts();
  for (const issue of issues) counts[issue.code] += 1;

  return { issues, counts, skipped: [...skipped].sort() };
}
