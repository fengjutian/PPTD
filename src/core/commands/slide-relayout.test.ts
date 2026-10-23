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
  return produce(source, (draft) =>
    applyCommand(draft, {
      type: "apply-ai-designed-draft",
      title: "回归测试",
      slides: [{ title: "指标", body: "", speakerNotes: "", blocks }],
      designs: [design],
    }),
  );
}

describe("design-only relayout", () => {
  it("recognises legacy list copy as generated and keeps unrelated hand-written text", () => {
    const document = designedDocument([{ type: "paragraph", text: "第一点\n第二点\n第三点" }]);
    const slide = structuredClone(document).slides[0]!;
    slide.elements.push(
      {
        id: crypto.randomUUID() as never,
        type: "text",
        contentRef: "decorative",
        text: "第一点",
        frame: { x: inches(0.1), y: inches(0.1), width: inches(1), height: inches(0.1) },
        rotationMilliDegree: 0,
        locked: false,
        style: { fontFamily: "Microsoft YaHei", fontSizePt: 16, color: "#333333", bold: false, align: "left" },
      },
      {
        id: crypto.randomUUID() as never,
        type: "text",
        contentRef: "decorative",
        text: "手工备注",
        frame: { x: inches(0.2), y: inches(0.3), width: inches(1), height: inches(0.1) },
        rotationMilliDegree: 0,
        locked: false,
        style: { fontFamily: "Microsoft YaHei", fontSizePt: 16, color: "#333333", bold: false, align: "left" },
      },
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
    const title = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.contentRef === "title",
    );
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
    const metricIds =
      resultSlide.content.blocks?.filter((block) => block.type === "metric").map((block) => block.id) ?? [];
    expect(resultChart.contentBlockIds).toEqual(metricIds);
    expect(
      resultSlide.elements.some((element) => element.type === "chart" && element.contentBlockIds.length === 0),
    ).toBe(false);
  });

  it("keeps a native table pointing at the reviewed table block", () => {
    const document = designedDocument([{ type: "table-data", header: ["项目", "数值"], rows: [["完成率", "92%"]] }]);
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
    expect(after.slides[0]!.content).toEqual(
      expect.objectContaining({
        title: before.slides[0]!.content.title,
        body: before.slides[0]!.content.body,
        blocks: before.slides[0]!.content.blocks,
        speakerNotes: before.slides[0]!.content.speakerNotes,
        status: before.slides[0]!.content.status,
      }),
    );

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.revisions).toEqual(before.revisions);
    expect(useEditorStore.getState().document.slides[0]!.elements).toEqual(before.slides[0]!.elements);
  });

  it("keeps a page background picture behind the regenerated copy", () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    applyCommand(document, {
      type: "set-slide-background-image",
      slideId,
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      mimeType: "image/png",
    });
    applyCommand(document, { type: "relayout-slide", slideId });
    const elements = document.slides[0]!.elements;
    const background = elements.findIndex(
      (element) => element.type === "image" && element.placement === "slide-background",
    );
    const firstText = elements.findIndex((element) => element.type === "text");
    // 背景必须在正文之前；放到最后会让整页被自己的背景盖住。
    expect(background).toBeGreaterThanOrEqual(0);
    expect(background).toBeLessThan(firstText);
  });

  it("keeps an AI-generated content picture when the page is relaid out", () => {
    const source = createDocument();
    const document = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "配图页",
        slides: [{ title: "配图页", body: "正文", speakerNotes: "" }],
        designs: [{ ...design, visualAsset: { enabled: true, role: "side", prompt: "一间明亮的办公室" } }],
        visualAssets: [
          {
            slideIndex: 0,
            dataUrl: "data:image/png;base64,iVBORw0KGgo=",
            mimeType: "image/png",
            naturalWidth: 1600,
            naturalHeight: 900,
            altText: "AI 配图",
          },
        ],
      }),
    );
    const slideId = document.slides[0]!.id;
    expect(document.slides[0]!.elements.some((element) => element.type === "image")).toBe(true);

    const relaid = produce(document, (draft) => applyCommand(draft, { type: "relayout-slide", slideId }));

    // 重排没有 visualAssets 可重新摆放，不能把已经生成的配图当成
    // “generated”直接丢掉。
    expect(relaid.slides[0]!.elements.some((element) => element.type === "image")).toBe(true);
  });

  it("keeps the deck page number when a single page is relaid out", () => {
    const source = createDocument();
    const document = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "三页稿",
        slides: [
          { title: "封面", body: "", speakerNotes: "" },
          { title: "第一页", body: "正文一", speakerNotes: "" },
          { title: "第二页", body: "正文二", speakerNotes: "" },
        ],
        designs: [design, design, design],
      }),
    );
    const slideId = document.slides[1]!.id;
    const footerBefore = document.slides[1]!.elements.find(
      (element) => element.type === "text" && element.text.includes("/ 03"),
    );
    expect(footerBefore?.type).toBe("text");

    const relaid = produce(document, (draft) => applyCommand(draft, { type: "relayout-slide", slideId }));
    const footerAfter = relaid.slides[1]!.elements.find(
      (element) => element.type === "text" && element.text.includes("/ 03"),
    );
    // 重排只渲染一页，但页脚仍要写“02 / 03”，不能退回单页编号。
    expect(footerAfter?.type).toBe("text");
  });
});
