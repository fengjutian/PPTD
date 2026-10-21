import PptxGenJS from "pptxgenjs";
import { EMU_PER_INCH, type PresentationDocument } from "../../core/document-model";

const inch = (value: number) => value / EMU_PER_INCH;
const color = (value: string) => value.replace(/^#/, "");

export interface ExportReport {
  slideCount: number;
  nativeObjectCount: number;
  warnings: string[];
}

export async function buildPptx(document: PresentationDocument): Promise<{ bytes: Uint8Array; report: ExportReport }> {
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
    const slide = pptx.addSlide();
    slide.background = { color: color(model.background) };
    for (const element of [...model.elements].sort((a, b) => a.frame.y - b.frame.y)) {
      const position = { x: inch(element.frame.x), y: inch(element.frame.y), w: inch(element.frame.width), h: inch(element.frame.height), rotate: element.rotationMilliDegree / 1000 };
      if (element.type === "text") {
        slide.addText(element.text, { ...position, fontFace: element.style.fontFamily, fontSize: element.style.fontSizePt, color: color(element.style.color), bold: element.style.bold, align: element.style.align, margin: 0, breakLine: false, fit: "shrink" });
      } else if (element.type === "shape") {
        slide.addShape(element.shape === "ellipse" ? pptx.ShapeType.ellipse : pptx.ShapeType.rect, { ...position, fill: { color: color(element.style.fill) }, line: { color: color(element.style.stroke), width: element.style.strokeWidthPt } });
      } else {
        slide.addImage({ data: element.source.dataUrl, ...position, altText: element.altText });
      }
      nativeObjectCount += 1;
    }
    slide.addNotes(model.content.speakerNotes ? model.content.speakerNotes : "");
  }

  const result = await pptx.write({ outputType: "uint8array", compression: true });
  const bytes = result instanceof Uint8Array ? result : new Uint8Array(result as ArrayBuffer);
  return { bytes, report: { slideCount: document.slides.length, nativeObjectCount, warnings: [] } };
}
