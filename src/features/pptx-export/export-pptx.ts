import PptxGenJS from "pptxgenjs";
import { unzipSync, zipSync } from "fflate";
import {
  EMU_PER_INCH,
  resolveChartData,
  resolveFragmentStyle,
  resolveTableData,
  tableColumnAlignsRight,
  iconOutline,
  ICON_GRID,
  textFragments,
  type ChartElement,
  type ImageCrop,
  type ImageElement,
  type PresentationDocument,
  type ShapeElement,
  type SlideLayoutSpec,
} from "../../core/document-model";
import {
  isFontAvailable,
  validatePresentationForExport,
  type ExportIssue,
} from "../../core/validation/export-validation";
import { validatePptxPackage, type PptxPackageValidation } from "./pptx-package";
import { linkThemeColors, normalizeThemeColors, patchThemeColors } from "./theme-xml";
import { normalizePackagePartNames } from "./package-parts";
import { patchImageCrops } from "./image-crop-xml";
import { patchSlideTransitions } from "./transition-xml";
import { patchSlideAnimations } from "./native-animation";

const inch = (value: number) => value / EMU_PER_INCH;
const color = (value: string) => value.replace(/^#/, "");
/**
 * PptxGenJS supports custom geometry at runtime, but its bundled `SHAPE_NAME`
 * type predates the value. The cast is confined to this constant so the rest of
 * the exporter stays typed.
 */
const CUSTOM_GEOMETRY = "custGeom" as unknown as PptxGenJS.SHAPE_NAME;

export interface ExportReport {
  slideCount: number;
  nativeObjectCount: number;
  /** Pictures that were written with a crop. */
  croppedImages: number;
  /** Charts that were written as native chart objects, not as pictures. */
  nativeChartCount: number;
  /** Tables that were written as native table objects, not as pictures. */
  nativeTableCount: number;
  /** Names of the slide masters written into the package. */
  masters: string[];
  /** Theme fonts written into the theme part, when the deck declares a theme. */
  themeFonts?: { major: string; minor: string };
  /** Theme color slots written into the theme part. */
  themeColors: string[];
  /** Object colors rewritten as references to those slots. */
  themeColorReferences: number;
  /** Pages that got a native `<p:transition>`. */
  nativeTransitionCount: number;
  /** Object animations written into a native timing tree. */
  nativeAnimationCount: number;
  /** Animations whose effect or target has no native representation. */
  nativeAnimationSkipped: number;
  warnings: string[];
  issues: ExportIssue[];
  package: PptxPackageValidation;
}

export interface ExportOptions {
  signal?: AbortSignal;
  fontAvailable?: (fontFamily: string) => boolean | Promise<boolean>;
  /**
   * Pre-computed preflight issues. A worker has no DOM, so the caller runs the
   * validation (including the font probe) on the main thread and hands the
   * result over; the worker then skips the duplicate pass.
   */
  prevalidatedIssues?: ExportIssue[];
}

/**
 * A template layout that becomes a slide master in the exported package.
 *
 * The artwork of the layout is the background of the master, not a picture
 * that sits on top of the page: a layout background belongs to the layout, and
 * a slide that inherits it stays editable in PowerPoint.
 */
interface MasterPlan {
  title: string;
  layoutId: string;
  backgroundColor: string;
  artwork?: { dataUrl: string; extension: string };
}

function imageExtension(dataUrl: string): string {
  if (/^data:image\/jpeg/i.test(dataUrl)) return "jpeg";
  if (/^data:image\/webp/i.test(dataUrl)) return "webp";
  return "png";
}

/**
 * Layout names come from a foreign file. They end up as the name of a layout
 * in the package and as part of a media path, so the characters that are
 * illegal in XML or in a package path are replaced before they are used.
 */
function safeMasterTitle(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f<>:"|?*\\/]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

/**
 * Collects the layouts the deck was designed against. Every layout becomes one
 * slide master, so slides that share a layout share a master as well.
 */
function planMasters(document: PresentationDocument): Map<string, MasterPlan> {
  const plans = new Map<string, MasterPlan>();
  const usedTitles = new Set<string>();
  for (const slide of document.slides) {
    if (!slide.layoutId) continue;
    const spec: SlideLayoutSpec | undefined = document.layouts?.find((layout) => layout.id === slide.layoutId);
    if (!spec || plans.has(spec.id)) continue;
    // The artwork is a property of the layout, not of the first page that
    // happens to use it. If that first page was simplified, the next page may
    // still carry the artwork; use whichever page has it.
    const artwork = document.slides
      .filter((candidate) => candidate.layoutId === spec.id)
      .flatMap((candidate) => candidate.elements)
      .find(
        (element): element is ImageElement => element.type === "image" && element.placement === "layout-background",
      );
    const base = safeMasterTitle(spec.name, "PPTD 版式");
    let title = base;
    let counter = 2;
    while (usedTitles.has(title)) {
      title = `${base} #${counter}`;
      counter += 1;
    }
    usedTitles.add(title);
    plans.set(spec.id, {
      title,
      layoutId: spec.id,
      backgroundColor: spec.backgroundColor ?? slide.background,
      ...(artwork
        ? { artwork: { dataUrl: artwork.source.dataUrl, extension: imageExtension(artwork.source.dataUrl) } }
        : {}),
    });
  }
  return plans;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("EXPORT_CANCELLED");
}

function shapeType(pptx: PptxGenJS, element: ShapeElement) {
  if (element.shape === "ellipse") return pptx.ShapeType.ellipse;
  if (element.shape === "triangle") return pptx.ShapeType.triangle;
  if (element.shape === "diamond") return pptx.ShapeType.diamond;
  if (element.shape === "pentagon") return pptx.ShapeType.pentagon;
  if (element.shape === "hexagon") return pptx.ShapeType.hexagon;
  if (element.shape === "chevron") return pptx.ShapeType.chevron;
  if (element.shape === "arrow") return pptx.ShapeType.rightArrow;
  if (element.shape === "star") return pptx.ShapeType.star5;
  if (element.shape === "parallelogram") return pptx.ShapeType.parallelogram;
  if (element.shape === "trapezoid") return pptx.ShapeType.trapezoid;
  if (element.style.radiusPt > 0) return pptx.ShapeType.roundRect;
  return pptx.ShapeType.rect;
}

/** The kind of a native chart in the vocabulary of the exporter. */
function chartType(pptx: PptxGenJS, kind: ChartElement["kind"]) {
  if (kind === "line") return pptx.ChartType.line;
  if (kind === "pie") return pptx.ChartType.pie;
  return pptx.ChartType.bar;
}

/**
 * Build a PPTX from an immutable snapshot. Element order is the document's
 * z-order and is never re-sorted: the canvas, thumbnails and export must agree.
 */
export async function buildPptx(
  document: PresentationDocument,
  options: ExportOptions = {},
): Promise<{ bytes: Uint8Array; report: ExportReport }> {
  const issues =
    options.prevalidatedIssues ??
    (await validatePresentationForExport(document, {
      fontAvailable: options.fontAvailable ?? isFontAvailable,
    }));
  const blocking = issues.filter((issue) => issue.severity === "error");
  if (blocking.length > 0) {
    throw new Error(`EXPORT_VALIDATION_FAILED: ${blocking.map((issue) => issue.message).join("；")}`);
  }
  throwIfCancelled(options.signal);

  const pptx = new PptxGenJS();
  const layoutName = "PPTD_CUSTOM";
  pptx.defineLayout({ name: layoutName, width: inch(document.pageSize.width), height: inch(document.pageSize.height) });
  pptx.layout = layoutName;
  pptx.author = "PPTD";
  pptx.subject = "Created with PPTD";
  pptx.title = document.title;
  pptx.company = "PPTD";

  // The theme of the template becomes the theme of the presentation, so the
  // fonts of the deck are the fonts PowerPoint offers when the user picks a
  // new one in the design panel.
  const theme = document.theme;
  const themeSlots = theme ? normalizeThemeColors(theme.colors) : [];
  if (theme) {
    pptx.theme = { headFontFace: theme.majorFont, bodyFontFace: theme.minorFont };
  }

  // Every template layout the deck was designed against becomes a slide
  // master. Slides that share a layout inherit its background instead of
  // painting a copy of it on the page.
  const masters = planMasters(document);
  for (const plan of masters.values()) {
    pptx.defineSlideMaster({
      title: plan.title,
      background: plan.artwork
        ? { path: `layout-artwork.${plan.artwork.extension}`, data: plan.artwork.dataUrl }
        : { color: color(plan.backgroundColor) },
    });
  }

  let nativeObjectCount = 0;
  let croppedImageCount = 0;
  let nativeChartCount = 0;
  let nativeTableCount = 0;
  // The crops of the pictures of every slide, in the order the pictures were
  // added. The source rectangle of a crop is written into the slide XML later.
  const cropsBySlide: (ImageCrop | undefined)[][] = [];
  for (const model of document.slides) {
    throwIfCancelled(options.signal);
    const master = model.layoutId ? masters.get(model.layoutId) : undefined;
    const slide = master ? pptx.addSlide({ masterName: master.title }) : pptx.addSlide();
    // A master that carries the artwork must not be covered by a page
    // background, otherwise the template image would be hidden.
    if (!master?.artwork) slide.background = { color: color(model.background) };
    const slideCrops: (ImageCrop | undefined)[] = [];

    for (const element of model.elements) {
      throwIfCancelled(options.signal);
      // The artwork of the layout lives in the master when the master has it.
      // If it does not (the page that carried it was simplified or removed),
      // drawing the page's own artwork is better than silently losing it.
      if (element.type === "image" && element.placement === "layout-background" && master?.artwork) {
        nativeObjectCount += 1;
        continue;
      }
      const position = {
        x: inch(element.frame.x),
        y: inch(element.frame.y),
        w: inch(element.frame.width),
        h: inch(element.frame.height),
        rotate: element.rotationMilliDegree / 1000,
      };

      if (element.type === "text") {
        const hasRuns = Boolean(element.runs && element.runs.length > 0);
        const textOptions = {
          ...position,
          // The stable element id is written as the object name so the native
          // animation timeline can address this shape by id later.
          objectName: element.id,
          fontFace: element.style.fontFamily,
          fontSize: element.style.fontSizePt,
          color: color(element.style.color),
          // With explicit runs every run carries its own bold flag. PptxGenJS
          // treats a falsy run option as "inherit from the text box", so a
          // bold:false run under a bold element used to come out bold. Leaving
          // the box-level flag out lets the run decide.
          ...(hasRuns ? {} : { bold: element.style.bold }),
          italic: element.style.italic ?? false,
          ...(element.style.underline ? { underline: { style: "sng" as const } } : {}),
          ...(element.style.strikethrough ? { strike: "sngStrike" as const } : {}),
          align: element.style.align,
          ...(element.style.letterSpacingPt === undefined ? {} : { charSpacing: element.style.letterSpacingPt }),
          ...(element.style.lineHeight === undefined ? {} : { lineSpacingMultiple: element.style.lineHeight }),
          // The canvas and the file have to agree on where the text sits in its
          // frame; both read the same vertical alignment now.
          valign: element.style.verticalAlign ?? "top",
          ...(element.style.bullet && element.style.bullet !== "none"
            ? { bullet: element.style.bullet === "number" ? { type: "number" as const } : true }
            : {}),
          ...(element.style.indentLevel ? { indentLevel: element.style.indentLevel } : {}),
          margin: 0,
          breakLine: false,
          fit: "shrink" as const,
        };
        // A text with styled fragments is written as real runs, so the emphasis
        // stays editable in PowerPoint instead of being flattened into the
        // style of the whole box.
        if (hasRuns) {
          slide.addText(
            textFragments(element.text, element.runs).map((fragment) => {
              const style = resolveFragmentStyle(element.style, fragment.style);
              return {
                text: fragment.text,
                options: {
                  bold: style.bold,
                  color: color(style.color),
                  ...(style.underline ? { underline: { style: "sng" as const } } : {}),
                },
              };
            }),
            textOptions,
          );
        } else {
          slide.addText(element.text, textOptions);
        }
      } else if (element.type === "shape") {
        const type = shapeType(pptx, element);
        slide.addShape(type, {
          ...position,
          objectName: element.id,
          fill: { color: color(element.style.fill) },
          line: { color: color(element.style.stroke), width: element.style.strokeWidthPt },
          ...(type === pptx.ShapeType.roundRect
            ? { rectRadius: Math.min(element.style.radiusPt / 72, position.w / 2, position.h / 2) }
            : {}),
        });
      } else if (element.type === "line") {
        // A native line, not a thin rectangle: the arrow heads and the dash
        // pattern have to stay editable in PowerPoint.
        slide.addShape(pptx.ShapeType.line, {
          ...position,
          objectName: element.id,
          fill: { type: "none" },
          line: {
            color: color(element.style.stroke),
            width: element.style.strokeWidthPt,
            ...(element.style.dashed ? { dashType: "dash" as const } : {}),
            ...(element.style.startArrow === "arrow" ? { beginArrowType: "arrow" as const } : {}),
            ...(element.style.endArrow === "arrow" ? { endArrowType: "arrow" as const } : {}),
          },
        });
      } else if (element.type === "chart") {
        // A native chart, not a picture of a chart: the numbers stay editable
        // in PowerPoint and the file keeps the data of the page.
        const resolved = resolveChartData(model, element);
        if (!resolved) throw new Error("EXPORT_CHART_DATA_INVALID");
        const values = resolved.data.map((datum) => datum.value);
        const labels = resolved.data.map((datum) => datum.category);
        const colors =
          element.kind === "pie"
            ? resolved.data.map((_, index) =>
                color(element.style.seriesColors[index % element.style.seriesColors.length]!),
              )
            : [color(element.style.seriesColors[0]!)];
        // The unit of the reviewed numbers belongs to the labels, so a value
        // reads "38万" in the deck and not "380000". Integer data uses an integer
        // format: PowerPoint renders "#,##0.##" as "10." for whole numbers.
        const numberFormat = resolved.data.some((datum) => !Number.isInteger(datum.value)) ? "#,##0.##" : "#,##0";
        const valueFormat = resolved.unit ? `${numberFormat}"${resolved.unit}"` : numberFormat;
        slide.addChart(chartType(pptx, element.kind), [{ name: resolved.unit || "数值", labels, values }], {
          ...position,
          ...(element.kind === "column" || element.kind === "bar"
            ? { barDir: element.kind === "bar" ? "bar" : "col" }
            : {}),
          chartColors: colors,
          showLegend: element.style.showLegend,
          showTitle: false,
          showValue: element.style.showValueLabels,
          dataLabelFormatCode: valueFormat,
          dataLabelColor: color(element.style.textColor),
          dataLabelFontFace: element.style.fontFamily,
          dataLabelFontSize: element.style.fontSizePt,
          catAxisLabelColor: color(element.style.textColor),
          catAxisLabelFontFace: element.style.fontFamily,
          catAxisLabelFontSize: element.style.fontSizePt,
          valAxisLabelColor: color(element.style.textColor),
          valAxisLabelFontFace: element.style.fontFamily,
          valAxisLabelFontSize: Math.max(8, element.style.fontSizePt - 2),
          valAxisLabelFormatCode: valueFormat,
          valGridLine: { color: "E3E7EC", size: 1 },
          catAxisLineShow: false,
          valAxisLineShow: false,
          // The chart area carries the color of the page, not a white block:
          // a native chart on a dark page would otherwise show a bright
          // rectangle that the editor never drew.
          border: { pt: 0, color: color(model.background) },
          fill: color(model.background),
        });
        nativeChartCount += 1;
      } else if (element.type === "table") {
        // A native table, not a picture of a grid: the cells stay editable in
        // PowerPoint and the file keeps the reviewed rows of the page.
        const resolved = resolveTableData(model, element);
        if (!resolved) throw new Error("EXPORT_TABLE_DATA_INVALID");
        const columnCount = resolved.header.length;
        const border = {
          type: "solid" as const,
          pt: element.style.borderWidthPt ?? 0.75,
          color: color(element.style.borderColor),
        };
        const alignsRight = (column: number) => tableColumnAlignsRight(resolved.rows, column);
        const headerBold = element.style.headerBold ?? true;
        // PptxGenJS expects the covered cells to be absent from the row and the
        // top-left cell to carry colspan/rowspan; keeping the covered cells
        // would make it allocate extra columns.
        const mergeStarts = new Map<string, { rowSpan: number; columnSpan: number }>();
        const covered = new Set<string>();
        for (const merge of resolved.merges) {
          mergeStarts.set(`${merge.section}:${merge.row}:${merge.column}`, merge);
          for (let row = merge.row; row < merge.row + merge.rowSpan; row += 1) {
            for (let column = merge.column; column < merge.column + merge.columnSpan; column += 1) {
              if (row === merge.row && column === merge.column) continue;
              covered.add(`${merge.section}:${row}:${column}`);
            }
          }
        }
        const header = resolved.header.flatMap((cell, index) => {
          if (covered.has(`header:0:${index}`)) return [];
          const merge = mergeStarts.get(`header:0:${index}`);
          return [
            {
              text: cell,
              options: {
                bold: headerBold,
                color: color(element.style.headerTextColor),
                fill: { color: color(element.style.headerFill) },
                align: alignsRight(index) ? ("right" as const) : ("left" as const),
                border,
                ...(merge ? { colspan: merge.columnSpan, rowspan: merge.rowSpan } : {}),
              },
            },
          ];
        });
        const body = resolved.rows.map((row, rowIndex) => {
          const cells = row.slice(0, columnCount);
          while (cells.length < columnCount) cells.push("");
          return cells.flatMap((cell, cellIndex) => {
            if (covered.has(`body:${rowIndex}:${cellIndex}`)) return [];
            const merge = mergeStarts.get(`body:${rowIndex}:${cellIndex}`);
            return [
              {
                text: cell,
                options: {
                  color: color(element.style.bodyTextColor),
                  bold: element.style.firstColumnBold && cellIndex === 0,
                  ...(rowIndex % 2 === 1 && element.style.bandingFill
                    ? { fill: { color: color(element.style.bandingFill) } }
                    : {}),
                  align: alignsRight(cellIndex) ? ("right" as const) : ("left" as const),
                  border,
                  ...(merge ? { colspan: merge.columnSpan, rowspan: merge.rowSpan } : {}),
                },
              },
            ];
          });
        });
        const rows = [header, ...body];
        // The rows fill the frame exactly; a fixed 0.2–0.6in clamp made a
        // table taller or shorter than the box the canvas draws.
        const rowHeight = position.h / rows.length;
        slide.addTable(rows, {
          ...position,
          objectName: element.id,
          h: position.h,
          rowH: rowHeight,
          fontFace: element.style.fontFamily,
          fontSize: element.style.fontSizePt,
          color: color(element.style.bodyTextColor),
          valign: "middle",
          margin: (element.style.cellPaddingPt ?? 4) / 72,
          autoPage: false,
          border,
        });
        nativeTableCount += 1;
      } else if (element.type === "icon") {
        // The icon is written as a native custom-geometry shape. PptxGenJS's
        // SVG picture support writes the SVG bytes into the PNG fallback part
        // as well; PowerPoint then refuses the whole package. Native geometry
        // has no image part at all and stays editable after export.
        // The source SVG strokes on a 24-unit grid, so its width has to scale
        // with the frame; a fixed 2pt line made a small badge icon visibly
        // heavier than the same icon on the canvas.
        const strokeWidthPt = ((element.style.strokeWidth ?? 2) * position.w * 72) / ICON_GRID;
        slide.addShape(CUSTOM_GEOMETRY, {
          ...position,
          objectName: element.id,
          line: { color: color(element.style.color), width: strokeWidthPt },
          points: iconOutline(element.name, position.w, position.h),
        });
      } else {
        slide.addImage({
          data: element.source.dataUrl,
          ...position,
          objectName: element.id,
          altText: element.altText,
        });
        slideCrops.push(element.crop);
        if (element.crop) croppedImageCount += 1;
      }
      nativeObjectCount += 1;
    }

    slide.addNotes(model.content.speakerNotes ? model.content.speakerNotes : "");
    cropsBySlide.push(slideCrops);
  }

  throwIfCancelled(options.signal);
  const result = await pptx.write({ outputType: "uint8array", compression: true });
  const written = result instanceof Uint8Array ? result : new Uint8Array(result as ArrayBuffer);
  // The palette of the template is written into the theme part of the package,
  // and the media of a layout background is renamed to a name that can live in
  // a URI. Both are done in one pass over the package, and both are skipped
  // when they are not possible: a failure there must not cost the deck its
  // fonts and its masters.
  const entries = unzipSync(written);
  const themeApplied = themeSlots.length > 0 ? patchThemeColors(entries, themeSlots) : false;
  normalizePackagePartNames(entries);
  // After the scheme carries the deck palette, objects painted with an exact
  // slot value can point at the slot instead of at a literal color. That is
  // what lets a later theme edit in PowerPoint recolor the deck.
  const themeColorReferences = themeSlots.length > 0 ? linkThemeColors(entries, themeSlots) : 0;
  const nativeTransitionCount = patchSlideTransitions(entries, document.slides);
  const animationResult = patchSlideAnimations(entries, document.slides);
  const animationWarnings =
    animationResult.skipped > 0 && !issues.some((issue) => issue.code === "animation-not-exported")
      ? [`${animationResult.skipped} 个动画缺少原生目标或效果不支持，未写入 PPTX`]
      : [];
  const _cropsApplied = patchImageCrops(entries, cropsBySlide);
  const bytes = zipSync(entries, { level: 6 });
  const packageValidation = validatePptxPackage(bytes);
  if (!packageValidation.valid) {
    throw new Error(`EXPORT_PACKAGE_INVALID: ${packageValidation.issues.join("；")}`);
  }

  return {
    bytes,
    report: {
      slideCount: document.slides.length,
      nativeObjectCount,
      croppedImages: croppedImageCount,
      nativeChartCount,
      nativeTableCount,
      masters: [...masters.values()].map((plan) => plan.title),
      ...(theme ? { themeFonts: { major: theme.majorFont, minor: theme.minorFont } } : {}),
      themeColors: themeApplied ? themeSlots.map((slot) => slot.name) : [],
      themeColorReferences,
      nativeTransitionCount,
      nativeAnimationCount: animationResult.written,
      nativeAnimationSkipped: animationResult.skipped,
      warnings: [...issues.map((issue) => issue.message), ...animationWarnings],
      issues,
      package: packageValidation,
    },
  };
}
