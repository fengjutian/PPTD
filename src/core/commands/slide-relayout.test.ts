import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, type AiContentBlock } from "./commands";
import { classifyRelayoutElements } from "./slide-relayout";
import { createDocument, inches } from "../document-model";
import { useEditorStore } from "../../store/editor-store";

const design = {
  layout: "title-body" as const,
  background: "#FFFFFF",
  accent: "#3366CC",
  titleColor: "#111111",
  bodyColor: "#333333",
};

function designedDocument(blocks: AiContentBlock[]) {
  const source = createDocument();
  return produce(source, (draft) => applyCommand(draft, {
    type: "apply-ai-designed-draft",
    title: "回归测试",
    slides: [{ title: "指标", body: "", speakerNotes: "", blocks }],
    designs: [design],
  }));
}

describe("design-only relayout", () => {
  it("recognises legacy list copy as generated and keeps unrelated hand-written text", () => {
    const document = designedDocument([{ type: "paragraph", text: "第一点\n第二点\n第三点" }]);
    const slide = structuredClone(document).slides[0]!;
    slide.elements.push(
      { id: crypto.randomUUID() as never, type: "text", contentRef: "decorative", text: "第一点", frame: { x: inches(0.1), y: inches(0.1), width: inches(1), height: inches(0.1) }, rotationMilliDegree: 0, locked: false, style: { fontFamily: "Microsoft YaHei", fontSizePt: 16, color: "#333333", bold: false, align: "left" } },
      { id: crypto.randomUUID() as never, type: "text", contentRef: "decorative", text: "手工备注", frame: { x: inches(0.2), y: inches(0.3), width: inches(1), height: inches(0.1) }, rotationMilliDegree: 0, locked: false, style: { fontFamily: "Microsoft YaHei", fontSizePt: 16, color: "#333333", bold: false, align: "left" } },
    );
    // Strip provenance to mimic a document written before the marker existed.
    for (const element of slide.elements) delete element.origin;
    const classified = classifyRelayoutElements(slide);
    expect(classified.generated.some((element) => element.type === "text" && element.text === "第一点")).toBe(true);
    expect(classified.preserved.some((element) => element.type === "text" && element.text === "手工备注")).toBe(true);
  });

  it("keeps the existing dark ink when the page background is light", () => {
    const document = designedDocument([{ type: "paragraph", text: "已经审核的正文。" }]);
    const slide = document.slides[0]!;
    const before = slide.elements.find((element) => element.type === "text" && element.contentRef === "title");
    expect(before?.type).toBe("text");
    const result = produce(document, (draft) => applyCommand(draft, { type: "relayout-slide", slideId: slide.id }));
    const title = result.slides[0]!.elements.find((element) => element.type === "text" && element.contentRef === "title");
    expect(title?.type).toBe("text");
    if (title?.type !== "text" || before?.type !== "text") return;
    expect(title.style.color).toBe(before.style.color);
    expect(title.style.color.toUpperCase()).not.toBe("#FFFFFF");
  });

  it("keeps a native chart pointing at the reviewed metric blocks", () => {
    const document = designedDocument([
      { type: "metric", label: "样本量", value: "38%" },
      { type: "metric", label: "增长率", value: "12%" },
    ]);
    const slide = document.slides[0]!;
    const chart = slide.elements.find((element) => element.type === "chart");
    expect(chart?.type).toBe("chart");
    const result = produce(document, (draft) => applyCommand(draft, { type: "relayout-slide", slideId: slide.id }));
    const resultSlide = result.slides[0]!;
    const resultChart = resultSlide.elements.find((element) => element.type === "chart");
    expect(resultChart?.type).toBe("chart");
    if (resultChart?.type !== "chart") return;
    const metricIds = resultSlide.content.blocks?.filter((block) => block.type === "metric").map((block) => block.id) ?? [];
    expect(resultChart.contentBlockIds).toEqual(metricIds);
    expect(resultSlide.elements.some((element) => element.type === "chart" && element.contentBlockIds.length === 0)).toBe(false);
  });

  it("keeps a native table pointing at the reviewed table block", () => {
    const document = designedDocument([
      { type: "table-data", header: ["项目", "数值"], rows: [["完成率", "92%"]] },
    ]);
    const slide = document.slides[0]!;
    const table = slide.elements.find((element) => element.type === "table");
    expect(table?.type).toBe("table");
    const result = produce(document, (draft) => applyCommand(draft, { type: "relayout-slide", slideId: slide.id }));
    const resultSlide = result.slides[0]!;
    const resultTable = resultSlide.elements.find((element) => element.type === "table");
    expect(resultTable?.type).toBe("table");
    if (resultTable?.type !== "table") return;
    const tableBlock = resultSlide.content.blocks?.find((block) => block.type === "table-data");
    expect(resultTable.contentBlockId).toBe(tableBlock?.id);
  });

  it("is one design-only undo step and leaves the content revision alone", () => {
    const document = designedDocument([{ type: "paragraph", text: "已经审核的正文。" }]);
    const slideId = document.slides[0]!.id;
    useEditorStore.setState({ document, activeSlideId: slideId, selectedElementIds: [], undoStack: [], redoStack: [] });
    const before = useEditorStore.getState().document;
    useEditorStore.getState().execute({ type: "relayout-slide", slideId });
    const after = useEditorStore.getState().document;
    expect(after.revisions).toEqual({
      document: before.revisions.document + 1,
      content: before.revisions.content,
      design: before.revisions.design + 1,
    });
    expect(after.slides[0]!.content).toEqual(expect.objectContaining({
      title: before.slides[0]!.content.title,
      body: before.slides[0]!.content.body,
      blocks: before.slides[0]!.content.blocks,
      speakerNotes: before.slides[0]!.content.speakerNotes,
      status: before.slides[0]!.content.status,
    }));

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.revisions).toEqual(before.revisions);
    expect(useEditorStore.getState().document.slides[0]!.elements).toEqual(before.slides[0]!.elements);
  });
});
