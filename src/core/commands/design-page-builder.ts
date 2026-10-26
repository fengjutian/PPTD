import type {
  ElementId,
  Emu,
  PresentationDocument,
  RectEmu,
  SlideElement,
  SlideLayoutSpec,
  TextElement,
  TextRun,
} from "../document-model";
import { createSlide, iconForText, parseMetricValue } from "../document-model";
import type { BackgroundRange } from "../rendering/contrast";
import {
  colorLuminance,
  fillForInk,
  isLargeText,
  readableTextColor,
  readableTextColorOnRange,
} from "../rendering/contrast";
import { estimateTextLines, textLikelyOverflows } from "../rendering/text-fit";
import { layoutFlow } from "../rendering/flow";
import type { AiElementRepair, AiNormalizedRect, AiTemplateDecoration, TemplateLayoutIntent } from "./template-layouts";
import {
  layoutCapabilities,
  planTemplateLayoutsWithReport,
  templateColumnRegions,
  templateContentRegion,
  templateImageRegion,
  templateLayoutHasFooterMarker,
  templateRequirementForIntent,
  templateTitleRegion,
} from "./template-layouts";
import {
  CONTENT_REGION,
  DEFAULT_CONTENT_REGION,
  LAYOUT_CAPACITY,
  PANEL_TYPE_SCALE,
  stripListPrefix,
} from "./layout-capacity";
import { resolveTypeScale } from "../design/type-scale";
import { findThemePreset } from "../design/theme-presets";
import { deriveDesignTokens, deriveSemanticColors, sameAppearance } from "../design/design-tokens";

import { surfaceSafeRegion, surfaceShowsRule } from "../design/surface-profile";
import { resolveChartKind } from "../design/data-relation";
import { compileDesignPlanWithRetry } from "../layout/design-compiler";
import type { DesignCompileReport } from "../layout/design-compiler";
import { consumptionProblem, isImageRecipe, selectPreferredStyleRecipe, selectRecipe } from "../layout/recipes/plan";
import { RECIPE_CATALOG } from "../layout/recipes/registry";
import type { RecipeContext } from "../layout/recipes/types";
import { planPageChrome } from "../layout/page-chrome";
import { refitSlideText } from "../layout/text-refit";
import { coverCrop } from "../rendering/image-fit";
import type { CompositionFacts } from "./design-intent";
import {
  DENSITY_FACTORS,
  EMPHASIS_FACTORS,
  autoComposition,
  detectPullQuote,
  resolvePageDesign,
} from "./design-intent";
import { planDeckCompositions } from "./deck-composition";
import { narrativeComposition } from "./visual-narrative";
import type { AiVisualAssetRole } from "./visual-asset";
import { planVisualAssetLayout, resolveVisualAsset } from "./visual-asset";
import type { AiContentBlock, DocumentCommand } from "./commands";
import { HEX_COLOR_PATTERN, readTemplateTheme, toContentBlocks, type MetricBlock } from "./ai-draft-helpers";

export function createDesignContext(
  document: PresentationDocument,
  command: Extract<DocumentCommand, { type: "apply-ai-designed-draft" }>,
) {
  const compileReports: Array<{ slideIndex: number; report: DesignCompileReport }> = [];
  const templateTheme = readTemplateTheme(command.templateTheme);
  // A template keeps its own placeholders, ink and type sizes. A preset may
  // still supply the palette, but it must not strip the template's region
  // text colour/size: that is what turned a white cover title on a dark
  // template into dark text on a dark picture.
  const hasTemplate = Boolean(
    command.templateLayouts?.length || command.templateDecorations?.length || command.templateTheme,
  );
  // A preset is the fallback for a deck generated without a template: it owns
  // the palette, the font pairing and the type scale. An explicitly chosen
  // preset wins over the template theme while the template keeps its layout.
  const preset = command.themePresetId ? findThemePreset(command.themePresetId) : undefined;
  const theme = preset?.theme ?? templateTheme;
  if (theme) document.theme = theme;
  else delete document.theme;
  // The type scale of the template or preset. Every branch reads this instead
  // of repeating point sizes, so the deck keeps one hierarchy.
  const typeScale = resolveTypeScale(document.theme);
  // The leading a theme declares for running copy. Frames that hold body text
  // reserve the same height, so the text and its box cannot disagree.
  const bodyLeading = document.theme?.textStyles?.body?.lineHeight ?? 1.25;
  // Fonts follow the same precedence as the type scale: the template wins,
  // then the theme/preset, then the renderer default.
  const majorFont = preset
    ? (document.theme?.majorFont ?? "Microsoft YaHei")
    : command.fontFamily || document.theme?.majorFont || "Microsoft YaHei";
  const minorFont = preset
    ? (document.theme?.minorFont ?? document.theme?.majorFont ?? "Microsoft YaHei")
    : command.bodyFontFamily ||
      command.fontFamily ||
      document.theme?.minorFont ||
      document.theme?.majorFont ||
      "Microsoft YaHei";
  // A chosen preset owns the type scale. On a template page the template's
  // placeholder ink still wins: a white cover title on a dark template must
  // not become dark just because a preset was applied on top of it.
  const effectiveLayouts = preset
    ? (command.templateLayouts ?? []).map((layout) => ({
        ...layout,
        regions: layout.regions.map(({ fontSizePt: _size, textColor, ...region }) =>
          hasTemplate && textColor ? { ...region, textColor } : region,
        ),
      }))
    : command.templateLayouts;
  // The design replaces every page, so the layouts of the previous template
  // must not survive as empty references.
  const layouts: SlideLayoutSpec[] = [];
  document.layouts = layouts;
  const layoutSpecs = new Map<number, SlideLayoutSpec>();
  const pageWidth = document.pageSize.width;
  const pageHeight = document.pageSize.height;
  const pageWidthIn = pageWidth / 914400;
  const pageHeightIn = pageHeight / 914400;
  const frame = (x: number, y: number, width: number, height: number): RectEmu => ({
    x: Math.round(x * pageWidth) as Emu,
    y: Math.round(y * pageHeight) as Emu,
    width: Math.round(width * pageWidth) as Emu,
    height: Math.round(height * pageHeight) as Emu,
  });
  // A slide is wider than it is tall, so a circle has to be sized in inches on
  // both axes. A square in normalized coordinates is an ellipse on screen.
  const circleFrame = (x: number, y: number, diameterInches: number): RectEmu =>
    frame(x, y, diameterInches / pageWidthIn, diameterInches / pageHeightIn);
  const fittedFontSize = (
    value: string,
    box: RectEmu,
    preferredPt: number,
    minimumPt = 12,
    lineHeightRatio = 1.2,
    maximumPt = preferredPt,
  ): number => {
    const widthPt = box.width / 12_700;
    const heightPt = box.height / 12_700;
    // The same line estimator the quality gate uses decides whether a size
    // fits, so a page that passes generation cannot be reported as overflow.
    const fits = (size: number) =>
      estimateTextLines(value, widthPt, size, majorFont) * size * lineHeightRatio <= heightPt;
    const minimum = Math.max(1, Math.round(minimumPt));
    const maximum = Math.max(minimum, Math.round(maximumPt));
    const preferred = Math.min(maximum, Math.max(minimum, Math.round(preferredPt)));
    if (fits(preferred)) {
      for (let size = preferred + 1; size <= maximum; size += 1) {
        if (!fits(size)) return size - 1;
      }
      return maximum;
    }
    for (let size = preferred - 1; size >= minimum; size -= 1) {
      if (fits(size)) return size;
    }
    return minimum;
  };
  // Every text element is checked against the background it actually sits on.
  // A design that asks for dark text on dark artwork is corrected instead of
  // being rendered as invisible copy.
  const ink = (luminance: number) =>
    luminance < 0.45 ? { strong: "#FFFFFF", soft: "#DCE3EA" } : { strong: "#171A1F", soft: "#3E4650" };
  const text = (
    value: string,
    box: RectEmu,
    fontSizePt: number,
    color: string,
    bold: boolean,
    align: "left" | "center" | "right",
    contentRef?: "title" | "body" | "decorative",
    background?: BackgroundRange | number | null,
    minimumPt = 12,
    runs?: TextRun[],
  ): TextElement => {
    // A long sentence set in display type stops being a headline and starts
    // being a wall. Bold copy over 24 characters is almost always a title, so
    // it gets a ceiling instead of growing until the frame is full.
    const longBoldCap = bold ? (value.length > 36 ? 30 : value.length > 24 ? 34 : undefined) : undefined;
    const fitted = Math.min(fittedFontSize(value, box, fontSizePt, minimumPt), longBoldCap ?? Infinity);
    const range = typeof background === "number" ? { darkest: background, lightest: background } : background;
    const palette = ink(range ? range.darkest : 1);
    const large = isLargeText(fitted, bold);
    const fallback = bold ? palette.strong : palette.soft;
    // null means "the background is artwork we could not sample". Flipping the
    // ink against the page colour in that case is what turned a white template
    // cover title into dark text on a dark picture.
    const resolved =
      range === null
        ? color
        : range
          ? readableTextColorOnRange(color, range, large, fallback)
          : readableTextColor(color, 1, large, fallback);
    return {
      id: crypto.randomUUID() as ElementId,
      type: "text" as const,
      contentRef,
      frame: box,
      rotationMilliDegree: 0,
      locked: false,
      text: value,
      ...(runs && runs.length > 0 ? { runs } : {}),
      style: { fontFamily: majorFont, fontSizePt: fitted, color: resolved, bold, align },
    };
  };
  const shape = (
    box: RectEmu,
    fill: string,
    kind: "rectangle" | "ellipse" = "rectangle",
    stroke = fill,
    strokeWidthPt = 0,
  ) => ({
    id: crypto.randomUUID() as ElementId,
    type: "shape" as const,
    frame: box,
    rotationMilliDegree: 0,
    locked: false,
    shape: kind,
    style: {
      fill,
      stroke,
      strokeWidthPt,
      radiusPt:
        kind === "ellipse"
          ? 999
          : command.styleConstraint?.tokens.corner === "none"
            ? 0
            : command.styleConstraint?.tokens.corner === "rounded"
              ? 14
              : 6,
    },
  });
  const points = (body: string) =>
    body
      .split(/\n+|(?=(?:\d+[.、]|[一二三四五六七八九十]+[、.]|[•·▪])\s*)/)
      .map((value) => value.trim())
      .filter(Boolean);
  const cleanPoint = stripListPrefix;
  // A two-column card reads as a list; a card whose first clause is bold reads
  // as an argument. The split is a presentation of the reviewed sentence, not
  // a rewrite: the run only styles characters that are already there.
  const emphasisLead = (value: string): TextRun[] | undefined => {
    const markers = [
      "可能",
      "将",
      "仍",
      "决定",
      "需要",
      "应当",
      "成为",
      "导致",
      "带来",
      "取决",
      "释放",
      "提升",
      "降低",
      "增长",
      "下降",
      "是",
    ];
    let split = -1;
    for (const marker of markers) {
      const at = value.indexOf(marker);
      if (at >= 4 && (split === -1 || at < split)) split = at;
    }
    if (split < 4) {
      const comma = value.search(/[，,]/);
      if (comma >= 4) split = comma;
    }
    if (split < 4 || split > value.length - 2) return undefined;
    return [{ start: 0, end: split, bold: true }];
  };
  // 整册的构图在画之前就要定下来：模板版式的选择依赖构图，而构图要看着
  // 整册的节奏来定。逐页独立决定构图会让相邻页长成一个样。
  const pageFacts = command.slides.map((content, index) => {
    const design = command.designs[index]!;
    const blocks = content.blocks ?? [];
    const quoteBlock = blocks.find(
      (block): block is Extract<AiContentBlock, { type: "quote" }> => block.type === "quote",
    );
    const blockItems = blocks
      .filter((block): block is Extract<AiContentBlock, { type: "bullet-list" }> => block.type === "bullet-list")
      .flatMap((block) => block.items);
    const items = blockItems.length > 0 ? blockItems : points(content.body);
    const cleanItems = items.map(cleanPoint);
    const facts: CompositionFacts = {
      itemCount: items.length,
      shortItems: cleanItems.every((item) => item.length <= LAYOUT_CAPACITY.shortItemLength),
      longestItemLength: cleanItems.reduce((longest, item) => Math.max(longest, item.length), 0),
      bodyLength: content.body.length,
      hasQuote: Boolean(detectPullQuote({ quoteText: quoteBlock?.text, items })),
      hasComparison: blocks.some((block) => block.type === "comparison"),
      hasRowBlock: blocks.some(
        (block) =>
          block.type === "timeline" || block.type === "process" || block.type === "metric" || block.type === "chart",
      ),
      layout: design.layout,
    };
    return {
      facts,
      requested:
        design.composition && design.composition !== "auto"
          ? design.composition
          : design.visualNarrative
            ? narrativeComposition(design.visualNarrative)
            : design.composition,
    };
  });
  const deckPlan = planDeckCompositions(pageFacts);
  // The layout of every page is decided as a sequence: the deck should rotate
  // through a small set of template layouts instead of repeating one artwork.
  const layoutIntents: TemplateLayoutIntent[] = command.slides.map((content, index) => {
    const design = command.designs[index]!;
    const blocks = content.blocks ?? [];
    const hasBlock = (type: AiContentBlock["type"]) => blocks.some((block) => block.type === type);
    // The template intent must match the composition the renderer will actually
    // produce. An editorial page is drawn on a body-like template, a card grid
    // on a card template, and two columns on a two-column template; choosing
    // artwork that contradicts the composition leaves the new composition on
    // top of the wrong geometry.
    const composition = deckPlan.compositions[index]!;
    if (design.layout === "cover") return "cover";
    if (design.layout === "section") return "section";
    if (isImageRecipe(design.recipe) || design.visualAsset?.enabled) return "image";
    if (hasBlock("comparison")) return "split";
    if (hasBlock("timeline") || hasBlock("process") || hasBlock("metric")) return "cards";
    if (design.layout === "quote") return "quote";
    if (hasBlock("quote") && composition !== "editorial") return "quote";
    if (composition === "editorial") return "body";
    if (composition === "grid") return "cards";
    if (composition === "columns") return "split";
    return "body";
  });
  const layoutRequirements = layoutIntents.map((intent, index) => {
    const base = templateRequirementForIntent(intent);
    const recipe = command.designs[index]!.recipe;
    const catalog = recipe ? RECIPE_CATALOG[recipe] : undefined;
    return catalog
      ? {
          ...base,
          hasImage: base.hasImage || catalog.requiresImage,
          minimumColumns: Math.max(base.minimumColumns, catalog.minimumColumns) as 1 | 2,
        }
      : base;
  });
  const templateLayoutPlan = planTemplateLayoutsWithReport({
    layouts: effectiveLayouts ?? [],
    intents: layoutIntents,
    requirements: layoutRequirements,
    rhythm: command.backgroundRhythm,
  });
  const chosenLayouts = templateLayoutPlan.layouts;
  document.title = command.title.trim();

  return {
    command,
    document,
    templateTheme,
    hasTemplate,
    preset,
    theme,
    typeScale,
    bodyLeading,
    majorFont,
    minorFont,
    effectiveLayouts,
    layouts,
    layoutSpecs,
    pageWidth,
    pageHeight,
    pageWidthIn,
    pageHeightIn,
    frame,
    circleFrame,
    fittedFontSize,
    ink,
    text,
    shape,
    points,
    cleanPoint,
    emphasisLead,
    pageFacts,
    deckPlan,
    layoutIntents,
    layoutRequirements,
    chosenLayouts,
    templateLayoutIssues: templateLayoutPlan.issues,
    compileReports,
  };
}

