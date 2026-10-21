import type { DocumentId, ElementId, Emu, PresentationDocument, Slide, SlideId } from "./types";
import { hashSlideContent } from "./content-hash";

export const EMU_PER_INCH = 914_400;
export const emu = (value: number) => Math.round(value) as Emu;
export const inches = (value: number) => emu(value * EMU_PER_INCH);

const uid = () => crypto.randomUUID();

export function createSlide(index: number): Slide {
  const content = { title: `第 ${index} 页`, body: "", speakerNotes: "", status: "draft" as const };
  return {
    id: uid() as SlideId,
    background: "#ffffff",
    content: { ...content, contentHash: hashSlideContent(content) },
    elements: [
      {
        id: uid() as ElementId,
        type: "text",
        contentRef: "title",
        frame: { x: inches(0.75), y: inches(0.65), width: inches(7.5), height: inches(0.8) },
        rotationMilliDegree: 0,
        locked: false,
        text: index === 1 ? "开始创造你的演示文稿" : `第 ${index} 页`,
        style: { fontFamily: "Microsoft YaHei", fontSizePt: 28, color: "#17181c", bold: true, align: "left" },
      },
    ],
  };
}

export function createDocument(): PresentationDocument {
  return {
    id: uid() as DocumentId,
    schemaVersion: 2,
    title: "未命名演示文稿",
    pageSize: { width: inches(13.333), height: inches(7.5) },
    revisions: { document: 0, content: 0, design: 0 },
    slides: [createSlide(1)],
  };
}
