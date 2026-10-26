import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain, slideLayoutOptions, type AiContentBlock } from "./commands";
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
  it("does not add a content version when only the design changes", () => {
    const document = designedDocument([{ type: "metric", label: "收入", value: "38万" }]);
    expect(document.contentVersions).toHaveLength(1);

    const relaid = produce(document, (draft) =>
      applyCommand(draft, { type: "relayout-slide", slideId: document.slides[0]!.id }),
    );

    // 换版式是设计事务：同一份已确认内容只保留一个版本。
    expect(relaid.contentVersions).toHaveLength(1);
    expect(relaid.contentVersions![0]!.slides[0]!.blocks?.[0]).toMatchObject({
      type: "metric",
      label: "收入",
      value: "38万",
    });
  });

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

  it("keeps stat card text pointing at the reviewed metric blocks", () => {
    const document = designedDocument([
      { type: "metric", label: "样本量", value: "38万" },
      { type: "metric", label: "客户数", value: "12人" },
    ]);
    const slide = document.slides[0]!;
    expect(slide.elements.some((element) => element.type === "text" && element.contentBlockRef)).toBe(true);
    const result = produce(document, (draft) => applyCommand(draft, { type: "relayout-slide", slideId: slide.id }));
    const resultSlide = result.slides[0]!;
    const metricIds =
      resultSlide.content.blocks?.filter((block) => block.type === "metric").map((block) => block.id) ?? [];
    const linked = resultSlide.elements.filter((element) => element.type === "text" && element.contentBlockRef);
    // The temporary render creates fresh block ids. A card that kept one would
    // write into a block the page does not own.
    expect(linked).toHaveLength(metricIds.length * 2);
    for (const element of linked) {
      if (element.type !== "text" || !element.contentBlockRef) continue;
      expect(metricIds).toContain(element.contentBlockRef.blockId);
    }
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

  describe("page layout picker", () => {
    const contentLayout = {
      id: crypto.randomUUID(),
      name: "内页（浅色）1",
      backgroundColor: "#FFFFFF",
      capabilities: { hasTitle: true, hasBody: true, hasImage: false, columns: 1, free: false },
    };
    const splitLayout = {
      id: crypto.randomUUID(),
      name: "双栏对比",
      backgroundColor: "#F1F4F8",
      capabilities: { hasTitle: true, hasBody: true, hasImage: false, columns: 2, free: false },
    };
    const coverLayout = {
      id: crypto.randomUUID(),
      name: "封面",
      backgroundColor: "#101820",
      capabilities: { hasTitle: true, hasBody: false, hasImage: false, columns: 1, free: true },
    };

    function pageWithLayouts(blocks: AiContentBlock[]) {
      const base = designedDocument(blocks);
      return produce(base, (draft) => {
        draft.layouts = [contentLayout, splitLayout, coverLayout];
        draft.slides[0]!.layoutId = contentLayout.id;
      });
    }

    it("rebuilds the composition from a target layout without touching content or the layout list", () => {
      const source = pageWithLayouts([{ type: "bullet-list", items: ["第一项", "第二项"] }]);
      const slide = source.slides[0]!;
      const slideId = slide.id;
      const contentBefore = JSON.stringify(slide.content);
      slide.elements.push({
        id: crypto.randomUUID() as never,
        type: "text",
        contentRef: "decorative",
        text: "手工备注",
        frame: { x: inches(0.3), y: inches(6.2), width: inches(2), height: inches(0.3) },
        rotationMilliDegree: 0,
        locked: false,
        origin: "user",
        style: { fontFamily: "Microsoft YaHei", fontSizePt: 12, color: "#333333", bold: false, align: "left" },
      });
      const command = { type: "apply-slide-layout" as const, slideId, layoutId: splitLayout.id };
      expect(commandDomain(command)).toBe("design");

      const result = produce(source, (draft) => applyCommand(draft, command));
      const resultSlide = result.slides[0]!;
      expect(JSON.stringify(resultSlide.content)).toBe(contentBefore);
      expect(result.layouts).toHaveLength(3);
      expect(resultSlide.layoutId).toBe(splitLayout.id);
      expect(resultSlide.background).toBe(splitLayout.backgroundColor);
      expect(
        resultSlide.elements.some(
          (element) => element.type === "text" && element.text === "手工备注" && element.origin === "user",
        ),
      ).toBe(true);
      const bodyTexts = resultSlide.elements.filter(
        (element) => element.type === "text" && element.contentRef === "body",
      );
      // A 双栏 target has to actually draw two columns, not only rewrite layoutId.
      expect(bodyTexts.some((element) => element.frame.x < result.pageSize.width / 2)).toBe(true);
      expect(bodyTexts.some((element) => element.frame.x + element.frame.width > result.pageSize.width / 2)).toBe(
        true,
      );
    });

    it("refuses a missing layout and a layout that would hide reviewed copy", () => {
      const source = pageWithLayouts([{ type: "bullet-list", items: ["第一项", "第二项"] }]);
      const slideId = source.slides[0]!.id;
      expect(() =>
        produce(source, (draft) =>
          applyCommand(draft, { type: "apply-slide-layout", slideId, layoutId: "missing-layout" }),
        ),
      ).toThrow("LAYOUT_NOT_FOUND");
      expect(() =>
        produce(source, (draft) =>
          applyCommand(draft, { type: "apply-slide-layout", slideId, layoutId: coverLayout.id }),
        ),
      ).toThrow("LAYOUT_INCOMPATIBLE");
    });

    it("explains layout availability to the picker", () => {
      const source = pageWithLayouts([{ type: "bullet-list", items: ["第一项", "第二项"] }]);
      const options = slideLayoutOptions(source, source.slides[0]!);
      expect(options.find((option) => option.layout.id === contentLayout.id)?.current).toBe(true);
      expect(options.find((option) => option.layout.id === splitLayout.id)?.issue).toBeUndefined();
      expect(options.find((option) => option.layout.id === coverLayout.id)?.issue).toContain("隐藏内容");
    });

    it("refuses two columns when the page carries only one point", () => {
      const source = pageWithLayouts([{ type: "paragraph", text: "只有一段正文" }]);
      const slideId = source.slides[0]!.id;
      expect(slideLayoutOptions(source, source.slides[0]!).find((option) => option.layout.id === splitLayout.id)?.issue)
        .toContain("至少需要 2 条正文");
      expect(() =>
        produce(source, (draft) =>
          applyCommand(draft, { type: "apply-slide-layout", slideId, layoutId: splitLayout.id }),
        ),
      ).toThrow("LAYOUT_INCOMPATIBLE");
    });
  });
});