export type DesignContext = ReturnType<typeof createDesignContext>;

export function buildDesignedSlide(
  context: DesignContext,
  content: Extract<DocumentCommand, { type: "apply-ai-designed-draft" }>["slides"][number],
  index: number,
) {
  const {
    command,
    document,
    hasTemplate,
    preset,
    typeScale,
    bodyLeading,
    majorFont,
    minorFont,
    layouts,
    layoutSpecs,
    pageWidth,
    pageHeight,
    pageWidthIn,
    pageHeightIn,
    frame,
    circleFrame,
    fittedFontSize,
    text,
    shape,
    points,
    cleanPoint,
    emphasisLead,
    deckPlan,
    chosenLayouts,
  } = context;

  const baseDesign = command.designs[index]!;
  // A chosen preset owns the palette: the model's per-page colours are a
  // variation inside that design system, not a reason to leave it.
  const paletteOf = (slot: string) => preset?.theme.colors.find((color) => color.name === slot)?.value;
  const design = preset
    ? {
        ...baseDesign,
        accent: paletteOf("accent") ?? baseDesign.accent,
        // Palette-aware AI designs have already been constrained to this
        // preset. Preserve their dark/light page rhythm. Legacy/manual
        // designs without roles keep the preset's safe defaults.
        background: baseDesign.palette ? baseDesign.background : (paletteOf("surface") ?? baseDesign.background),
        titleColor: baseDesign.palette ? baseDesign.titleColor : (paletteOf("primary") ?? baseDesign.titleColor),
        bodyColor: baseDesign.palette ? baseDesign.bodyColor : (paletteOf("muted") ?? baseDesign.bodyColor),
      }
    : baseDesign;
  const slide = createSlide(index + 1);
  slide.background = design.background;
  const contentBlocks = toContentBlocks(content.blocks);
  slide.content = {
    title: content.title,
    body: content.body,
    ...(contentBlocks ? { blocks: contentBlocks } : {}),
    speakerNotes: content.speakerNotes,
    status: "approved",
  };
  const blocks = content.blocks ?? [];
  const bulletItems = blocks
    .filter((block): block is Extract<AiContentBlock, { type: "bullet-list" }> => block.type === "bullet-list")
    .flatMap((block) => block.items);
  // The structured block is the fact source. Body copy is only a fallback
  // for legacy or hand-authored drafts that do not carry blocks.
  const items = bulletItems.length > 0 ? bulletItems : points(content.body);
  const timelineBlock = blocks.find(
    (block): block is Extract<AiContentBlock, { type: "timeline" }> => block.type === "timeline",
  );
  const comparisonBlock = blocks.find(
    (block): block is Extract<AiContentBlock, { type: "comparison" }> => block.type === "comparison",
  );
  const processBlock = blocks.find(
    (block): block is Extract<AiContentBlock, { type: "process" }> => block.type === "process",
  );
  const quoteBlock = blocks.find(
    (block): block is Extract<AiContentBlock, { type: "quote" }> => block.type === "quote",
  );
  const metricBlocks = blocks.filter(
    (block): block is Extract<AiContentBlock, { type: "metric" }> => block.type === "metric",
  );
  // A table block is rendered as a native table: the exporter writes real
  // table cells, so the reviewer keeps an editable grid instead of a picture.
  const tableBlock = blocks.find(
    (block): block is Extract<AiContentBlock, { type: "table-data" }> => block.type === "table-data",
  );
  const chartBlock = blocks.find(
    (block): block is Extract<AiContentBlock, { type: "chart" }> => block.type === "chart",
  );
  // A quoted line already present in the reviewed copy can carry the page
  // as a pull quote. It is a visual emphasis of existing content, never a
  // new claim, and gives dense list pages an editorial anchor.
  const pullQuote = detectPullQuote({ quoteText: quoteBlock?.text, items });
  // A short summary or split page without a quotation still needs a visual
  // anchor. A count panel uses the real number of points, so it fills the
  // right side without inventing a headline or duplicating a bullet.
  const shortItems = items.every((item) => cleanPoint(item).length <= LAYOUT_CAPACITY.shortItemLength);
  const longestItemLength = items.reduce((longest, item) => Math.max(longest, cleanPoint(item).length), 0);
  const hasDeterministicBlock = Boolean(
    timelineBlock || comparisonBlock || processBlock || metricBlocks.length > 0 || tableBlock || chartBlock,
  );
  // A picture for this page. It is generated outside the document, so a page
  // without one simply has no picture: the deck still stands without it.
  const visualAsset = command.visualAssets?.find((asset) => asset.slideIndex === index);
  // The rendered artwork and the placeholder geometry describe the same
  // layout, so editable text has to land on the geometry of the layout that
  // was actually chosen. Dropping the geometry whenever a background image
  // existed is what pushed the text onto a hard coded grid and left the
  // template design unused.
  const recipe = chosenLayouts[index];
  // A page that was designed against a template layout keeps a reference to
  // it. The exporter turns that reference into a real slide master, so the
  // exported deck still carries the structure of the template instead of a
  // flat list of shapes.
  if (recipe) {
    let spec = layoutSpecs.get(recipe.index);
    if (!spec) {
      const backgroundColor =
        recipe.backgroundColor && HEX_COLOR_PATTERN.test(recipe.backgroundColor)
          ? recipe.backgroundColor.toUpperCase()
          : undefined;
      spec = {
        id: crypto.randomUUID(),
        name: recipe.name?.trim() || `模板版式 ${recipe.index + 1}`,
        ...(backgroundColor ? { backgroundColor } : {}),
        // What this layout can hold, so a later check knows whether a page's
        // picture had a placeholder to land in.
        capabilities: layoutCapabilities(recipe.regions),
      };
      layoutSpecs.set(recipe.index, spec);
      layouts.push(spec);
    }
    slide.layoutId = spec.id;
  }
  const recipeTitleRegion = recipe ? templateTitleRegion(recipe) : undefined;
  const recipeContentRegion = recipe ? templateContentRegion(recipe) : undefined;
  const recipeColumnRegions = recipe ? templateColumnRegions(recipe) : undefined;
  const recipeTitle = recipeTitleRegion?.frame;
  const recipeContent = recipeContentRegion?.frame;
  // The template states which ink and which size each placeholder was drawn
  // with. Using them keeps a generated page inside the template's own
  // typography instead of substituting a guessed palette. A design that
  // explicitly overrides the ink (the contrast repair does) wins instead,
  // otherwise the repair could never take effect.
  const titleInk = design.inkOverride ? design.titleColor : (recipeTitleRegion?.textColor ?? design.titleColor);
  const bodyInk = design.inkOverride ? design.bodyColor : (recipeContentRegion?.textColor ?? design.bodyColor);
  const templateTitleSize = recipeTitleRegion?.fontSizePt;
  const templateBodySize = recipeContentRegion?.fontSizePt;
  const templateColumnSize = recipeColumnRegions?.[0]?.fontSizePt;
  const artworkTreatment = design.backgroundTreatment ?? "none";
  const keepsArtwork = artworkTreatment !== "simplify" && Boolean(recipe?.backgroundImageDataUrl);
  slide.background = recipe?.backgroundColor ?? design.background;
  const pageLuminance = colorLuminance(slide.background) ?? 1;
  // The artwork under the placeholders is a range, not a single value: the
  // ink has to read on the patch that carries the text. The probe describes
  // artwork that is only painted when the layout is actually kept; on a flat
  // page it would describe a picture that is not there and turn the title
  // white on a light background.
  const titleBackground = keepsArtwork ? recipe?.backgroundLuminance?.title : undefined;
  const bodyBackground = keepsArtwork ? (recipe?.backgroundLuminance?.body ?? titleBackground) : undefined;
  // null: the artwork is present but its luminance was not sampled. The
  // page colour says nothing about the picture; keep the template/form ink
  // instead of flipping it against a white page.
  const titleLuminance = keepsArtwork && !titleBackground ? null : (titleBackground ?? pageLuminance);
  const bodyLuminance = bodyBackground ?? pageLuminance;
  const isSafeRegion = (
    candidate: { x: number; y: number; width: number; height: number } | undefined,
    minimumWidth: number,
    minimumHeight: number,
  ) =>
    Boolean(
      candidate &&
      candidate.x >= 0 &&
      candidate.y >= 0 &&
      candidate.width >= minimumWidth &&
      candidate.height >= minimumHeight &&
      candidate.x + candidate.width <= 1 &&
      candidate.y + candidate.height <= 1,
    );
  const safeFrame = (
    candidate: { x: number; y: number; width: number; height: number } | undefined,
    fallback: [number, number, number, number],
    minimumWidth = 0.25,
    minimumHeight = 0.08,
  ) =>
    isSafeRegion(candidate, minimumWidth, minimumHeight)
      ? frame(candidate!.x, candidate!.y, candidate!.width, candidate!.height)
      : frame(...fallback);
  const [leftRecipe, rightRecipe] = recipeColumnRegions?.map((region) => region.frame) ?? [];
  const hasSafeColumns =
    isSafeRegion(leftRecipe, 0.25, 0.25) &&
    isSafeRegion(rightRecipe, 0.25, 0.25) &&
    leftRecipe!.x + leftRecipe!.width <= rightRecipe!.x &&
    Math.abs(leftRecipe!.y - rightRecipe!.y) < 0.18;
  const intersects = (left: AiNormalizedRect, right: AiNormalizedRect) =>
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
  const insetObstacle = (region: AiNormalizedRect): AiNormalizedRect => ({
    x: Math.max(0, region.x - 0.015),
    y: Math.max(0, region.y - 0.015),
    width: Math.min(1, region.width + 0.03),
    height: Math.min(1, region.height + 0.03),
  });
  const obstacles = (design.obstacleRegions ?? [])
    .filter((region) => isSafeRegion(region, 0.001, 0.001))
    .map(insetObstacle);
  const largestFreeRegion = (source: AiNormalizedRect): AiNormalizedRect => {
    let candidates = [source];
    for (const obstacle of obstacles) {
      candidates = candidates.flatMap((candidate) => {
        if (!intersects(candidate, obstacle)) return [candidate];
        const right = candidate.x + candidate.width;
        const bottom = candidate.y + candidate.height;
        const obstacleRight = obstacle.x + obstacle.width;
        const obstacleBottom = obstacle.y + obstacle.height;
        return [
          {
            x: candidate.x,
            y: candidate.y,
            width: Math.max(0, obstacle.x - candidate.x),
            height: candidate.height,
          },
          {
            x: Math.min(right, obstacleRight),
            y: candidate.y,
            width: Math.max(0, right - Math.max(candidate.x, obstacleRight)),
            height: candidate.height,
          },
          { x: candidate.x, y: candidate.y, width: candidate.width, height: Math.max(0, obstacle.y - candidate.y) },
          {
            x: candidate.x,
            y: Math.min(bottom, obstacleBottom),
            width: candidate.width,
            height: Math.max(0, bottom - Math.max(candidate.y, obstacleBottom)),
          },
        ].filter((region) => region.width >= 0.28 && region.height >= 0.2);
      });
    }
    return candidates.sort((left, right) => right.width * right.height - left.width * left.height)[0] ?? source;
  };
  // The deck direction owns the page margin, but only when nothing more
  // authoritative does: a template's placeholders and a reviewed safe
  // region both win over the direction's surface profile.
  const deckConcept = command.designConcept;
  const deckSurface = deckConcept?.surface;
  const explicitSafe = design.safeRegion && isSafeRegion(design.safeRegion, 0.3, 0.25) ? design.safeRegion : undefined;
  const surfaceSafe = !explicitSafe && !hasTemplate && deckSurface ? surfaceSafeRegion(deckSurface) : undefined;
  const requestedSafe = explicitSafe ?? surfaceSafe ?? { x: 0.07, y: 0.12, width: 0.86, height: 0.75 };
  const visualSafe = largestFreeRegion(requestedSafe);
  const safeLeft = visualSafe?.x ?? DEFAULT_CONTENT_REGION.left;
  const safeRight = visualSafe ? visualSafe.x + visualSafe.width : DEFAULT_CONTENT_REGION.right;
  const safeTop = visualSafe?.y ?? DEFAULT_CONTENT_REGION.top;
  const safeBottom = visualSafe ? visualSafe.y + visualSafe.height : DEFAULT_CONTENT_REGION.bottom;
  const alignmentGrid = {
    left: safeLeft,
    right: safeRight,
    titleY: safeTop,
    titleHeight: Math.min(0.1, (safeBottom - safeTop) * 0.18),
    ruleY: safeTop + Math.min(0.12, (safeBottom - safeTop) * 0.22),
    contentY: safeTop + Math.min(CONTENT_REGION.contentTopOffset, (safeBottom - safeTop) * 0.3),
    contentBottom: safeBottom,
  } as const;
  slide.elements = [];
  if (keepsArtwork)
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "image",
      placement: "layout-background",
      frame: frame(0, 0, 1, 1),
      rotationMilliDegree: 0,
      locked: true,
      source: { kind: "embedded", dataUrl: recipe!.backgroundImageDataUrl!, mimeType: "image/png" },
      altText: `模板版式背景：${recipe!.name ?? recipe!.index}`,
    });
  // A scrim belongs to the text block only. Painting the whole page erased the
  // template artwork and was the single biggest reason a generated deck looked
  // like a blank sheet with a coloured border.
  // The scrim restores the flat page colour over busy artwork. Using the
  // design background painted a black box on a white page: the design's
  // background is not the page's background.
  const scrimFill = slide.background;
  const scrimLuminance = colorLuminance(scrimFill) ?? 1;
  const contentRegion = recipeContent ?? {
    x: alignmentGrid.left,
    y: alignmentGrid.contentY,
    width: alignmentGrid.right - alignmentGrid.left,
    height: alignmentGrid.contentBottom - alignmentGrid.contentY,
  };
  const titleBox = recipeTitle ?? {
    x: alignmentGrid.left,
    y: alignmentGrid.titleY,
    width: alignmentGrid.right - alignmentGrid.left,
    height: alignmentGrid.titleHeight,
  };
  // Template ornaments are painted before the copy, so an ornament that runs
  // across the title sits under the glyphs and reads as a printing accident.
  // A small shape that overlaps the title box is dropped; a large panel
  // behind the title is a background and is kept.
  const titleGuard = {
    x: titleBox.x - 0.004,
    y: titleBox.y - 0.004,
    width: titleBox.width + 0.008,
    height: titleBox.height + 0.008,
  };
  const decorationCovers = (decoration: AiTemplateDecoration): number => {
    const width =
      Math.min(decoration.frame.x + decoration.frame.width, titleGuard.x + titleGuard.width) -
      Math.max(decoration.frame.x, titleGuard.x);
    const height =
      Math.min(decoration.frame.y + decoration.frame.height, titleGuard.y + titleGuard.height) -
      Math.max(decoration.frame.y, titleGuard.y);
    if (width <= 0 || height <= 0) return 0;
    return (width * height) / Math.max(1e-6, decoration.frame.width * decoration.frame.height);
  };
  const decorations = keepsArtwork ? [] : [...(command.templateDecorations ?? []), ...(recipe?.decorations ?? [])];
  decorations.forEach((decoration) => {
    if (!isSafeRegion(decoration.frame, 0.001, 0.001)) return;
    const area = decoration.frame.width * decoration.frame.height;
    if (area < 0.06 && decorationCovers(decoration) > 0.2) return;
    slide.elements.push(
      shape(
        frame(decoration.frame.x, decoration.frame.y, decoration.frame.width, decoration.frame.height),
        decoration.fill,
        decoration.shape,
      ),
    );
  });
  // A direction owns which picture roles a page may use. A hero requested by
  // a text-first direction becomes a side picture instead of disappearing;
  // the fallback is reported by the direction resolver, not silently lost.
  const requestedRole = design.visualAsset?.role;
  const allowedImagery = deckConcept?.imageryRoles;
  const clampedRole =
    requestedRole && allowedImagery && !allowedImagery.includes(requestedRole)
      ? (allowedImagery.find(
          (role): role is AiVisualAssetRole => role === "hero" || role === "band" || role === "side",
        ) ?? undefined)
      : requestedRole;
  const imageryEnabled = !allowedImagery || allowedImagery.some((role) => role !== "none");
  // A picture takes its own place on the page and the text moves out of its
  // way. The image is never laid over the copy: a page where the text is
  // unreadable under a picture is worse than a page without a picture.
  const assetPlan = resolveVisualAsset({
    layout: design.layout,
    itemCount: items.length,
    hasDeterministicBlock,
    requested: Boolean(visualAsset && design.visualAsset?.enabled) && imageryEnabled,
    requestedRole: clampedRole,
    allowHeroOnContent: Boolean(deckConcept?.surface === "full-bleed" && deckConcept.imageryRoles.includes("hero")),
  });
  const assetLayout =
    visualAsset && assetPlan.enabled && assetPlan.role
      ? planVisualAssetLayout(assetPlan.role, contentRegion, pageWidth, pageHeight)
      : undefined;
  // The text area shrinks to whatever the picture left behind.
  const contentBox = assetLayout ? assetLayout.text : contentRegion;
  // The same text area in the units the element frames use.
  const contentAreaEmu = frame(contentBox.x, contentBox.y, contentBox.width, contentBox.height);
  // One chrome per page: title axis, accent rule and content region. Every
  // recipe and every legacy branch reads this object instead of inventing
  // its own title y / rule y / content top. That is what keeps six pages of
  // one deck on the same axis.
  const chrome = planPageChrome({
    page: { width: pageWidth, height: pageHeight },
    title: frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height),
    content: frame(contentBox.x, contentBox.y, contentBox.width, contentBox.height),
    safe: {
      x: safeLeft,
      y: safeTop,
      width: safeRight - safeLeft,
      height: safeBottom - safeTop,
    },
    // A template owns its header line and ornaments. Drawing the recipe
    // rule under the template's own rule produced a double header on the
    // generated templates; the content rules stay, the header rule does not.
    showRule: !hasTemplate && (deckSurface ? surfaceShowsRule(deckSurface) : true),
  });
  // A rail surface needs its rail drawn: the wide left margin alone reads as
  // a mistake. One hairline at the inner edge is the direction's signature,
  // and it is drawn here so every recipe shares it. Templates own their own
  // ornaments, so the rail never appears on a template page.
  if (!hasTemplate && deckSurface === "rail") {
    slide.elements.push(
      shape(
        frame(chrome.title.x - 0.035, chrome.title.y, 0.004, Math.max(0.1, chrome.contentBottom - chrome.title.y)),
        design.accent,
      ),
    );
  }
  // The intent of the page: which composition it is drawn in, which level of
  // the hierarchy carries the weight and how much white space it spends.
  // The composition is checked against the reviewed content, so an intent
  // that the content cannot carry is refused instead of producing a page
  // that does not hold its own copy.
  const compositionFacts: CompositionFacts = {
    itemCount: items.length,
    shortItems,
    longestItemLength,
    bodyLength: content.body.length,
    hasQuote: Boolean(pullQuote),
    hasComparison: Boolean(comparisonBlock),
    hasRowBlock: Boolean(timelineBlock || processBlock || metricBlocks.length > 0 || chartBlock),
    hasMetric: metricBlocks.length > 0,
    hasChart: Boolean(chartBlock),
    hasTimeline: Boolean(timelineBlock),
    hasProcess: Boolean(processBlock),
    hasTable: Boolean(tableBlock),
    layout: design.layout,
  };
  const intent = resolvePageDesign({
    composition: deckPlan.compositions[index],
    emphasis: design.emphasis,
    densityTarget: design.densityTarget,
    facts: compositionFacts,
  });
  const emphasis = EMPHASIS_FACTORS[intent.emphasis];
  const density = DENSITY_FACTORS[intent.density];
  // An editorial page needs room for a numbered column and an anchor panel
  // beside it. A page that does not have that room falls back to the
  // composition its own layout would have produced.
  const composition =
    intent.composition === "editorial" && (contentBox.width < 0.55 || contentBox.height < 0.35)
      ? autoComposition(compositionFacts, { allowEditorial: false })
      : intent.composition;
  // A short summary or split page without a quotation still needs a visual
  // anchor. A count panel uses the real number of points, so it fills the
  // right side without inventing a headline or duplicating a bullet.
  const countPanel =
    !pullQuote &&
    (design.layout === "summary" || design.layout === "split" || composition === "editorial") &&
    items.length >= LAYOUT_CAPACITY.panelMinItems &&
    items.length <= LAYOUT_CAPACITY.panelMaxItems &&
    shortItems;
  if (artworkTreatment === "local-scrim") {
    slide.elements.push(
      shape(
        frame(
          Math.max(0, contentBox.x - 0.02),
          Math.max(0, contentBox.y - 0.02),
          Math.min(1 - Math.max(0, contentBox.x - 0.02), contentBox.width + 0.04),
          Math.min(1 - Math.max(0, contentBox.y - 0.02), contentBox.height + 0.04),
        ),
        scrimFill,
      ),
    );
  }
  // The picture goes on the page before the text, so the text stays on top of
  // it wherever the two touch. The picture is cropped to fill its box: a
  // stretched picture is the fastest way to make a generated deck look fake.
  if (visualAsset && assetLayout) {
    const imageFrame = frame(
      assetLayout.image.x,
      assetLayout.image.y,
      assetLayout.image.width,
      assetLayout.image.height,
    );
    const crop = coverCrop(
      { width: visualAsset.naturalWidth, height: visualAsset.naturalHeight },
      { width: assetLayout.image.width * pageWidth, height: assetLayout.image.height * pageHeight },
    );
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "image",
      placement: "content",
      frame: imageFrame,
      rotationMilliDegree: 0,
      locked: false,
      source: { kind: "embedded", dataUrl: visualAsset.dataUrl, mimeType: visualAsset.mimeType },
      altText: visualAsset.altText,
      ...(crop ? { crop } : {}),
    });
  }
  const contentTextLuminance =
    artworkTreatment === "local-scrim" ? scrimLuminance : keepsArtwork && !bodyBackground ? null : bodyLuminance;
  // A white card on a white page is invisible. Pick a surface that separates
  // the card from the page while keeping dark body ink readable.
  const cardFill = pageLuminance < 0.45 ? "#FFFFFF" : "#F3F5F7";
  const cardStroke = pageLuminance < 0.45 ? "#FFFFFF" : "#E2E7EC";
  const cardLuminance = colorLuminance(cardFill) ?? 0.9;
  const accentLuminance = colorLuminance(design.accent) ?? pageLuminance;
  // Badges and header bars carry white text, so the brand accent is only
  // used as their fill when it can hold white; otherwise it is deepened
  // instead of letting the numerals turn into unreadable ink.
  const accentFill = fillForInk("#FFFFFF", design.accent);
  const accentFillLuminance = colorLuminance(accentFill) ?? accentLuminance;
  // Text is drawn from the top of its frame, so a block that has to look
  // centred inside a slot starts half its own height above the middle of
  // the slot. The height comes from the same line estimator the quality
  // gate uses, so a centred block is never cut off.
  const pointsToFraction = (points: number) => points / 72 / (pageHeight / 914400);
  const blockHeight = (value: string, widthFraction: number, fontSizePt: number, lineHeight = 1.25) => {
    const widthPt = widthFraction * (pageWidth / 914400) * 72;
    return pointsToFraction(estimateTextLines(value, widthPt, fontSizePt, majorFont) * fontSizePt * lineHeight);
  };
  const centeredBlock = (
    value: string,
    slot: { x: number; y: number; width: number; height: number },
    fontSizePt: number,
  ) => {
    const height = blockHeight(value, slot.width, fontSizePt) * 1.04;
    return frame(slot.x, slot.y + slot.height / 2 - height / 2, slot.width, height);
  };
  /**
   * 把一个文字框收进文字区。
   *
   * 封面和章节页的标题框来自模板占位或固定比例，不看内容区的宽窄。
   * 页面右侧放了图之后，这些框会一直伸到图下面，标题就压在图上了。
   * 收进文字区之后，标题停在图开始的地方。
   */
  const clipToTextArea = (box: RectEmu, area: RectEmu): RectEmu => {
    const right = Math.min(box.x + box.width, area.x + area.width);
    const bottom = Math.min(box.y + box.height, area.y + area.height);
    const left = Math.max(box.x, area.x);
    const top = Math.max(box.y, area.y);
    // 完全在文字区之外的框保持原样：收成一个零宽的框会让文字消失。
    if (right <= left || bottom <= top) return box;
    return { x: left as Emu, y: top as Emu, width: (right - left) as Emu, height: (bottom - top) as Emu };
  };
  // A concept page is drawn by a pure recipe before the legacy branch chain.
  // The recipe only appends content elements; background artwork, scrim,
  // footer, contrast repairs and visual repairs remain in the shared passes
  // below. Every reviewed item is checked by `consumed`; a recipe that would
  // drop copy throws instead of writing the page.
  const recipePlan = (() => {
    const concept = command.designConcept;
    // A recipe only appends content elements, so a template's background,
    // Logo and decorations stay in place. The recipe still has to fit the
    // template's title/body placeholders, which the chrome above carries.
    if (!concept) return undefined;
    const hasActualAsset = Boolean(visualAsset && assetLayout);
    const templateImage = recipe ? templateImageRegion(recipe)?.frame : undefined;
    const pageIndex = command.pageContext?.index ?? index;
    const pageTotal = command.pageContext?.total ?? command.slides.length;
    const tokens = deriveDesignTokens(
      document.theme,
      document.pageSize,
      concept,
      design.designPlan?.typeScale,
      command.styleConstraint,
    );
    const applyStyleMaterialTokens = (elements: typeof slide.elements) => {
      if (!command.styleConstraint) return;
      for (const element of elements) {
        if (element.type === "shape" && element.shape !== "ellipse") {
          const widthRatio = element.frame.width / pageWidth;
          const heightRatio = element.frame.height / pageHeight;
          const isPanel = widthRatio >= 0.08 && heightRatio >= 0.06 && widthRatio * heightRatio < 0.82;
          if (isPanel) {
            element.style.radiusPt = tokens.radius.cardPt;
            if (tokens.material.shadow === "raised") element.style.shadow = "raised";
            else if (tokens.material.shadow === "paper") element.style.shadow = "card";
            else delete element.style.shadow;
          }
          if (element.style.strokeWidthPt > 0) element.style.strokeWidthPt = tokens.rule.hairlinePt;
        } else if (element.type === "line") {
          element.style.strokeWidthPt = tokens.rule.hairlinePt;
        } else if (element.type === "image" && element.placement === "content") {
          if (tokens.radius.cardPt >= 10) element.frameShape = "roundRect";
          else if (tokens.radius.cardPt === 0) delete element.frameShape;
          if (element.crop && tokens.material.imageCrop !== "editorial") {
            const factor = tokens.material.imageCrop === "contained" ? 0.35 : 1;
            element.crop = {
              top: element.crop.top * factor,
              bottom: element.crop.bottom * factor,
              left: element.crop.left * factor,
              right: element.crop.right * factor,
            };
          }
        }
      }
    };
    // The template artwork is the background the recipe actually paints on.
    // A dark artwork needs the title ink as the accent, otherwise the
    // numbers and rules disappear into the picture.
    const artworkDark = keepsArtwork
      ? (bodyBackground?.darkest ?? titleBackground?.darkest ?? pageLuminance) < 0.45
      : pageLuminance < 0.45;
    const accentInk = artworkDark ? titleInk : design.accent;
    const ruleInk = artworkDark ? "#DCE3EA" : "#E2E7EC";
    // The semantic roles come from the design system when the deck has one, and
    // from the page's own inks otherwise. A template page has no preset to ask,
    // and its background may be a photograph: deriving from the ink that this
    // page actually uses is the only way a card on it is not the color of the
    // page.
    const semantic = deriveSemanticColors({
      surface: slide.background,
      ink: bodyInk,
      accent: design.accent,
    });
    // The stored roles of a preset belong to the surface they were derived
    // from. A light preset used on a dark page would hand out its white raised
    // surface while the page still draws light ink — a card nobody can read.
    // Whenever the page's appearance differs from the preset's, the page derives
    // its own set.
    const presetSurface = paletteOf("surface");
    const rolesFitThisPage = presetSurface !== undefined && sameAppearance(presetSurface, slide.background);
    const semanticOf = <K extends keyof typeof semantic>(slot: K): string =>
      (rolesFitThisPage ? paletteOf(slot) : undefined) ?? semantic[slot];
    const recipeColors: RecipeContext["colors"] = {
      title: titleInk,
      body: bodyInk,
      accent: accentInk,
      background: slide.background,
      rule: ruleInk,
      card: cardFill,
      // The accent as a surface, not as an ink: a full-bleed panel keeps the
      // brand tone and is deepened only until white copy reads on it. Reusing
      // `accentInk` here turned dark pages into white gradients.
      //
      // A coloured page is its own field, so its panel is a deeper tone of that
      // field rather than a second accent hue: a teal chapter page with a blue
      // block reads as two unrelated brands.
      panel: fillForInk("#FFFFFF", pageLuminance < 0.45 ? slide.background : design.accent),
      surfaceRaised: semanticOf("surfaceRaised"),
      surfaceSunken: semanticOf("surfaceSunken"),
      border: semanticOf("border"),
      borderStrong: semanticOf("borderStrong"),
      textMuted: semanticOf("textMuted"),
      accentSubtle: semanticOf("accentSubtle"),
      accentStrong: semanticOf("accentStrong"),
      onAccent: semanticOf("onAccent"),
      // The second and third brand colours are only passed through, for the
      // charts that need more than one series. A theme without them lets the
      // chart derive its own second colour.
      ...(paletteOf("accent2") ? { accent2: paletteOf("accent2")! } : {}),
      ...(paletteOf("accent3") ? { accent3: paletteOf("accent3")! } : {}),
    };
    const recipeFrame = {
      title: frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height),
      content: frame(contentBox.x, contentBox.y, contentBox.width, contentBox.height),
      safe: {
        x: safeLeft,
        y: safeTop,
        width: safeRight - safeLeft,
        height: safeBottom - safeTop,
      },
      page: { width: pageWidth, height: pageHeight },
    };
    // The design agent writes a semantic plan; the compiler owns geometry.
    // A refused plan falls through to the legacy branch rather than writing
    // a half-consumed page.
    if (design.designPlan) {
      const compiled = compileDesignPlanWithRetry({
        plan: design.designPlan,
        content: slide.content,
        facts: compositionFacts,
        concept,
        ...(command.styleConstraint ? { stylePreferredRecipes: command.styleConstraint.preferredRecipes } : {}),
        tokens,
        colors: recipeColors,
        frame: recipeFrame,
        page: { index: pageIndex, total: pageTotal },
        chrome,
        ...(templateImage ? { templateImage } : {}),
        hasTemplate,
        hasArtwork: keepsArtwork,
        hasAsset: hasActualAsset,
        ...(hasActualAsset && assetPlan.role ? { assetRole: assetPlan.role } : {}),
      });
      context.compileReports.push({ slideIndex: index, report: compiled.compileReport });
      if (!("elements" in compiled)) return undefined;
      const problem = consumptionProblem(compiled, slide.content);
      if (problem) throw new Error(`AI_DESIGN_CONTENT_LOSS: ${problem}`);
      applyStyleMaterialTokens(compiled.elements);
      return compiled;
    }
    const recipeOptions = {
      hasArtwork: keepsArtwork,
      hasAsset: hasActualAsset,
      hasTemplate,
      ...(templateImage ? { hasTemplateImage: true } : {}),
      ...(hasActualAsset && assetPlan.role ? { assetRole: assetPlan.role } : {}),
    };
    const styleRecipe = command.styleConstraint
      ? selectPreferredStyleRecipe(command.styleConstraint.preferredRecipes, {
          facts: compositionFacts,
          concept,
          options: recipeOptions,
        })
      : undefined;
    const selection = selectRecipe({
      facts: compositionFacts,
      concept,
      requested: styleRecipe ?? design.recipe,
      options: recipeOptions,
    });
    if (!selection.recipe) return undefined;
    const plan = selection.recipe.plan({
      content: slide.content,
      facts: compositionFacts,
      concept,
      tokens,
      colors: recipeColors,
      frame: recipeFrame,
      page: { index: pageIndex, total: pageTotal },
      chrome,
      hasArtwork: keepsArtwork,
      ...(templateImage ? { templateImage } : {}),
      ...(design.variant ? { variant: design.variant } : {}),
      ...(design.focal ? { focal: design.focal } : {}),
    });
    if (!("elements" in plan)) return undefined;
    const problem = consumptionProblem(plan, slide.content);
    if (problem) throw new Error(`AI_DESIGN_CONTENT_LOSS: ${problem}`);
    return plan;
  })();
  if (recipePlan) {
    slide.elements.push(...recipePlan.elements);
    if (recipePlan.imageFrame && visualAsset) {
      // The picture was placed before the recipe with the default side/band
      // geometry. A recipe that owns the picture may give it a larger frame;
      // recomputing the crop keeps the image from stretching.
      for (let imageIndex = slide.elements.length - 1; imageIndex >= 0; imageIndex -= 1) {
        const candidate = slide.elements[imageIndex]!;
        if (candidate.type !== "image" || candidate.placement !== "content") continue;
        candidate.frame = frame(
          recipePlan.imageFrame.x,
          recipePlan.imageFrame.y,
          recipePlan.imageFrame.width,
          recipePlan.imageFrame.height,
        );
        const crop = coverCrop(
          { width: visualAsset.naturalWidth, height: visualAsset.naturalHeight },
          { width: candidate.frame.width, height: candidate.frame.height },
        );
        if (crop) candidate.crop = crop;
        else delete candidate.crop;
        // The composition owns the frame shape as well: a picture that became a
        // plate keeps the corner the recipe asked for, and one the recipe did
        // not shape goes back to a plain frame.
        if (recipePlan.imageShape) candidate.frameShape = recipePlan.imageShape;
        else delete candidate.frameShape;
        // Same rule for the tone: the composition asks for it on the pages where
        // the picture is the field, and a page that does not ask gets the
        // picture's own colours back (no stale tone from a previous plan).
        if (recipePlan.imageTone) candidate.tone = recipePlan.imageTone;
        else delete candidate.tone;
        break;
      }
    }
  } else if (design.layout === "cover" && !hasDeterministicBlock) {
    const coverTitle = safeFrame(recipeTitle, [0.1, 0.24, 0.78, 0.28], 0.25, 0.04);
    const coverBody = safeFrame(recipeContent, [0.1, 0.56, 0.72, 0.16], 0.25, 0.08);
    // A picture on the cover takes the right side of the page, so the
    // headline and the subtitle have to stop where the picture starts.
    // Otherwise the title runs underneath the picture.
    const clippedTitle = clipToTextArea(coverTitle, contentAreaEmu);
    const clippedBody = clipToTextArea(coverBody, contentAreaEmu);
    // A four-character title at display size looks like a caption on a
    // 13-inch page. A short cover title may grow to hold the page; a long
    // one keeps the display size, because the frame is the limit.
    const coverTitleSize =
      templateTitleSize ??
      (content.title.trim().length <= 8 ? Math.min(72, Math.round(typeScale.display * 1.5)) : typeScale.display);
    if (!keepsArtwork)
      slide.elements.push(
        shape(frame(0, 0, 0.035, 1), design.accent),
        shape(frame(0.08, 0.7, 0.18, 0.018), design.accent),
      );
    slide.elements.push(
      text(content.title, clippedTitle, coverTitleSize, titleInk, true, "left", undefined, titleLuminance),
    );
    if (content.body.trim())
      slide.elements.push(
        text(
          content.body,
          clippedBody,
          templateBodySize ?? typeScale.subtitle,
          bodyInk,
          false,
          "left",
          undefined,
          contentTextLuminance,
        ),
      );
  } else if (design.layout === "section" && !hasDeterministicBlock) {
    const sectionTitle = safeFrame(recipeTitle, [0.39, 0.3, 0.5, 0.22], 0.25, 0.04);
    const sectionBody = safeFrame(recipeContent, [0.39, 0.56, 0.47, 0.2], 0.25, 0.08);
    // The template draws its own section number into the artwork, so PPTD must
    // not add a second one on top of it.
    if (!keepsArtwork)
      slide.elements.push(
        shape(frame(0, 0, 0.32, 1), design.accent),
        text(
          String(index + 1).padStart(2, "0"),
          frame(0.07, 0.17, 0.16, 0.18),
          52,
          "#FFFFFF",
          true,
          "left",
          undefined,
          accentLuminance,
        ),
      );
    slide.elements.push(
      text(
        content.title,
        clipToTextArea(sectionTitle, contentAreaEmu),
        templateTitleSize ?? typeScale.section,
        titleInk,
        true,
        "left",
        undefined,
        titleLuminance,
      ),
    );
    if (content.body.trim())
      slide.elements.push(
        text(
          content.body,
          clipToTextArea(sectionBody, contentAreaEmu),
          templateBodySize ?? typeScale.body,
          bodyInk,
          false,
          "left",
          undefined,
          contentTextLuminance,
        ),
      );
  } else if (timelineBlock) {
    // Every reviewed step is drawn. A timeline that cut its last steps
    // would drop reviewed copy from the exported file, so the row narrows
    // and the type shrinks instead.
    const timelineItems = timelineBlock.items;
    slide.elements.push(
      text(
        content.title,
        frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height),
        templateTitleSize ?? typeScale.title,
        titleInk,
        true,
        "left",
        undefined,
        titleLuminance,
      ),
    );
    if (!keepsArtwork)
      slide.elements.push(
        shape(
          frame(titleBox.x, titleBox.y + titleBox.height + 0.03, Math.min(0.12, titleBox.width * 0.2), 0.012),
          design.accent,
        ),
      );
    const startX = contentBox.x + contentBox.width * 0.05;
    const endX = contentBox.x + contentBox.width * 0.95;
    const lineY = contentBox.y + contentBox.height * 0.45;
    const stepGap = timelineItems.length > 1 ? (endX - startX) / (timelineItems.length - 1) : endX - startX;
    const itemWidth = Math.min(0.22, contentBox.width * 0.18, stepGap * 0.92);
    slide.elements.push(shape(frame(startX, lineY, endX - startX, 0.008), design.accent));
    const lineGap = 0.03;
    const labelFraction = pointsToFraction(15 * 1.3);
    const textFraction = pointsToFraction(13 * 1.3 * 2);
    timelineItems.forEach((item, itemIndex) => {
      const x = timelineItems.length === 1 ? (startX + endX) / 2 : startX + itemIndex * stepGap;
      const above = itemIndex % 2 === 0;
      slide.elements.push(shape(circleFrame(x, lineY - 0.15 / pageHeightIn, 0.3), design.accent, "ellipse"));
      // Label and sentence each stay on their own side of the line. The old
      // frames were anchored to the line by a fraction of the content area
      // and were taller than the space they were given, so the sentence of
      // an above item was drawn across the line and its dots.
      const itemLeft = Math.max(contentBox.x, Math.min(x - itemWidth / 2, contentBox.x + contentBox.width - itemWidth));
      const labelY = above ? lineY - lineGap - textFraction - 0.005 - labelFraction : lineY + lineGap;
      const textY = above ? lineY - lineGap - textFraction : labelY + labelFraction + 0.005;
      const labelFrame = frame(itemLeft, Math.max(contentBox.y, labelY), itemWidth, labelFraction);
      const stepTextFrame = frame(itemLeft, textY, itemWidth, textFraction);
      const labelSize = fittedFontSize(item.label, labelFrame, 15, 10);
      slide.elements.push(
        text(item.label, labelFrame, labelSize, design.accent, true, "center", undefined, contentTextLuminance),
      );
      const stepTextSize = fittedFontSize(item.text, stepTextFrame, 13, 9);
      slide.elements.push(
        text(item.text, stepTextFrame, stepTextSize, bodyInk, false, "center", undefined, contentTextLuminance),
      );
    });
  } else if (comparisonBlock) {
    slide.elements.push(
      text(
        content.title,
        frame(chrome.title.x, chrome.title.y, chrome.title.width, chrome.title.height),
        templateTitleSize ?? typeScale.title,
        titleInk,
        true,
        "left",
        undefined,
        titleLuminance,
      ),
    );
    if (!keepsArtwork)
      slide.elements.push(
        shape(
          frame(chrome.rule.x, chrome.rule.y, chrome.rule.width, Math.max(0.009, chrome.rule.height)),
          design.accent,
        ),
      );
    const columnWidth = contentBox.width * CONTENT_REGION.comparisonColumnWidth;
    const columnGap = contentBox.width * CONTENT_REGION.comparisonColumnGap;
    const panelPaddingX = 0.28 / pageWidthIn;
    const columns = [
      { x: contentBox.x, label: comparisonBlock.leftLabel, items: comparisonBlock.leftItems },
      {
        x: contentBox.x + columnWidth + columnGap,
        label: comparisonBlock.rightLabel,
        items: comparisonBlock.rightItems,
      },
    ];
    const labelSize = CONTENT_REGION.comparisonLabelFontSizePt;
    const headerHeight = pointsToFraction(labelSize * 1.2) + 0.018;
    // A comparison column carries every point the writer reviewed. A column
    // that cut its last point would drop reviewed copy from the exported
    // file, so the copy shrinks to fit instead of losing a point.
    const itemText = (items: string[]) => items.map((item) => `• ${cleanPoint(item)}`).join("\n");
    const copyWidth = columnWidth - panelPaddingX * 2;
    const availableHeight = Math.max(0.05, contentBox.height - headerHeight - 0.06);
    const longestColumn = columns.reduce(
      (longest, column) => (itemText(column.items).length > itemText(longest.items).length ? column : longest),
      columns[0]!,
    );
    const itemSize = fittedFontSize(
      itemText(longestColumn.items),
      frame(contentBox.x, contentBox.y, copyWidth, availableHeight),
      CONTENT_REGION.comparisonItemFontSizePt,
      CONTENT_REGION.comparisonMinimumItemFontSizePt,
      1.25,
      CONTENT_REGION.comparisonItemFontSizePt,
    );
    const copyHeight = Math.max(
      ...columns.map((column) => blockHeight(itemText(column.items), copyWidth, itemSize, bodyLeading)),
    );
    // The panel is as tall as its copy plus a physical padding, with a small
    // floor for very short copy. A panel that nearly fills the content area
    // starts on the content axis; a short one is centred so the white space
    // is not all below it.
    const panelPaddingY = 0.2 / pageHeightIn;
    const panelHeight = Math.min(contentBox.height, Math.max(0.32, headerHeight + panelPaddingY * 2 + copyHeight));
    const panelTop =
      panelHeight < contentBox.height * 0.7
        ? contentBox.y + (contentBox.height - panelHeight) / 2
        : contentBox.y + 0.02;
    columns.forEach((column) => {
      const copy = itemText(column.items);
      const columnHeight = blockHeight(copy, copyWidth, itemSize, bodyLeading);
      const bodyAreaTop = panelTop + headerHeight + panelPaddingY;
      const bodyAreaHeight = Math.max(0.02, panelHeight - headerHeight - panelPaddingY * 2);
      const textTop = bodyAreaTop + Math.max(0, (bodyAreaHeight - columnHeight) / 2);
      const textHeight = Math.min(
        columnHeight * 1.04 + 0.004,
        Math.max(0.02, contentBox.y + contentBox.height - textTop),
      );
      slide.elements.push(
        shape(frame(column.x, panelTop, columnWidth, panelHeight), cardFill, "rectangle", cardStroke, 0.75),
        shape(frame(column.x, panelTop, columnWidth, headerHeight), accentFill),
      );
      slide.elements.push(
        text(
          column.label,
          centeredBlock(
            column.label,
            { x: column.x + 0.02, y: panelTop, width: columnWidth - 0.04, height: headerHeight },
            labelSize,
          ),
          labelSize,
          "#FFFFFF",
          true,
          "center",
          undefined,
          accentFillLuminance,
        ),
      );
      slide.elements.push(
        text(
          copy,
          frame(column.x + panelPaddingX, textTop, copyWidth, textHeight),
          itemSize,
          bodyInk,
          false,
          "left",
          undefined,
          cardLuminance,
        ),
      );
    });
  } else if (tableBlock) {
    const tableIndex = blocks.indexOf(tableBlock);
    const tableContent = contentBlocks?.[tableIndex];
    slide.elements.push(
      text(
        content.title,
        frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height),
        templateTitleSize ?? typeScale.title,
        titleInk,
        true,
        "left",
        undefined,
        titleLuminance,
      ),
    );
    if (!keepsArtwork)
      slide.elements.push(
        shape(
          frame(titleBox.x, titleBox.y + titleBox.height + 0.03, Math.min(0.12, titleBox.width * 0.2), 0.012),
          design.accent,
        ),
      );
    // The table element holds no cells of its own: it points at the reviewed
    // table block, so editing the numbers keeps the grid in sync.
    if (tableContent?.type === "table-data" && tableContent.header.length > 0 && tableContent.rows.length > 0) {
      slide.elements.push({
        id: crypto.randomUUID() as ElementId,
        type: "table",
        contentBlockId: tableContent.id,
        frame: frame(
          contentBox.x,
          contentBox.y + contentBox.height * 0.06,
          contentBox.width,
          Math.min(contentBox.height * 0.8, 0.52),
        ),
        rotationMilliDegree: 0,
        locked: false,
        style: {
          fontFamily: command.bodyFontFamily || majorFont,
          fontSizePt: 14,
          headerFill: accentFill,
          headerTextColor: "#FFFFFF",
          bodyTextColor: bodyInk,
          borderColor: cardStroke,
          firstColumnBold: true,
          bandingFill: cardFill,
          headerBold: true,
          cellPaddingPt: 6,
          borderWidthPt: 0.75,
        },
      });
    }
  } else if (metricBlocks.length > 0) {
    // Every reviewed metric is drawn. A page that cut its last metrics
    // would drop reviewed numbers from the exported file, so the grid
    // grows a row and the type shrinks instead.
    const metrics = metricBlocks;
    slide.elements.push(
      text(
        content.title,
        frame(chrome.title.x, chrome.title.y, chrome.title.width, chrome.title.height),
        templateTitleSize ?? typeScale.title,
        titleInk,
        true,
        "left",
        undefined,
        titleLuminance,
      ),
    );
    if (!keepsArtwork)
      slide.elements.push(
        shape(
          frame(chrome.rule.x, chrome.rule.y, chrome.rule.width, Math.max(0.009, chrome.rule.height)),
          design.accent,
        ),
      );
    // The metrics of a page are the reviewed numbers of the page. When they
    // are numbers of the same unit, they are drawn as a native chart: the
    // exported file keeps an editable chart instead of a picture of bars.
    const metricContentBlocks = (contentBlocks ?? []).filter((block): block is MetricBlock => block.type === "metric");
    const chartMetrics = metrics
      .map((metric, metricIndex) => {
        const parsed = parseMetricValue(metric.value);
        const block = metricContentBlocks[metricIndex];
        return parsed && block
          ? { blockId: block.id, label: metric.label, value: parsed.value, unit: parsed.unit }
          : undefined;
      })
      .filter((metric): metric is { blockId: string; label: string; value: number; unit: string } => Boolean(metric));
    const sameUnit = chartMetrics.length > 0 && chartMetrics.every((metric) => metric.unit === chartMetrics[0]!.unit);
    if (chartMetrics.length >= 2 && sameUnit) {
      // The relation decides first: a trend must not be drawn as a pie just
      // because the model asked for one. Without a relation, the legacy
      // count-based choice is kept.
      const kind = resolveChartKind({
        relation: design.designPlan?.chart?.relation,
        requestedKind: design.designPlan?.chart?.kind,
        pointCount: chartMetrics.length,
      });
      const chartFrame = frame(
        contentBox.x,
        contentBox.y + contentBox.height * 0.06,
        contentBox.width,
        Math.min(contentBox.height * 0.8, 0.46),
      );
      slide.elements.push({
        id: crypto.randomUUID() as ElementId,
        type: "chart",
        contentBlockIds: chartMetrics.map((metric) => metric.blockId),
        kind,
        frame: chartFrame,
        rotationMilliDegree: 0,
        locked: false,
        style: {
          fontFamily: command.bodyFontFamily || majorFont,
          fontSizePt: 14,
          textColor: bodyInk,
          seriesColors: [design.accent, accentFill, cardStroke],
          showLegend: false,
          showValueLabels: true,
        },
      });
    } else {
      const columns = metrics.length > 3 ? 3 : metrics.length;
      const rows = Math.ceil(metrics.length / columns);
      const cellWidth = contentBox.width / columns;
      const cardGap = 0.03;
      const valueSize = columns >= 3 ? 40 : 48;
      const labelSize = 18;
      const cardPaddingX = 0.22 / pageWidthIn;
      const cardPaddingY = 0.2 / pageHeightIn;
      const cardWidth = cellWidth - cardGap;
      const valueHeight = Math.max(
        ...metrics.map((metric) => blockHeight(metric.value, cardWidth - cardPaddingX * 2, valueSize, bodyLeading)),
      );
      const labelHeight = Math.max(
        ...metrics.map((metric) => blockHeight(metric.label, cardWidth - cardPaddingX * 2, labelSize, bodyLeading)),
      );
      // The card carries a number and its label; the height is measured
      // from those two blocks plus a physical padding. The old 0.24 cap
      // left a 1.8in card holding a single line of 15pt label with a hole
      // between the number and its name.
      const cardHeight = Math.min(
        Math.max(0.24, contentBox.height / rows - cardGap),
        Math.max(0.24, cardPaddingY * 2 + valueHeight + 0.02 + labelHeight),
      );
      const gridHeight = rows * cardHeight + (rows - 1) * cardGap;
      const gridTop = contentBox.y + (contentBox.height - gridHeight) * CONTENT_REGION.blockVerticalAnchor;
      metrics.forEach((metric, metricIndex) => {
        const column = metricIndex % columns;
        const row = Math.floor(metricIndex / columns);
        const width = cardWidth;
        const x = contentBox.x + column * cellWidth;
        const y = gridTop + row * (cardHeight + cardGap);
        // The card text is a view of the reviewed metric, not a copy of it.
        // The link is what makes editing the card edit the content.
        const block = metricContentBlocks[metricIndex];
        slide.elements.push(shape(frame(x, y, width, cardHeight), cardFill, "rectangle", cardStroke, 0.75));
        // The number and its label share a card that grows shorter with
        // every extra row, so both are fitted to the card they sit in.
        const valueFrame = frame(x + cardPaddingX, y + cardPaddingY, width - cardPaddingX * 2, valueHeight);
        const fittedValueSize = fittedFontSize(
          metric.value,
          frame(valueFrame.x, valueFrame.y, valueFrame.width, valueFrame.height),
          valueSize,
          24,
          bodyLeading,
          valueSize + 8,
        );
        const valueText = text(
          metric.value,
          valueFrame,
          fittedValueSize,
          design.accent,
          true,
          "center",
          undefined,
          cardLuminance,
        );
        if (block) valueText.contentBlockRef = { blockId: block.id, field: "value" };
        slide.elements.push(valueText);
        const labelFrame = frame(
          x + cardPaddingX,
          y + cardPaddingY + valueHeight + 0.02,
          width - cardPaddingX * 2,
          labelHeight,
        );
        const fittedLabelSize = fittedFontSize(
          metric.label,
          frame(labelFrame.x, labelFrame.y, labelFrame.width, labelFrame.height),
          labelSize,
          12,
          bodyLeading,
          20,
        );
        const labelText = text(
          metric.label,
          labelFrame,
          fittedLabelSize,
          bodyInk,
          false,
          "center",
          undefined,
          cardLuminance,
        );
        if (block) labelText.contentBlockRef = { blockId: block.id, field: "label" };
        slide.elements.push(labelText);
      });
    }
  } else if (processBlock) {
    // Every reviewed step is drawn. A process that cut its last steps
    // would drop reviewed copy from the exported file, so the row narrows
    // and the type shrinks instead.
    const processItems = processBlock.items;
    slide.elements.push(
      text(
        content.title,
        frame(chrome.title.x, chrome.title.y, chrome.title.width, chrome.title.height),
        templateTitleSize ?? typeScale.title,
        titleInk,
        true,
        "left",
        undefined,
        titleLuminance,
      ),
    );
    if (!keepsArtwork)
      slide.elements.push(
        shape(
          frame(chrome.rule.x, chrome.rule.y, chrome.rule.width, Math.max(0.009, chrome.rule.height)),
          design.accent,
        ),
      );
    const stepGap = 0.03 * density.gap;
    const stepWidth =
      (contentBox.width - stepGap * Math.max(processItems.length - 1, 0)) / Math.max(processItems.length, 1);
    const labelSize = 20;
    const textSize = 16;
    const badgeSize = 14;
    const badgeDiameter = 0.38;
    const badgeHeight = badgeDiameter / pageHeightIn;
    // Padding is a physical distance, not a share of the page. The old
    // 0.045-of-page-width value took 0.6in from each side of a 2.8in card
    // and left a 1.6in text column, which is what broke "建库" into "建"
    // and "库" on the same card.
    const paddingX = 0.22 / pageWidthIn;
    const paddingY = 0.22 / pageHeightIn;
    const labelHeight = pointsToFraction(labelSize * 1.3);
    const bodyHeight = Math.max(
      ...processItems.map((item) => blockHeight(item.text, stepWidth - paddingX * 2, textSize, bodyLeading)),
    );
    const stepHeight = Math.min(
      contentBox.height,
      Math.min(0.36, Math.max(0.2, paddingY * 2 + badgeHeight + 0.02 + labelHeight + 0.01 + bodyHeight)),
    );
    // The band sits on the content axis when it nearly fills the area. A
    // short band is centred instead of being pinned to the top with its
    // white space all at the bottom.
    const stepTop =
      stepHeight < contentBox.height * 0.7 ? contentBox.y + (contentBox.height - stepHeight) / 2 : contentBox.y + 0.02;
    processItems.forEach((item, itemIndex) => {
      const x = contentBox.x + itemIndex * (stepWidth + stepGap);
      const badgeX = x + paddingX;
      const badgeY = stepTop + paddingY;
      slide.elements.push(
        shape(frame(x, stepTop, stepWidth, stepHeight), cardFill, "rectangle", cardStroke, 0.75),
        shape(frame(x, stepTop, stepWidth, 0.008), design.accent),
      );
      slide.elements.push(shape(circleFrame(badgeX, badgeY, badgeDiameter), accentFill, "ellipse"));
      slide.elements.push(
        text(
          String(itemIndex + 1),
          centeredBlock(
            String(itemIndex + 1),
            { x: badgeX, y: badgeY, width: badgeDiameter / pageWidthIn, height: badgeHeight },
            badgeSize,
          ),
          badgeSize,
          "#FFFFFF",
          true,
          "center",
          undefined,
          accentFillLuminance,
        ),
      );
      // Left aligned type reads as an editorial column; centring every line
      // in four identical boxes is what made the page look like a template.
      const labelY = badgeY + badgeHeight + 0.018;
      const labelFrame = frame(x + paddingX, labelY, stepWidth - paddingX * 2, labelHeight);
      const fittedLabelSize = fittedFontSize(item.label, labelFrame, labelSize, 12);
      slide.elements.push(
        text(item.label, labelFrame, fittedLabelSize, titleInk, true, "left", undefined, cardLuminance),
      );
      const copyFrame = frame(
        x + paddingX,
        labelY + labelHeight + 0.008,
        stepWidth - paddingX * 2,
        Math.max(0.04, bodyHeight),
      );
      const fittedTextSize = fittedFontSize(item.text, copyFrame, textSize, 10);
      slide.elements.push(text(item.text, copyFrame, fittedTextSize, bodyInk, false, "left", undefined, cardLuminance));
    });
  } else if ((design.layout === "quote" || quoteBlock) && items.length < 3) {
    const quoteText = quoteBlock?.text ?? content.body;
    const attribution = quoteBlock?.attribution?.trim();
    if (!keepsArtwork) slide.elements.push(shape(frame(0.08, 0.16, 0.025, 0.68), design.accent));
    const quoteTitle = text(
      content.title,
      safeFrame(recipeTitle, [0.15, 0.12, 0.72, 0.13], 0.25, 0.04),
      templateTitleSize ?? 28,
      titleInk,
      true,
      "left",
      undefined,
      titleLuminance,
    );
    slide.elements.push(quoteTitle);
    if (quoteText.trim()) {
      const quoteBox = safeFrame(recipeContent, [0.16, 0.3, 0.66, 0.38], 0.25, 0.12);
      const quoteFrame = {
        x: quoteBox.x + Math.round(pageWidth * 0.035),
        y: quoteBox.y,
        width: Math.max(Math.round(pageWidth * 0.25), quoteBox.width - Math.round(pageWidth * 0.035)),
        height: quoteBox.height,
      };
      const quoteSize = Math.max(26, templateBodySize ?? 26);
      const quoteElement = text(
        quoteText,
        centeredBlock(
          quoteText,
          {
            x: quoteFrame.x / pageWidth,
            y: quoteFrame.y / pageHeight,
            width: quoteFrame.width / pageWidth,
            height: quoteFrame.height / pageHeight,
          },
          quoteSize,
        ),
        quoteSize,
        bodyInk,
        false,
        "left",
        undefined,
        contentTextLuminance,
      );
      slide.elements.push(quoteElement);
      const markY = quoteElement.frame.y / pageHeight - 0.065;
      const titleBottom = quoteTitle.frame.y / pageHeight + quoteTitle.frame.height / pageHeight;
      if (!keepsArtwork && markY > titleBottom + 0.01) {
        const markX = Math.max(0.02, quoteFrame.x / pageWidth - 0.08);
        slide.elements.push(
          text("“", frame(markX, markY, 0.07, 0.12), 60, design.accent, true, "left", undefined, contentTextLuminance),
        );
      }
      if (attribution) {
        const attributionY = quoteElement.frame.y / pageHeight + quoteElement.frame.height / pageHeight + 0.025;
        if (attributionY < 0.9) {
          slide.elements.push(
            text(
              `— ${attribution}`,
              frame(
                quoteFrame.x / pageWidth,
                attributionY,
                quoteFrame.width / pageWidth,
                Math.min(0.06, 0.96 - attributionY),
              ),
              14,
              bodyInk,
              false,
              "left",
              undefined,
              contentTextLuminance,
            ),
          );
        }
      }
    }
  } else if (
    composition === "editorial" &&
    (pullQuote || countPanel) &&
    items.length >= LAYOUT_CAPACITY.panelMinItems &&
    items.length <= LAYOUT_CAPACITY.panelMaxItems &&
    contentBox.width >= 0.55 &&
    contentBox.height >= 0.35
  ) {
    // A narrow numbered column plus one visual anchor: an oversized pull
    // quote copied from the reviewed body, or the real count of summary
    // points when there is no quote. Neither invents content.
    const listItems = items.slice(0, 5);
    const listWidth = contentBox.width * 0.56;
    const panelX = contentBox.x + contentBox.width * 0.6;
    const panelWidth = contentBox.width * 0.37;
    const numberWidth = Math.min(0.07, listWidth * 0.16);
    const itemSize = Math.max(17, Math.min(20, templateBodySize ?? typeScale.body));
    const cleanItems = listItems.map(cleanPoint);
    // The rows are measured instead of divided into equal slots. A row that
    // needs two lines and a row that needs one leave a different amount of
    // white space around them when both get the same slot, and the rhythm
    // of the column breaks.
    const listFlow = layoutFlow({
      items: cleanItems,
      widthPt: (listWidth - numberWidth - 0.03) * pageWidthIn * 72,
      availableHeightPt: contentBox.height * pageHeightIn * 72,
      preferredFontSizePt: itemSize,
      minimumFontSizePt: 14,
      minimumGapPt: 6 * 72 * 0.0139 * density.gap,
      // A compact page does not let the leftover space drift the points
      // apart: the list has to read as one list.
      ...(density.gap < 1 ? { maximumGapPt: 18 * density.gap } : {}),
      lineHeightRatio: density.leading,
      fontFamily: majorFont,
    });
    const flowFontPt = listFlow.fontSizePt;
    const rowGapPt = listFlow.gapPt;
    const flowHeightFraction = (points: number) => points / (pageHeightIn * 72);
    const numberSize = Math.max(
      PANEL_TYPE_SCALE.railNumberMinPt,
      Math.min(PANEL_TYPE_SCALE.railNumberMaxPt, flowFontPt * PANEL_TYPE_SCALE.railNumberRatio),
    );
    slide.elements.push(
      text(
        content.title,
        frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height),
        templateTitleSize ?? typeScale.title,
        titleInk,
        true,
        "left",
        undefined,
        titleLuminance,
      ),
    );
    if (!keepsArtwork)
      slide.elements.push(
        shape(
          frame(titleBox.x, titleBox.y + titleBox.height + 0.03, Math.min(0.12, titleBox.width * 0.2), 0.012),
          design.accent,
        ),
      );
    listFlow.rows.forEach((row, itemIndex) => {
      const rowY = contentBox.y + flowHeightFraction(row.topPt);
      const rowHeight = flowHeightFraction(row.heightPt);
      slide.elements.push(shape(frame(contentBox.x, rowY, 0.006, rowHeight), design.accent));
      // The number sits on the first line of its row, so the column of
      // numbers reads as one straight line even when the rows below it
      // need a second line. Its box is one line of its own size: a numeral
      // that is a step above the copy needs a taller line, and squeezing it
      // into the row's line box was what shrank it back to body size.
      const numberLineHeight = flowHeightFraction(numberSize * 1.25);
      const numberBox = { x: contentBox.x + 0.015, y: rowY, width: numberWidth, height: numberLineHeight };
      slide.elements.push(
        text(
          String(itemIndex + 1).padStart(2, "0"),
          frame(numberBox.x, numberBox.y, numberBox.width, numberBox.height),
          numberSize,
          design.accent,
          true,
          "left",
          undefined,
          contentTextLuminance,
        ),
      );
      const itemBox = {
        x: contentBox.x + numberWidth + 0.03,
        y: rowY,
        width: listWidth - numberWidth - 0.03,
        height: rowHeight,
      };
      slide.elements.push(
        text(
          row.text,
          frame(itemBox.x, itemBox.y, itemBox.width, itemBox.height),
          row.fontSizePt,
          bodyInk,
          false,
          "left",
          undefined,
          contentTextLuminance,
        ),
      );
      if (itemIndex < listFlow.rows.length - 1)
        slide.elements.push(
          shape(
            frame(contentBox.x, rowY + rowHeight + flowHeightFraction(rowGapPt) / 2 - 0.002, listWidth, 0.004),
            cardStroke,
          ),
        );
    });
    slide.elements.push(shape(frame(panelX, contentBox.y, panelWidth, contentBox.height), accentFill, "rectangle"));
    if (pullQuote) {
      const quoteAttribution = quoteBlock?.attribution?.trim();
      const panelQuote = quoteAttribution ? `${pullQuote}\n— ${quoteAttribution}` : pullQuote;
      const quoteWidthPt = (panelWidth - 0.1) * pageWidthIn * 72;
      const panelHeightPt = contentBox.height * pageHeightIn * 72;
      const pageHeightPt = pageHeightIn * 72;
      // The panel is measured instead of split into fixed fractions. The
      // quote mark, the quote and the label are placed by the height the
      // quote really needs, so a short quote does not leave a hole under
      // the mark and a long one does not push the label off the panel.
      const markSize = 62;
      // The quote mark keeps its own size: shrinking it to fit the panel
      // made the largest ornament of the page the smallest object on it.
      // The height is one line of the mark, so the fitting step of the text
      // helper does not shrink it either.
      const markHeightPt = markSize * 1.25;
      const labelHeightPt = PANEL_TYPE_SCALE.labelPt * 1.25;
      const markTopPt = 8;
      const labelBottomMarginPt = 10;
      const labelTopPt = panelHeightPt - labelHeightPt - labelBottomMarginPt;
      // The quote sits under the mark and is centred in the room that is left
      // above the rule, so the panel reads as one block instead of a
      // mark, a hole and a quote.
      const quoteAreaTopPt = markTopPt + markHeightPt + 4;
      const quoteAreaPt = Math.max(20, labelTopPt - 14 - quoteAreaTopPt);
      // The font size is the largest one whose quote still fits the area.
      // Picking it by the length of the text instead ignored the width of
      // the panel and produced quotes of three different sizes. The size
      // is also capped: a pull quote is a display object, but a quote that
      // is set larger than the title of the page takes over the page.
      const quoteSizes = [30, 28, 26, 24, 22, 20, 18].filter(
        (size) => size >= PANEL_TYPE_SCALE.quoteMinPt && size <= PANEL_TYPE_SCALE.quoteMaxPt,
      );
      let quoteSize = quoteSizes[quoteSizes.length - 1]!;
      let quoteHeightPt = 0;
      for (const size of quoteSizes) {
        const lines = estimateTextLines(panelQuote, quoteWidthPt, size, majorFont);
        const height = lines * size * 1.25;
        quoteSize = size;
        quoteHeightPt = height;
        if (height <= quoteAreaPt) break;
      }
      const quoteTopPt = quoteAreaTopPt + Math.max(0, (quoteAreaPt - quoteHeightPt) / 2);
      const quoteFrame = frame(
        panelX + 0.05,
        contentBox.y + quoteTopPt / pageHeightPt,
        panelWidth - 0.1,
        quoteHeightPt / pageHeightPt,
      );
      slide.elements.push(
        text(
          "“",
          frame(panelX + 0.04, contentBox.y + markTopPt / pageHeightPt, 0.2, markHeightPt / pageHeightPt),
          markSize,
          "#FFFFFF",
          true,
          "left",
          undefined,
          accentFillLuminance,
        ),
      );
      slide.elements.push(
        text(panelQuote, quoteFrame, quoteSize, "#FFFFFF", false, "left", undefined, accentFillLuminance),
      );
      // The rule and the label keep their place under the quote, so the
      // panel always ends the same way. The rule keeps a clear distance
      // above the label: too close and the line cuts through the text.
      const rulePt = labelTopPt - 12;
      const ruleY = contentBox.y + rulePt / pageHeightPt;
      slide.elements.push(shape(frame(panelX + 0.05, ruleY, panelWidth - 0.1, 0.004), "#FFFFFF"));
      slide.elements.push(
        text(
          "关键摘录",
          frame(
            panelX + 0.05,
            contentBox.y + labelTopPt / pageHeightPt,
            panelWidth - 0.1,
            labelHeightPt / pageHeightPt,
          ),
          PANEL_TYPE_SCALE.labelPt,
          "#FFFFFF",
          true,
          "left",
          undefined,
          accentFillLuminance,
        ),
      );
    } else {
      const countText = String(items.length).padStart(2, "0");
      // The numeral is the anchor, so measure its own block and place the
      // rule and label below it instead of guessing a fixed fraction. Short
      // panels step the numeral down so the label and footer still fit.
      const compact = contentBox.height < 0.4;
      const countSize = compact ? 64 : 86;
      const labelSize = compact ? 14 : 18;
      const labelHeight = compact ? 0.05 : 0.07;
      const footerY = contentBox.y + contentBox.height - (compact ? 0.04 : 0.055);
      const countFrame = frame(
        panelX + 0.05,
        contentBox.y + contentBox.height * 0.1,
        panelWidth - 0.1,
        blockHeight(countText, panelWidth - 0.1, countSize) * 1.04,
      );
      const countBottom = countFrame.y / pageHeight + countFrame.height / pageHeight;
      const labelY = Math.min(countBottom + 0.04, footerY - labelHeight - 0.01);
      slide.elements.push(
        text(countText, countFrame, countSize, "#FFFFFF", true, "left", undefined, accentFillLuminance),
      );
      slide.elements.push(shape(frame(panelX + 0.05, countBottom + 0.02, panelWidth - 0.1, 0.004), "#FFFFFF"));
      slide.elements.push(
        text(
          "项要点",
          frame(panelX + 0.05, labelY, panelWidth - 0.1, labelHeight),
          labelSize,
          "#FFFFFF",
          true,
          "left",
          undefined,
          accentFillLuminance,
        ),
      );
      slide.elements.push(
        text(
          "本页要点",
          frame(panelX + 0.05, footerY, panelWidth - 0.1, 0.06),
          PANEL_TYPE_SCALE.labelPt,
          "#FFFFFF",
          false,
          "left",
          undefined,
          accentFillLuminance,
        ),
      );
    }
  } else if (composition === "grid" && items.length > 1 && items.length <= LAYOUT_CAPACITY.cardsMaxItems) {
    slide.elements.push(
      text(
        content.title,
        frame(chrome.title.x, chrome.title.y, chrome.title.width, chrome.title.height),
        templateTitleSize ?? typeScale.title,
        titleInk,
        true,
        "left",
        undefined,
        titleLuminance,
      ),
    );
    if (!keepsArtwork) {
      // A single-page deck has no footer, so the page index is its own mark.
      // A longer deck prints the number in the footer; repeating it at the
      // top right made the page look like it had two page numbers.
      if (command.slides.length === 1)
        slide.elements.push(
          text(
            String(index + 1).padStart(2, "0"),
            frame(chrome.title.x + chrome.title.width - 0.07, chrome.title.y, 0.07, chrome.title.height),
            14,
            titleInk,
            true,
            "right",
            undefined,
            titleLuminance,
          ),
        );
      slide.elements.push(
        shape(
          frame(chrome.rule.x, chrome.rule.y, chrome.rule.width, Math.max(0.009, chrome.rule.height)),
          design.accent,
        ),
      );
    }
    const visible = items.slice(0, 6);
    const columns = visible.length === 3 || visible.length >= 5 ? 3 : 2;
    const rows = Math.ceil(visible.length / columns);
    const contentWidth = contentBox.width;
    const contentHeight = contentBox.height;
    const columnGap = 0.022 * density.gap;
    const rowGap = 0.04 * density.gap;
    const cardWidth = (contentWidth - columnGap * (columns - 1)) / columns;
    // Padding is a physical distance, not a share of the page. A 0.03-of-
    // page-width gutter is 0.4in on a 2-column card and the same 0.4in on a
    // 3-column card, which is where the narrow text column came from.
    const cardPaddingX = 0.24 / pageWidthIn;
    const cardPaddingY = 0.2 / pageHeightIn;
    // A top-left badge frees the whole card width for copy. Placing the
    // badge in a left gutter made the text column narrow and the card
    // look unbalanced on portrait-ish three-column grids.
    const badgeDiameter = 0.36;
    const badgeHeight = badgeDiameter / pageHeightIn;
    const cardTextTop = cardPaddingY + badgeHeight + 0.02;
    // Four short points leave a grid that reads as a caption when the type
    // stays at the dense size. Sparse grids carry one point more.
    const sparseCards = visible.length <= 4 && visible.every((item) => item.trim().length <= 16);
    const cardFontSize = sparseCards ? 19 : 17;
    const cardTextWidth = cardWidth - cardPaddingX * 2;
    const cardTextHeight = Math.max(
      ...visible.map((item) => blockHeight(cleanPoint(item), cardTextWidth, cardFontSize, bodyLeading)),
    );
    // A card is as tall as the badge and the copy it carries. Stretching a
    // one-line card to a fixed 0.24/0.26 page height left the copy stranded
    // in the middle of an empty box.
    const cardHeight = Math.min(
      Math.max(0.16, contentHeight / rows - 0.03),
      Math.max(0.16, cardTextTop + cardTextHeight + cardPaddingY),
    );
    const gridHeight = rows * cardHeight + (rows - 1) * rowGap;
    const gridTop = contentBox.y + (contentHeight - gridHeight) * CONTENT_REGION.blockVerticalAnchor;
    visible.forEach((item, itemIndex) => {
      const row = Math.floor(itemIndex / columns);
      const column = itemIndex % columns;
      const rowItemCount = Math.min(columns, visible.length - row * columns);
      const rowWidth = rowItemCount * cardWidth + (rowItemCount - 1) * columnGap;
      const rowStart = contentBox.x + (contentWidth - rowWidth) / 2;
      const x = rowStart + column * (cardWidth + columnGap);
      const y = gridTop + row * (cardHeight + rowGap);
      const cleanItem = cleanPoint(item);
      const badgeWidth = badgeDiameter / pageWidthIn;
      const badgeX = x + cardPaddingX;
      const badgeY = y + cardPaddingY;
      const textTop = y + cardTextTop;
      slide.elements.push(
        shape(frame(x, y, cardWidth, cardHeight), cardFill, "rectangle", cardStroke, 0.75),
        shape(frame(x, y, cardWidth, 0.008), design.accent),
      );
      slide.elements.push(shape(circleFrame(badgeX, badgeY, badgeDiameter), accentFill, "ellipse"));
      // A point that names something the icon set can draw gets the icon;
      // anything else keeps the number, which stays the honest default.
      const cardIcon = iconForText(cleanItem);
      if (cardIcon) {
        const iconSide = 0.24;
        slide.elements.push({
          id: crypto.randomUUID() as ElementId,
          type: "icon",
          name: cardIcon,
          frame: frame(
            badgeX + (badgeDiameter - iconSide) / 2 / pageWidthIn,
            badgeY + (badgeDiameter - iconSide) / 2 / pageHeightIn,
            iconSide / pageWidthIn,
            iconSide / pageHeightIn,
          ),
          rotationMilliDegree: 0,
          locked: false,
          style: { color: accentFillLuminance > 0.55 ? "#1E2A32" : "#FFFFFF", strokeWidth: 2 },
        });
      } else {
        const badgeText = String(itemIndex + 1).padStart(2, "0");
        slide.elements.push(
          text(
            badgeText,
            centeredBlock(badgeText, { x: badgeX, y: badgeY, width: badgeWidth, height: badgeHeight }, 14),
            14,
            "#FFFFFF",
            true,
            "center",
            undefined,
            accentFillLuminance,
          ),
        );
      }
      const cardTextBox = {
        x: x + cardPaddingX,
        y: textTop,
        width: cardTextWidth,
        height: Math.max(0.05, cardHeight - cardTextTop - cardPaddingY),
      };
      const fittedCardSize = fittedFontSize(
        cleanItem,
        frame(cardTextBox.x, cardTextBox.y, cardTextBox.width, cardTextBox.height),
        cardFontSize,
        12,
        bodyLeading,
        22,
      );
      const fittedHeight = blockHeight(cleanItem, cardTextWidth, fittedCardSize, bodyLeading);
      // Top-align the copy under the badge. The card is already sized to
      // the text; centring a one-line card inside a taller floor is what
      // made short cards look like empty boxes.
      const copyTop = cardTextBox.y;
      slide.elements.push(
        text(
          cleanItem,
          frame(
            cardTextBox.x,
            copyTop,
            cardTextBox.width,
            Math.max(0.04, Math.min(cardTextBox.height, fittedHeight * 1.04 + 0.004)),
          ),
          fittedCardSize,
          "#293241",
          false,
          "left",
          undefined,
          cardLuminance,
        ),
      );
    });
  } else if (composition === "columns" && items.length > 1) {
    slide.elements.push(
      text(
        content.title,
        safeFrame(recipeTitle, [0.07, 0.07, 0.84, 0.13], 0.25, 0.04),
        templateTitleSize ?? typeScale.title,
        titleInk,
        true,
        "left",
        undefined,
        titleLuminance,
      ),
    );
    const cleanItems = items.map(cleanPoint).filter((item) => item.length > 0);
    const slots: Array<{ x: number; y: number; width: number; height: number }> = hasSafeColumns
      ? [
          { x: leftRecipe!.x, y: leftRecipe!.y, width: leftRecipe!.width, height: leftRecipe!.height },
          { x: rightRecipe!.x, y: rightRecipe!.y, width: rightRecipe!.width, height: rightRecipe!.height },
        ]
      : [
          { x: 0.08, y: contentBox.y, width: 0.36, height: contentBox.height },
          { x: 0.57, y: contentBox.y, width: 0.35, height: contentBox.height },
        ];
    const padding = 0.045;
    // The marker owns a gutter of its own, and wrapped lines start at the
    // copy column instead of running back under the bullet. Concatenating
    // "• item" into one paragraph produced a list whose second line started
    // at the bullet, which reads as a typing accident rather than a list.
    const markerGutter = 0.022;
    const rowGap = 0.018 * density.gap;
    const sparseColumns = items.length <= 4 && items.every((item) => item.trim().length <= 16);
    const preferredSize = templateColumnSize ?? (sparseColumns ? 20 : 18);
    const copyWidth = (slot: { width: number }) => slot.width - padding * 2 - markerGutter;
    const measure = (column: string[], slot: { width: number }, size: number) => {
      const width = copyWidth(slot);
      const heights = column.map((item) => blockHeight(item, width, size, bodyLeading));
      return {
        heights,
        total: heights.reduce((sum, height) => sum + height, 0) + rowGap * Math.max(0, heights.length - 1),
      };
    };
    // Both columns share one type size and one top edge. Centring each panel
    // on its own copy put the first line of the left column at a different
    // height from the right one; the eye reads that as a misalignment even
    // when each panel is internally centred.
    const available = Math.min(slots[0]!.height, slots[1]!.height) - padding * 2;
    // Grow the copy to the room the columns have before shrinking it: a pair
    // of panels filled with 18pt copy on a 7.5in page leaves half the card
    // empty and reads as a page that was never finished. The ceiling matters
    // more than the floor: 26pt body text in a card reads as a poster, not as
    // a management deck, so a card column stops at 20pt (22 for sparse copy).
    const maximumSize = Math.min(sparseColumns ? 22 : 20, preferredSize + 4);
    // A cut at the midpoint is not always the balanced one: five points of
    // different lengths can put three short ones against two long ones and
    // leave one card half empty. Try every cut and keep the one whose two
    // columns need the same height.
    const bestCut = (size: number) => {
      let best:
        | {
            at: number;
            left: ReturnType<typeof measure>;
            right: ReturnType<typeof measure>;
            difference: number;
            needed: number;
          }
        | undefined;
      for (let at = 1; at < cleanItems.length; at += 1) {
        const left = measure(cleanItems.slice(0, at), slots[0]!, size);
        const right = measure(cleanItems.slice(at), slots[1]!, size);
        const difference = Math.abs(left.total - right.total);
        if (!best || difference < best.difference) {
          best = { at, left, right, difference, needed: Math.max(left.total, right.total) };
        }
      }
      return best;
    };
    let cut = Math.max(1, Math.ceil(cleanItems.length / 2));
    let columnSize = 12;
    let measured = [
      measure(cleanItems.slice(0, cut), slots[0]!, 12),
      measure(cleanItems.slice(cut), slots[1]!, 12),
    ] as const;
    for (let size = maximumSize; size >= 12; size -= 1) {
      const candidate = bestCut(size);
      if (!candidate) break;
      if (candidate.needed <= available || size === 12) {
        cut = candidate.at;
        columnSize = size;
        measured = [candidate.left, candidate.right] as const;
        break;
      }
    }
    // The panels share one top edge and are each as tall as the copy they
    // carry. Forcing a short column to the height of a long one left the
    // shorter card half empty underneath its last point; two cards of
    // different heights that start on the same line read as columns of one
    // block, not as two unrelated objects.
    const panelBlockHeight = Math.min(
      slots[0]!.height,
      slots[1]!.height,
      Math.max(measured[0].total, measured[1].total) + padding * 2,
    );
    [cleanItems.slice(0, cut), cleanItems.slice(cut)].forEach((column, columnIndex) => {
      const slot = slots[columnIndex]!;
      const authoredHeight = measured[columnIndex]!.total + padding * 2;
      const panelHeight = Math.min(slot.height, authoredHeight);
      const panelTop = slot.y + (slot.height - panelBlockHeight) / 2;
      slide.elements.push(
        shape(frame(slot.x, panelTop, slot.width, panelHeight), cardFill, "rectangle", cardStroke, 0.75),
        shape(frame(slot.x, panelTop, slot.width, 0.008), design.accent),
      );
      const width = copyWidth(slot);
      let rowY = panelTop + padding;
      // A 26pt bullet next to 20pt copy is a second headline. The marker is
      // punctuation, so it stays well below the copy size.
      const markerSize = Math.max(10, Math.min(14, Math.round(columnSize * 0.6)));
      column.forEach((item, itemIndex) => {
        const itemHeight = measured[columnIndex]!.heights[itemIndex]!;
        // The marker is its own element, so a wrapped point keeps its
        // hanging indent and the list stays editable point by point.
        slide.elements.push(
          text(
            "•",
            frame(slot.x + padding, rowY + 0.006, markerGutter, Math.max(0.02, itemHeight)),
            markerSize,
            design.accent,
            false,
            "left",
            undefined,
            cardLuminance,
          ),
        );
        slide.elements.push(
          text(
            item,
            frame(slot.x + padding + markerGutter, rowY, width, Math.max(0.02, itemHeight + 0.004)),
            columnSize,
            bodyInk,
            false,
            "left",
            undefined,
            cardLuminance,
            12,
            emphasisLead(item),
          ),
        );
        rowY += itemHeight + rowGap;
      });
    });
  } else if (
    composition === "stacked" &&
    (design.layout === "title-body" || design.layout === "summary") &&
    items.length >= LAYOUT_CAPACITY.cardsGridMinItems &&
    items.length <= LAYOUT_CAPACITY.cardsMaxItems
  ) {
    // A short list is a sequence of visual units, not one paragraph. Keeping
    // it as a single text box was the reason a five-point page looked like a
    // small block stranded in a large empty canvas.
    const listItems = items.slice(0, 6);
    slide.elements.push(
      text(
        content.title,
        safeFrame(
          recipeTitle,
          [
            alignmentGrid.left,
            alignmentGrid.titleY,
            alignmentGrid.right - alignmentGrid.left,
            alignmentGrid.titleHeight,
          ],
          0.25,
          0.04,
        ),
        templateTitleSize ?? typeScale.title,
        titleInk,
        true,
        "left",
        undefined,
        titleLuminance,
      ),
    );
    if (!keepsArtwork)
      slide.elements.push(
        shape(
          frame(
            alignmentGrid.left,
            alignmentGrid.ruleY,
            Math.min(0.11, (alignmentGrid.right - alignmentGrid.left) * 0.2),
            0.012,
          ),
          design.accent,
        ),
      );
    const rowGap = Math.min(0.012 * density.gap, contentBox.height * 0.02);
    const rowHeight = (contentBox.height - rowGap * (listItems.length - 1)) / listItems.length;
    const numberWidth = Math.min(0.085, contentBox.width * 0.12);
    const itemWidth = contentBox.width - numberWidth - 0.02;
    const numberSize = Math.max(12, Math.min(22, rowHeight * pageHeightIn * 72 * 0.52));
    listItems.forEach((item, itemIndex) => {
      const rowY = contentBox.y + itemIndex * (rowHeight + rowGap);
      const cleanItem = cleanPoint(item);
      slide.elements.push(shape(frame(contentBox.x, rowY, 0.008, rowHeight), design.accent));
      slide.elements.push(
        text(
          String(itemIndex + 1).padStart(2, "0"),
          centeredBlock(
            String(itemIndex + 1).padStart(2, "0"),
            { x: contentBox.x + 0.022, y: rowY, width: numberWidth, height: rowHeight },
            numberSize,
          ),
          numberSize,
          design.accent,
          true,
          "left",
          undefined,
          contentTextLuminance,
        ),
      );
      slide.elements.push(
        text(
          cleanItem,
          centeredBlock(
            cleanItem,
            { x: contentBox.x + numberWidth + 0.025, y: rowY, width: itemWidth, height: rowHeight },
            templateBodySize ?? typeScale.body,
          ),
          templateBodySize ?? typeScale.body,
          bodyInk,
          false,
          "left",
          undefined,
          contentTextLuminance,
        ),
      );
      if (itemIndex < listItems.length - 1)
        slide.elements.push(
          shape(frame(contentBox.x, rowY + rowHeight + rowGap / 2 - 0.003, contentBox.width, 0.006), cardStroke),
        );
    });
  } else {
    slide.elements.push(
      text(
        content.title,
        frame(chrome.title.x, chrome.title.y, chrome.title.width, chrome.title.height),
        templateTitleSize ?? typeScale.title,
        titleInk,
        true,
        "left",
        undefined,
        titleLuminance,
      ),
    );
    if (!keepsArtwork)
      slide.elements.push(
        shape(
          frame(chrome.rule.x, chrome.rule.y, chrome.rule.width, Math.max(0.009, chrome.rule.height)),
          design.accent,
        ),
      );
    if (content.body.trim()) {
      // A single paragraph used to be pinned to the top of a full-height
      // frame: 17pt copy ended at 38% of the page and the rest was white.
      // A closing/summary page with short copy is now set larger and
      // centred as one statement. A template body placeholder keeps its own
      // geometry and size: the template's type scale is not ours to
      // overwrite. Running copy keeps the theme's body size.
      const templateBody = recipeContent;
      const summary = design.layout === "summary" || design.layout === "quote";
      const shortStatement = summary && content.body.length <= 160;
      const bodyWidth = templateBody ? templateBody.width : Math.min(contentBox.width, 0.72);
      const preferred = templateBody ? (templateBodySize ?? typeScale.body) : shortStatement ? 22 : typeScale.body;
      const bodyBox = templateBody
        ? safeFrame(templateBody, [contentBox.x, contentBox.y, bodyWidth, contentBox.height], 0.25, 0.12)
        : frame(contentBox.x, contentBox.y, bodyWidth, contentBox.height);
      const bodySize = fittedFontSize(
        content.body,
        bodyBox,
        preferred,
        12,
        bodyLeading,
        templateBody ? preferred : shortStatement ? 24 : preferred,
      );
      const measured = blockHeight(content.body, bodyWidth, bodySize, bodyLeading);
      const centered = shortStatement && measured < contentBox.height * 0.55;
      const bodyY = centered
        ? contentBox.y + (contentBox.height - measured) / 2
        : templateBody
          ? templateBody.y
          : contentBox.y;
      const bodyFrame = centered
        ? frame(templateBody ? templateBody.x : contentBox.x, bodyY, bodyWidth, Math.max(0.06, measured * 1.04 + 0.004))
        : templateBody
          ? bodyBox
          : frame(contentBox.x, bodyY, bodyWidth, Math.max(0.06, measured * 1.04 + 0.004));
      slide.elements.push(
        text(content.body, bodyFrame, bodySize, bodyInk, false, "left", undefined, contentTextLuminance),
      );
    }
  }
  // Link rendered title/body text back to semantic content. Structured
  // layouts (cards, timeline items, metrics) stay decorative because one
  // visual element cannot safely overwrite a multi-field content block.
  const bodyFontFamily = minorFont;
  const titleToken = document.theme?.textStyles?.title;
  const bodyToken = document.theme?.textStyles?.body;
  for (const element of slide.elements) {
    if (element.type !== "text") continue;
    // A fragment of a field (the headline of a split cover) names its own field
    // and range. The exact-match pass below would read it as decoration because
    // its text is not the whole title; that would silently detach it from the
    // content its edits splice back into.
    if (!element.contentRange) {
      if (element.text === content.title) element.contentRef = "title";
      else if (content.body.trim() && element.text === content.body) element.contentRef = "body";
      else element.contentRef = "decorative";
    }
    // Display type for the headline, text type for running copy. Using the
    // template major font for both made dense body copy look heavy.
    if (element.contentRef !== "title" && bodyFontFamily) element.style.fontFamily = bodyFontFamily;
    // The type token may also carry tracking and leading. They are design
    // state, so they live on the element like its size and colour.
    const token = element.contentRef === "title" ? titleToken : element.contentRef === "body" ? bodyToken : undefined;
    if (token?.letterSpacingPt !== undefined) element.style.letterSpacingPt = token.letterSpacingPt;
    if (token?.lineHeight !== undefined) element.style.lineHeight = token.lineHeight;
  }
  // The typographic quote mark reads as two bars in many CJK UI fonts.
  // A serif glyph keeps the pull quote looking like a quotation instead of
  // a pair of slashes.
  const quoteMark = slide.elements.find((element) => element.type === "text" && element.text === "“");
  if (quoteMark?.type === "text") quoteMark.style.fontFamily = "Georgia";
  const titleRepairs = (design.elementRepairs ?? []).filter(
    (repair): repair is Exclude<AiElementRepair, { action: "changeLayout" }> =>
      repair.action !== "changeLayout" && repair.target === "title",
  );
  const bodyRepairs = (design.elementRepairs ?? []).filter(
    (repair): repair is Exclude<AiElementRepair, { action: "changeLayout" }> =>
      repair.action !== "changeLayout" && repair.target === "body",
  );
  // A region repair points at a place on the page instead of at a role.
  // The review model looked at a picture, so a rectangle is the only thing
  // it can honestly name.
  const regionRepairs = (design.elementRepairs ?? []).filter(
    (repair): repair is Exclude<AiElementRepair, { action: "changeLayout" }> =>
      repair.action !== "changeLayout" && repair.target === "region",
  );
  const elementBox = (element: { frame: RectEmu }) => ({
    x: element.frame.x / pageWidth,
    y: element.frame.y / pageHeight,
    width: element.frame.width / pageWidth,
    height: element.frame.height / pageHeight,
  });
  /** How much of the element lies inside the region. */
  const overlapRatio = (element: { frame: RectEmu }, region: AiNormalizedRect): number => {
    const box = elementBox(element);
    const left = Math.max(box.x, region.x);
    const top = Math.max(box.y, region.y);
    const right = Math.min(box.x + box.width, region.x + region.width);
    const bottom = Math.min(box.y + box.height, region.y + region.height);
    if (right <= left || bottom <= top) return 0;
    // The boxes are normalized, so their area is far below one. Guarding
    // against a zero denominator must not raise it to one, or every
    // overlap ratio collapses and no region repair ever applies.
    const area = Math.max(1e-6, box.width * box.height);
    return ((right - left) * (bottom - top)) / area;
  };
  const pageArea = pageWidth * pageHeight;
  const overlapArea = (left: RectEmu, right: RectEmu): number => {
    const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
    const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
    return width > 0 && height > 0 ? width * height : 0;
  };
  for (const element of slide.elements) {
    if (element.type !== "text") continue;
    // Text that sits inside a generated card, header bar or panel belongs to
    // that shape. A repair that moves the text alone detaches it from its
    // card and paints it over the page — which is exactly how a generated
    // deck ends up with copy outside its boxes. Geometry repairs therefore
    // stop at the shape boundary; restyling is still allowed.
    const elementArea = element.frame.width * element.frame.height;
    // The text frame is allowed to stand a little outside its container (a
    // centred label can be a few points taller than the bar that carries
    // it), so "belongs to" is measured by overlap, not full containment.
    const container =
      elementArea > 0
        ? slide.elements.find(
            (candidate) =>
              candidate.type === "shape" &&
              candidate.frame.width * candidate.frame.height < pageArea * 0.4 &&
              overlapArea(candidate.frame, element.frame) / elementArea >= 0.8,
          )
        : undefined;
    const repairs = element.text === content.title ? titleRepairs : element.text === content.body ? bodyRepairs : [];
    for (const repair of repairs) {
      if ((repair.action === "move" || repair.action === "resize") && !container) {
        const collisionFreeFrame = obstacles.some((obstacle) => intersects(repair.frame, obstacle))
          ? repair.target === "title"
            ? {
                x: visualSafe.x,
                y: visualSafe.y,
                width: visualSafe.width,
                height: Math.min(0.14, visualSafe.height * 0.22),
              }
            : {
                x: visualSafe.x,
                y: visualSafe.y + Math.min(0.18, visualSafe.height * 0.28),
                width: visualSafe.width,
                height: Math.max(0.08, visualSafe.height - Math.min(0.18, visualSafe.height * 0.28)),
              }
          : repair.frame;
        element.frame = frame(
          collisionFreeFrame.x,
          collisionFreeFrame.y,
          collisionFreeFrame.width,
          collisionFreeFrame.height,
        );
      }
      if (repair.action === "restyle")
        element.style = {
          ...element.style,
          fontSizePt: Math.max(12, element.style.fontSizePt * (repair.fontScale ?? 1)),
          color: repair.color ?? element.style.color,
          fontFamily: repair.fontFamily ?? element.style.fontFamily,
          align: repair.textAlign ?? element.style.align,
          lineHeight: repair.lineHeight ?? element.style.lineHeight,
        };
    }
    // A region repair applies to everything that lies inside the region.
    for (const regionRepair of regionRepairs) {
      const regionFrame = "frame" in regionRepair ? regionRepair.frame : undefined;
      if (!regionFrame) continue;
      if (overlapRatio(element, regionFrame) < 0.5) continue;
      // Moving a contained text without its shape tears the composition
      // apart; only a restyle can be applied safely inside a card.
      if (container && regionRepair.action !== "restyle") continue;
      if (regionRepair.action === "move" || regionRepair.action === "resize") {
        // A region move needs a destination. Without one there is nothing
        // to move towards, so the element keeps its place.
        const destination = regionRepair.to;
        if (!destination) continue;
        // The block inside the region is moved and scaled as one piece, so
        // the relative layout of the block survives the repair.
        const box = elementBox(element);
        const source = regionFrame;
        const scaleX = destination.width / Math.max(0.01, source.width);
        const scaleY = destination.height / Math.max(0.01, source.height);
        const origin = regionRepair.action === "move" ? destination : source;
        const moved = {
          x: origin.x + (box.x - source.x) * scaleX,
          y: origin.y + (box.y - source.y) * scaleY,
          width: box.width * scaleX,
          height: box.height * scaleY,
        };
        if (obstacles.some((obstacle) => intersects(moved, obstacle))) continue;
        element.frame = frame(moved.x, moved.y, moved.width, moved.height);
      }
      if (regionRepair.action === "restyle")
        element.style = {
          ...element.style,
          fontSizePt: Math.max(12, element.style.fontSizePt * (regionRepair.fontScale ?? 1)),
          color: regionRepair.color ?? element.style.color,
          fontFamily: regionRepair.fontFamily ?? element.style.fontFamily,
          align: regionRepair.textAlign ?? element.style.align,
          lineHeight: regionRepair.lineHeight ?? element.style.lineHeight,
        };
      if (regionRepair.action === "align") {
        const box = elementBox(element);
        const aligned =
          regionRepair.axis === "top"
            ? { x: box.x, y: regionFrame.y, width: box.width, height: box.height }
            : { x: regionFrame.x, y: box.y, width: box.width, height: box.height };
        element.frame = frame(aligned.x, aligned.y, aligned.width, aligned.height);
      }
    }
  }
  // The rail and the headline are one piece of page chrome. A visual repair
  // may improve a local collision, but moving only the headline back to the
  // default margin leaves the fixed rail cutting through its glyphs. Lock the
  // title to the rail surface after all model-proposed geometry repairs; this
  // is a deterministic alignment invariant, not a stylistic suggestion.
  if (!hasTemplate && deckSurface === "rail") {
    const title = slide.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    );
    if (title) {
      const titleAxis = frame(chrome.title.x, chrome.title.y, chrome.title.width, chrome.title.height);
      title.frame = {
        ...title.frame,
        x: titleAxis.x,
        y: titleAxis.y,
        width: Math.min(title.frame.width, titleAxis.width) as Emu,
        height: Math.max(title.frame.height, titleAxis.height) as Emu,
      };
    }
  }
  if (design.hierarchyAction === "strengthen-title") {
    const title = slide.elements.find((element) => element.type === "text" && element.text === content.title);
    if (title?.type === "text")
      title.style = { ...title.style, fontSizePt: Math.min(44, title.style.fontSizePt * 1.15), bold: true };
  }
  if (design.hierarchyAction === "reduce-density") {
    const body = slide.elements.find((element) => element.type === "text" && element.text === content.body);
    if (body?.type === "text")
      body.frame = { ...body.frame, height: Math.max(body.frame.height, Math.round(pageHeight * 0.42)) as Emu };
  }
  if (design.hierarchyAction === "increase-whitespace") {
    const body = slide.elements.find((element) => element.type === "text" && element.text === content.body);
    if (body?.type === "text")
      body.frame = {
        ...body.frame,
        x: (body.frame.x + Math.round(pageWidth * 0.025)) as Emu,
        width: Math.max(Math.round(pageWidth * 0.3), body.frame.width - Math.round(pageWidth * 0.05)) as Emu,
      };
  }
  // The emphasis of the page decides which level of the hierarchy carries
  // the weight. A title that is pushed up has to stay inside its own frame,
  // so the size is capped by the height of the box it lives in: a bigger
  // title that no longer fits is a title that overlaps the copy below it.
  if (intent.emphasis !== "balanced") {
    const emphasisTarget = (element: SlideElement, factor: number) => {
      if (element.type !== "text") return;
      const scaled = element.style.fontSizePt * factor;
      const readableInBox = Math.floor(element.frame.height / 12_700 / 1.25);
      element.style = {
        ...element.style,
        fontSizePt: Math.max(12, Math.min(Math.round(scaled), readableInBox, 44)),
      };
    };
    const title = slide.elements.find((element) => element.type === "text" && element.text === content.title);
    if (title) emphasisTarget(title, emphasis.title);
    for (const element of slide.elements) {
      if (element.type !== "text" || element.text === content.title) continue;
      if (content.body.trim() && element.text === content.body) emphasisTarget(element, emphasis.body);
    }
  }
  // A repair or an emphasis can enlarge a text after the layout fitted it.
  // Refit the ink to the frame it ended up in, so a scaled title cannot
  // spill out of its box and paint over the copy below it.
  for (const element of slide.elements) {
    if (element.type !== "text" || !textLikelyOverflows(element)) continue;
    let fitted = element.style.fontSizePt;
    while (fitted > 8) {
      fitted -= 1;
      if (!textLikelyOverflows({ ...element, style: { ...element.style, fontSizePt: fitted } })) break;
    }
    element.style = { ...element.style, fontSizePt: fitted };
  }
  // A repair may also repaint a text with a colour that does not read on the
  // surface it sits on. The last pass resolves every ink against the shape
  // that actually carries it, so a repaint cannot leave invisible copy.
  slide.elements.forEach((element, elementIndex) => {
    if (element.type !== "text") return;
    let carrying: string | undefined;
    let carryingRange: BackgroundRange | undefined;
    const carrierArea = element.frame.width * element.frame.height;
    for (let candidateIndex = 0; candidateIndex < elementIndex; candidateIndex += 1) {
      const candidate = slide.elements[candidateIndex]!;
      if (
        candidate.type === "shape" &&
        carrierArea > 0 &&
        overlapArea(candidate.frame, element.frame) / carrierArea >= 0.8
      ) {
        carrying = candidate.style.fill;
        // A gradient is a range of surfaces, not one color. Resolving the ink
        // against its solid fallback would turn copy white on a light accent or
        // dark on a dark one.
        const gradient = candidate.style.fillGradient;
        const luminances = gradient?.stops
          .map((stop) => colorLuminance(stop.color))
          .filter((value): value is number => value !== undefined);
        carryingRange =
          luminances && luminances.length > 0
            ? { darkest: Math.min(...luminances), lightest: Math.max(...luminances) }
            : undefined;
      }
    }
    const large = isLargeText(element.style.fontSizePt, element.style.bold);
    if (carryingRange) {
      element.style = {
        ...element.style,
        color: readableTextColorOnRange(element.style.color, carryingRange, large, bodyInk),
      };
      return;
    }
    // The footer sits outside the artwork placeholders, so the artwork
    // probe does not describe what is behind it. Resolving it against the
    // dark content range turned the page number white on a white page.
    const inFooter = element.frame.y >= pageHeight * 0.9;
    if (!carrying && keepsArtwork && !inFooter) {
      // The artwork probe is a range of luminance, not one value; resolve
      // against the same range the page was built with.
      const range = element.contentRef === "title" ? titleBackground : bodyBackground;
      if (range) {
        element.style = {
          ...element.style,
          color: readableTextColorOnRange(element.style.color, range, large, bodyInk),
        };
        return;
      }
    }
    const background = carrying ?? (keepsArtwork && !inFooter ? undefined : slide.background);
    const luminance = background ? colorLuminance(background) : undefined;
    if (luminance === undefined) return;
    element.style = { ...element.style, color: readableTextColor(element.style.color, luminance, large, bodyInk) };
  });
  // Page numbers are part of the generated design, not of the reviewed copy:
  // they are added after the composition so no layout branch has to remember
  // them. A one-page draft has nothing to number, a cover or a section page
  // carries its own mark, and a template that already declares the footer as
  // busy keeps it. The footer never sits on top of the copy: it uses the
  // margin below the safe area.
  const footerBand = { x: 0, y: 0.94, width: 1, height: 0.06 };
  const footerClaimed = obstacles.some((obstacle) => intersects(footerBand, obstacle));
  const templateFooter = recipe ? templateLayoutHasFooterMarker(recipe) : false;
  // Relayout renders one page through a one-slide command. The deck it
  // belongs to still decides whether a footer exists and what it says.
  const pageIndex = command.pageContext?.index ?? index;
  const pageTotal = command.pageContext?.total ?? command.slides.length;
  if (pageTotal > 1 && design.layout !== "cover" && design.layout !== "section" && !footerClaimed && !templateFooter) {
    const pageLabel = `${String(pageIndex + 1).padStart(2, "0")} / ${String(pageTotal).padStart(2, "0")}`;
    // The left side names the section the page belongs to, not the deck:
    // a 20-page deck whose footer repeats the deck title on every page says
    // nothing about where the reader is. Without sections it falls back to
    // the deck title.
    let sectionLabel = command.pageContext?.sectionLabel;
    for (let sectionIndex = pageIndex; sectionLabel === undefined && sectionIndex >= 0; sectionIndex -= 1) {
      if (command.designs[sectionIndex]?.layout !== "section") continue;
      const sectionTitle = command.slides[sectionIndex]?.title.trim();
      if (sectionTitle) {
        sectionLabel = sectionTitle;
        break;
      }
    }
    const titleChars = [...(sectionLabel ?? command.title.trim())];
    const footerLabel = titleChars.length > 30 ? `${titleChars.slice(0, 29).join("")}…` : titleChars.join("");
    const footerInk = readableTextColor("#5F6B76", pageLuminance, false, bodyInk);
    slide.elements.push({
      ...text(
        footerLabel,
        frame(alignmentGrid.left, 0.947, 0.55, 0.03),
        10,
        footerInk,
        false,
        "left",
        "decorative",
        pageLuminance,
        8,
      ),
      origin: "generated",
    });
    slide.elements.push({
      ...text(
        pageLabel,
        frame(alignmentGrid.right - 0.16, 0.947, 0.16, 0.03),
        10,
        footerInk,
        false,
        "right",
        "decorative",
        pageLuminance,
        8,
      ),
      origin: "generated",
    });
  }
  // Style material tokens are enforced after either the recipe or legacy path
  // has produced native objects. This makes the style a deterministic compiler
  // input instead of a prompt the model may ignore.
  if (command.styleConstraint && command.designConcept) {
    const tokens = deriveDesignTokens(
      document.theme,
      document.pageSize,
      command.designConcept,
      design.designPlan?.typeScale,
      command.styleConstraint,
    );
    for (const element of slide.elements) {
      if (element.type === "shape" && element.shape !== "ellipse") {
        const widthRatio = element.frame.width / pageWidth;
        const heightRatio = element.frame.height / pageHeight;
        const isPanel = widthRatio >= 0.08 && heightRatio >= 0.06 && widthRatio * heightRatio < 0.82;
        if (isPanel) {
          element.style.radiusPt = tokens.radius.cardPt;
          if (tokens.material.shadow === "raised") element.style.shadow = "raised";
          else if (tokens.material.shadow === "paper") element.style.shadow = "card";
          else delete element.style.shadow;
        }
        if (element.style.strokeWidthPt > 0) element.style.strokeWidthPt = tokens.rule.hairlinePt;
      } else if (element.type === "line") {
        element.style.strokeWidthPt = tokens.rule.hairlinePt;
      } else if (element.type === "image" && element.placement === "content") {
        if (tokens.radius.cardPt >= 10) element.frameShape = "roundRect";
        else if (tokens.radius.cardPt === 0) delete element.frameShape;
        if (element.crop && tokens.material.imageCrop !== "editorial") {
          const factor = tokens.material.imageCrop === "contained" ? 0.35 : 1;
          element.crop = {
            top: element.crop.top * factor,
            bottom: element.crop.bottom * factor,
            left: element.crop.left * factor,
            right: element.crop.right * factor,
          };
        }
      }
    }
  }
  // A page is assembled from independent decisions — a recipe, a template
  // frame, a style constraint, a repair that enlarged the title — and any of
  // them can leave a text a few percent taller than its frame. The canvas
  // clips such a text and PowerPoint shrinks it; the page should carry copy
  // that fits instead. The refit is design-only: it never rewrites the words.
  refitSlideText(slide, pageHeight);
  // Provenance is what lets a later design-only relayout replace the
  // generated composition without deleting anything the user added.
  for (const element of slide.elements) element.origin = "generated";
  return slide;
}
