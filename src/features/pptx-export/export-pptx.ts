import PptxGenJS from "pptxgenjs";
import { unzipSync, zipSync } from "fflate";
import { EMU_PER_INCH, resolveChartData, resolveFragmentStyle, resolveTableData, textFragments, type ChartElement, type ImageCrop, type ImageElement, type PresentationDocument, type ShapeElement, type SlideLayoutSpec } from "../../core/document-model";
import { isFontAvailable, validatePresentationForExport, type ExportIssue } from "../../core/validation/export-validation";
import { validatePptxPackage, type PptxPackageValidation } from "./pptx-package";
import { patchThemeColors } from "./theme-xml";
import { normalizePackagePartNames } from "./package-parts";
import { patchImageCrops } from "./image-crop-xml";

const inch = (value: number) => value / EMU_PER_INCH;
const color = (value: string) => value.replace(/^#/, "");

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
  warnings: string[];
  issues: ExportIssue[];
  package: PptxPackageValidation;
}

export interface ExportOptions {
  signal?: AbortSignal;
  fontAvailable?: (fontFamily: string) => boolean | Promise<boolean>;
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
  const cleaned = name.replace(/[\u0000-\u001f<>:"|?*\\/]/g, "-").replace(/\s+/g, " ").trim();
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
    const artwork = slide.elements.find((element): element is ImageElement => element.type === "image" && element.placement === "layout-background");
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
      ...(artwork ? { artwork: { dataUrl: artwork.source.dataUrl, extension: imageExtension(artwork.source.dataUrl) } } : {}),
    });
  }
  return plans;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("EXPORT_CANCELLED");
}

function shapeType(pptx: PptxGenJS, element: ShapeElement) {
  if (element.shape === "ellipse") return pptx.ShapeType.ellipse;
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
  const issues = await validatePresentationForExport(document, {
    fontAvailable: options.fontAvailable ?? isFontAvailable,
  });
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
      // The artwork of the layout now lives in the master. Drawing it again
      // would put the same picture on the page and break the editability of
      // the exported deck.
      if (element.type === "image" && element.placement === "layout-background") {
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
        const textOptions = {
          ...position,
          fontFace: element.style.fontFamily,
          fontSize: element.style.fontSizePt,
          color: color(element.style.color),
          bold: element.style.bold,
          align: element.style.align,
          // The canvas draws text from the top of its frame; the export has to
          // agree or the file no longer looks like what the editor shows.
          valign: "top",
          margin: 0,
          breakLine: false,
          fit: "shrink",
        };
        // A text with styled fragments is written as real runs, so the emphasis
        // stays editable in PowerPoint instead of being flattened into the
        // style of the whole box.
        if (element.runs && element.runs.length > 0) {
          slide.addText(textFragments(element.text, element.runs).map((fragment) => {
            const style = resolveFragmentStyle(element.style, fragment.style);
            return {
              text: fragment.text,
              options: {
                bold: style.bold,
                color: color(style.color),
                ...(style.underline ? { underline: { style: "sng" as const } } : {}),
              },
            };
          }), textOptions);
        } else {
          slide.addText(element.text, textOptions);
        }
      } else if (element.type === "shape") {
        const type = shapeType(pptx, element);
        slide.addShape(type, {
          ...position,
          fill: { color: color(element.style.fill) },
          line: { color: color(element.style.stroke), width: element.style.strokeWidthPt },
          ...(type === pptx.ShapeType.roundRect
            ? { rectRadius: Math.min(element.style.radiusPt / 72, position.w / 2, position.h / 2) }
            : {}),
        });
      } else if (element.type === "chart") {
        // A native chart, not a picture of a chart: the numbers stay editable
        // in PowerPoint and the file keeps the data of the page.
        const resolved = resolveChartData(model, element);
        if (!resolved) throw new Error("EXPORT_CHART_DATA_INVALID");
        const values = resolved.data.map((datum) => datum.value);
        const labels = resolved.data.map((datum) => datum.category);
        const colors = element.kind === "pie"
          ? resolved.data.map((_, index) => color(element.style.seriesColors[index % element.style.seriesColors.length]!))
          : [color(element.style.seriesColors[0]!)];
        // The unit of the reviewed numbers belongs to the labels, so a value
        // reads "38万" in the deck and not "380000".
        const valueFormat = resolved.unit ? `#,##0.##"${resolved.unit}"` : "#,##0.##";
        slide.addChart(chartType(pptx, element.kind), [{ name: resolved.unit || "数值", labels, values }], {
          ...position,
          ...(element.kind === "column" || element.kind === "bar" ? { barDir: element.kind === "bar" ? "bar" : "col" } : {}),
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
          border: { pt: 0, color: "FFFFFF" },
          fill: "FFFFFF",
        });
        nativeChartCount += 1;
      } else if (element.type === "table") {
        // A native table, not a picture of a grid: the cells stay editable in
        // PowerPoint and the file keeps the reviewed rows of the page.
        const resolved = resolveTableData(model, element);
        if (!resolved) throw new Error("EXPORT_TABLE_DATA_INVALID");
        const columnCount = resolved.header.length;
        const border = { type: "solid" as const, pt: 0.75, color: color(element.style.borderColor) };
        const header = resolved.header.map((cell) => ({
          text: cell,
          options: {
            bold: true,
            color: color(element.style.headerTextColor),
            fill: { color: color(element.style.headerFill) },
            border,
          },
        }));
        const body = resolved.rows.map((row) => {
          const cells = row.slice(0, columnCount);
          while (cells.length < columnCount) cells.push("");
          return cells.map((cell, cellIndex) => ({
            text: cell,
            options: {
              color: color(element.style.bodyTextColor),
              bold: element.style.firstColumnBold && cellIndex === 0,
              border,
            },
          }));
        });
        const rows = [header, ...body];
        // The rows share the frame of the element, so a table never grows past
        // the box the designer gave it.
        const rowHeight = Math.max(0.2, Math.min(0.6, position.h / rows.length));
        slide.addTable(rows, {
          ...position,
          h: rowHeight * rows.length,
          rowH: rowHeight,
          fontFace: element.style.fontFamily,
          fontSize: element.style.fontSizePt,
          color: color(element.style.bodyTextColor),
          valign: "middle",
          margin: 0.05,
          autoPage: false,
          border,
        });
        nativeTableCount += 1;
      } else {
        slide.addImage({ data: element.source.dataUrl, ...position, altText: element.altText });
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
  const themeApplied = theme?.colors.length ? patchThemeColors(entries, theme.colors) : false;
  normalizePackagePartNames(entries);
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
      themeColors: themeApplied ? theme!.colors.map((slot) => slot.name) : [],
      warnings: issues.map((issue) => issue.message),
      issues,
      package: packageValidation,
    },
  };
}
