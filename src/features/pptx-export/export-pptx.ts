import PptxGenJS from "pptxgenjs";
import { EMU_PER_INCH, type PresentationDocument, type ShapeElement } from "../../core/document-model";
import { isFontAvailable, validatePresentationForExport, type ExportIssue } from "../../core/validation/export-validation";
import { validatePptxPackage, type PptxPackageValidation } from "./pptx-package";

const inch = (value: number) => value / EMU_PER_INCH;
const color = (value: string) => value.replace(/^#/, "");

export interface ExportReport {
  slideCount: number;
  nativeObjectCount: number;
  warnings: string[];
  issues: ExportIssue[];
  package: PptxPackageValidation;
}

export interface ExportOptions {
  signal?: AbortSignal;
  fontAvailable?: (fontFamily: string) => boolean | Promise<boolean>;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("EXPORT_CANCELLED");
}

function shapeType(pptx: PptxGenJS, element: ShapeElement) {
  if (element.shape === "ellipse") return pptx.ShapeType.ellipse;
  if (element.style.radiusPt > 0) return pptx.ShapeType.roundRect;
  return pptx.ShapeType.rect;
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

  let nativeObjectCount = 0;
  for (const model of document.slides) {
    throwIfCancelled(options.signal);
    const slide = pptx.addSlide();
    slide.background = { color: color(model.background) };

    for (const element of model.elements) {
      throwIfCancelled(options.signal);
      const position = {
        x: inch(element.frame.x),
        y: inch(element.frame.y),
        w: inch(element.frame.width),
        h: inch(element.frame.height),
        rotate: element.rotationMilliDegree / 1000,
      };

      if (element.type === "text") {
        slide.addText(element.text, {
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
        });
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
      } else {
        slide.addImage({ data: element.source.dataUrl, ...position, altText: element.altText });
      }
      nativeObjectCount += 1;
    }

    slide.addNotes(model.content.speakerNotes ? model.content.speakerNotes : "");
  }

  throwIfCancelled(options.signal);
  const result = await pptx.write({ outputType: "uint8array", compression: true });
  const bytes = result instanceof Uint8Array ? result : new Uint8Array(result as ArrayBuffer);
  const packageValidation = validatePptxPackage(bytes);
  if (!packageValidation.valid) {
    throw new Error(`EXPORT_PACKAGE_INVALID: ${packageValidation.issues.join("；")}`);
  }

  return {
    bytes,
    report: {
      slideCount: document.slides.length,
      nativeObjectCount,
      warnings: issues.map((issue) => issue.message),
      issues,
      package: packageValidation,
    },
  };
}
