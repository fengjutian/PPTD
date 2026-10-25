import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { classifyRelayoutElements, inferRelayoutContext } from "./slide-relayout";
import { createDocument, inches, type TextElement } from "../document-model";
import { defaultEditorialConcept, resolveDeckConcept } from "../design/deck-concept";
import { contrastRatio } from "../rendering/contrast";
import { textLikelyOverflows } from "../rendering/text-fit";

describe("commands 5", () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const bodyStyle = {
    fontFamily: "Microsoft YaHei",
    fontSizePt: 20,
    color: "#30343A",
    bold: false,
    align: "left" as const,
  };

  /** 一页有标题和一整块正文的页面。 */
  function pageWithBody() {
    const source = createDocument();
    source.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "text",
      contentRef: "body",
      text: "正文内容",
      frame: { x: inches(0.8), y: inches(1.8), width: inches(11.7), height: inches(3.4) },
      rotationMilliDegree: 0,
      locked: false,
      style: bodyStyle,
    });
    return source;
  }

  it("deepens a badge fill so the numerals stay readable on it", () => {
    const source = createDocument();
    const content = { title: "要点", body: "1. 第一项优势\n2. 第二项优势", speakerNotes: "" };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#15A590",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const badge = result.slides[0]!.elements.find((element) => element.type === "shape" && element.shape === "ellipse");
    const numeral = result.slides[0]!.elements.find(
      (element) =>
        element.type === "text" && element.text === "01" && element.frame.width < source.pageSize.width * 0.04,
    );
    expect(badge?.type === "shape" && contrastRatio("#FFFFFF", badge.style.fill)!).toBeGreaterThanOrEqual(4.5);
    expect(numeral?.type === "text" && numeral.style.color).toBe("#FFFFFF");
  });

  it("sizes a stat card to the number and the label it carries", () => {
    const source = createDocument();
    const content = {
      title: "关键指标",
      body: "",
      speakerNotes: "",
      blocks: [{ type: "metric" as const, label: "年检测样本量", value: "38万" }],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const value = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === "38万");
    const label = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === "年检测样本量",
    );
    const card = result.slides[0]!.elements.find(
      (element) => element.type === "shape" && element.frame.width > source.pageSize.width * 0.5,
    );
    expect(card?.type === "shape").toBe(true);
    // The card used to stretch over the whole content region and left the
    // label stranded at the bottom of an empty panel.
    expect(card!.type === "shape" && card!.frame.height).toBeLessThan(source.pageSize.height * 0.3);
    expect(value!.type === "text" && label!.type === "text" && value!.frame.y).toBeGreaterThan(card!.frame.y);
    expect(label!.type === "text" && label!.frame.y + label!.frame.height).toBeLessThanOrEqual(
      card!.frame.y + card!.frame.height,
    );
  });

  it("binds the page to the template layout and keeps the artwork as the layout background", () => {
    const source = createDocument();
    const content = { title: "模板标题", body: "模板正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateLayouts = [
      {
        index: 11,
        name: "内页（浅色）1",
        backgroundColor: "#FFFFFF",
        backgroundImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        regions: [
          { role: "title" as const, frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 } },
          { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 } },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "模板文稿",
        slides: [content],
        designs: [design],
        templateLayouts,
        templateTheme: {
          name: "昆佰泰",
          majorFont: "思源黑体",
          minorFont: "思源宋体",
          colors: [{ name: "accent1", value: "#C04A32" }],
        },
      }),
    );
    // The layout is kept, so the exported file can carry it as a slide master.
    expect(result.layouts).toHaveLength(1);
    expect(result.layouts![0]!.name).toBe("内页（浅色）1");
    expect(result.slides[0]!.layoutId).toBe(result.layouts![0]!.id);
    // The artwork belongs to the layout, not to the page.
    const artwork = result.slides[0]!.elements.find((element) => element.type === "image");
    expect(artwork?.type === "image" && artwork.placement).toBe("layout-background");
    expect(result.theme).toEqual({
      name: "昆佰泰",
      majorFont: "思源黑体",
      minorFont: "思源宋体",
      colors: [{ name: "accent1", value: "#C04A32" }],
    });
  });

  it("draws metrics of the same unit as a native chart instead of loose cards", () => {
    const source = createDocument();
    const content = {
      title: "关键指标",
      body: "",
      speakerNotes: "",
      blocks: [
        { type: "metric" as const, label: "年检测样本量", value: "38万" },
        { type: "metric" as const, label: "覆盖机构", value: "12万" },
        { type: "metric" as const, label: "出具报告", value: "6万" },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const chart = result.slides[0]!.elements.find((element) => element.type === "chart");
    expect(chart?.type === "chart").toBe(true);
    // The chart points at the reviewed metric blocks instead of copying them.
    const blocks = result.slides[0]!.content.blocks ?? [];
    expect(chart!.type === "chart" && chart!.contentBlockIds).toEqual(
      blocks.filter((block) => block.type === "metric").map((block) => block.id),
    );
    // The stat cards are gone: the page carries one chart instead of boxes
    // with the same numbers.
    expect(
      result.slides[0]!.elements.filter(
        (element) => element.type === "shape" && element.frame.width > source.pageSize.width * 0.2,
      ),
    ).toHaveLength(0);
    expect(result.slides[0]!.elements.some((element) => element.type === "text" && element.text === "38万")).toBe(
      false,
    );
  });

  it("lets the plan type scale change the title size", () => {
    const source = createDocument();
    const content = {
      title: "短标题",
      body: "第一句正文。\n第二句正文。\n第三句正文。",
      speakerNotes: "",
      blocks: [],
    };
    const design = (typeScale: "compact" | "normal" | "expressive") => ({
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
      designPlan: {
        role: "claim" as const,
        composition: { primitive: "stack" as const },
        density: "normal" as const,
        typeScale,
        templatePolicy: "use" as const,
        recipe: "asymmetric-split" as const,
      },
    });
    const resolved = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: [
        {
          itemCount: 3,
          shortItems: true,
          longestItemLength: 6,
          bodyLength: 20,
          hasQuote: false,
          hasComparison: false,
          hasRowBlock: false,
          layout: "title-body",
        },
      ],
      pageCount: 1,
      id: "type-scale-test",
    });
    const titleSize = (typeScale: "compact" | "normal" | "expressive") => {
      const result = produce(source, (draft) =>
        applyCommand(draft, {
          type: "apply-ai-designed-draft",
          title: "标题",
          slides: [content],
          designs: [design(typeScale)],
          designConcept: resolved.concept,
        }),
      );
      const title = [...result.slides[0]!.elements]
        .reverse()
        .find((element) => element.type === "text" && element.contentRef === "title");
      return title?.type === "text" ? title.style.fontSizePt : 0;
    };
    expect(titleSize("compact")).toBeLessThan(titleSize("normal"));
    expect(titleSize("expressive")).toBeGreaterThan(titleSize("normal"));
  });

  it("lets the data relation override an incompatible chart type", () => {
    const source = createDocument();
    const content = {
      title: "季度趋势",
      body: "",
      speakerNotes: "",
      blocks: [
        { type: "metric" as const, label: "第一季度", value: "38" },
        { type: "metric" as const, label: "第二季度", value: "52" },
        { type: "metric" as const, label: "第三季度", value: "61" },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
      designPlan: {
        role: "claim" as const,
        composition: { primitive: "stack" as const },
        density: "normal" as const,
        templatePolicy: "use" as const,
        // The model asked for a pie, but the page is about change over time.
        chart: { kind: "pie" as const, relation: "change" as const },
      },
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const chart = result.slides[0]!.elements.find((element) => element.type === "chart");
    expect(chart?.type === "chart" && chart.kind).toBe("line");
  });

  it("keeps the stat cards when the metrics do not share one unit", () => {
    const source = createDocument();
    const content = {
      title: "关键指标",
      body: "",
      speakerNotes: "",
      blocks: [
        { type: "metric" as const, label: "年检测样本量", value: "38万" },
        { type: "metric" as const, label: "年度增长率", value: "12%" },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    expect(result.slides[0]!.elements.some((element) => element.type === "chart")).toBe(false);
    expect(result.slides[0]!.elements.some((element) => element.type === "text" && element.text === "38万")).toBe(true);
  });

  it("draws a table block as a native table that points at the reviewed cells", () => {
    const source = createDocument();
    const content = {
      title: "检测能力",
      body: "",
      speakerNotes: "",
      blocks: [
        {
          type: "table-data" as const,
          header: ["项目", "数量"],
          rows: [
            ["样本量", "38万"],
            ["覆盖机构", "12万"],
          ],
        },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const table = result.slides[0]!.elements.find((element) => element.type === "table");
    expect(table?.type === "table").toBe(true);
    // The table holds no cells of its own: it points at the reviewed block, so
    // the exported grid can never show a cell the content does not carry.
    const blocks = result.slides[0]!.content.blocks ?? [];
    expect(table!.type === "table" && table!.contentBlockId).toBe(
      blocks.find((block) => block.type === "table-data")?.id,
    );
    // The cells are not copied into loose text boxes either.
    expect(result.slides[0]!.elements.some((element) => element.type === "text" && element.text === "38万")).toBe(
      false,
    );
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("duplicates a page with a native table and keeps the copy pointing at its own cells", () => {
    const source = createDocument();
    const content = {
      title: "检测能力",
      body: "",
      speakerNotes: "",
      blocks: [{ type: "table-data" as const, header: ["项目", "数量"], rows: [["样本量", "38万"]] }],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const designed = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const result = produce(designed, (draft) =>
      applyCommand(draft, { type: "duplicate-slide", slideId: designed.slides[0]!.id }),
    );
    const original = designed.slides[0]!.elements.find((element) => element.type === "table")!;
    const copy = result.slides[1]!.elements.find((element) => element.type === "table")!;
    expect(copy.id).not.toBe(original.id);
    // The copy points at the table block of its own page, not at the original.
    expect(copy.type === "table" && copy.contentBlockId).toBe(
      result.slides[1]!.content.blocks?.find((block) => block.type === "table-data")?.id,
    );
  });

  it("shrinks a text that overflows so it fits into its frame and keeps the copy frozen", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    if (title.type !== "text") throw new Error("expected a text element");
    title.text = "一段很长的标题需要放进同一个文本框里所以它必须换行很多次";
    const originalHash = slide.content.contentHash;
    const before = title.style.fontSizePt;
    expect(textLikelyOverflows(title)).toBe(true);

    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "fit-text", slideId: slide.id, elementId: title.id }),
    );
    const element = result.slides[0]!.elements[0]!;
    expect(element.type === "text" && element.style.fontSizePt).toBeLessThan(before);
    // The text now fits, so the quality gate stops reporting an overflow.
    expect(element.type === "text" && textLikelyOverflows(element)).toBe(false);
    // Fitting is design: the copy and the review state stay.
    expect(result.slides[0]!.content.contentHash).toBe(originalHash);
    expect(result.slides[0]!.content.status).toBe(source.slides[0]!.content.status);
  });

  it("keeps the size of a text that already fits", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const before = title.type === "text" ? title.style.fontSizePt : 0;
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "fit-text", slideId: slide.id, elementId: title.id }),
    );
    const element = result.slides[0]!.elements[0]!;
    expect(element.type === "text" && element.style.fontSizePt).toBe(before);
  });

  it("emphasises a range of a text without touching the approved copy", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-emphasis",
        slideId: slide.id,
        elementId: title.id,
        start: 0,
        end: 2,
        style: { bold: true },
      }),
    );
    const element = result.slides[0]!.elements[0]!;
    expect(element.type === "text" && element.runs).toEqual([{ start: 0, end: 2, bold: true }]);
    // The copy is content and the emphasis is design: the text itself does not
    // move and the content hash stays the same.
    expect(element.type === "text" && element.text).toBe(title.type === "text" ? title.text : "");
    expect(result.slides[0]!.content.contentHash).toBe(source.slides[0]!.content.contentHash);
  });

  it("clears the emphasis of a range and keeps the rest of the text", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const emphasised = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-emphasis",
        slideId: slide.id,
        elementId: title.id,
        start: 0,
        end: 4,
        style: { bold: true },
      }),
    );
    const result = produce(emphasised, (draft) =>
      applyCommand(draft, { type: "clear-text-emphasis", slideId: slide.id, elementId: title.id, start: 0, end: 2 }),
    );
    const element = result.slides[0]!.elements[0]!;
    expect(element.type === "text" && element.runs).toEqual([{ start: 2, end: 4, bold: true }]);
  });

  it("drops the emphasis when the copy of the text changes", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const emphasised = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-emphasis",
        slideId: slide.id,
        elementId: title.id,
        start: 0,
        end: 2,
        style: { bold: true },
      }),
    );
    const result = produce(emphasised, (draft) =>
      applyCommand(draft, { type: "edit-text", slideId: slide.id, elementId: title.id, text: "新的标题" }),
    );
    const element = result.slides[0]!.elements[0]!;
    // The fragments addressed the old copy, so they would point at other words
    // now. Dropping them keeps the emphasis honest.
    expect(element.type === "text" && element.runs).toBeUndefined();
    expect(element.type === "text" && element.text).toBe("新的标题");
  });

  it("refuses an emphasis that leaves the text", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const command = {
      type: "set-text-emphasis" as const,
      slideId: slide.id,
      elementId: title.id,
      start: 0,
      end: 999,
      style: { bold: true },
    };
    expect(commandDomain(command)).toBe("design");
    expect(() => produce(source, (draft) => applyCommand(draft, command))).toThrow("INVALID_TEXT_EMPHASIS");
  });

  it("keeps the table cells in the content so a design command cannot rewrite them", () => {
    const source = createDocument();
    const content = {
      title: "检测能力",
      body: "",
      speakerNotes: "",
      blocks: [{ type: "table-data" as const, header: ["项目", "数量"], rows: [["样本量", "38万"]] }],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const cells = (result.slides[0]!.content.blocks ?? []).find((block) => block.type === "table-data");
    expect(cells?.type === "table-data" && cells.rows[0]?.[1]).toBe("38万");
    // The element keeps no copy of the cells, so the grid cannot drift away
    // from the reviewed table.
    const table = result.slides[0]!.elements.find((element) => element.type === "table");
    expect(JSON.stringify(table)).not.toContain("38万");
    expect(JSON.stringify(table)).not.toContain("样本量");
  });

  it("marks generated layout elements and user additions with provenance", () => {
    const source = createDocument();
    const content = { title: "三个重点", body: "第一项\n第二项\n第三项", speakerNotes: "" };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const generated = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "卡片", slides: [content], designs: [design] }),
    );
    expect(generated.slides[0]!.elements.every((element) => element.origin === "generated")).toBe(true);

    const withUser = produce(generated, (draft) =>
      applyCommand(draft, { type: "add-text", slideId: generated.slides[0]!.id }),
    );
    expect(withUser.slides[0]!.elements.at(-1)!.origin).toBe("user");
  });

  it("re-lays out a legacy split page as a count page without touching content or user objects", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const items = [
      "范仲淹因主张改革被贬邓州",
      "受好友滕子京之托撰写",
      "滕子京重修岳阳楼",
      "作者借题发挥寄托政治理想",
      "体现逆境中的豁达心态",
    ];
    slide.content = { title: "写作背景", body: items.join("\n"), speakerNotes: "讲稿", status: "approved" };
    const title = slide.elements[0]!;
    if (title.type === "text") {
      title.text = "写作背景";
      title.contentRef = "title";
      title.frame = { x: inches(0.8), y: inches(0.5), width: inches(8.5), height: inches(0.8) };
    }
    const bodyStyle = {
      fontFamily: "Microsoft YaHei",
      fontSizePt: 20,
      color: "#30343A",
      bold: false,
      align: "left" as const,
    };
    slide.elements.push(
      {
        id: crypto.randomUUID() as never,
        type: "text",
        contentRef: "body",
        text: items.slice(0, 3).join("\n\n"),
        frame: { x: inches(0.8), y: inches(1.8), width: inches(5.2), height: inches(3.4) },
        rotationMilliDegree: 0,
        locked: false,
        style: bodyStyle,
      },
      {
        id: crypto.randomUUID() as never,
        type: "text",
        contentRef: "body",
        text: items.slice(3).join("\n\n"),
        frame: { x: inches(6.8), y: inches(1.8), width: inches(5.2), height: inches(3.4) },
        rotationMilliDegree: 0,
        locked: false,
        style: bodyStyle,
      },
      {
        id: crypto.randomUUID() as never,
        type: "image",
        frame: { x: inches(10.2), y: inches(5.8), width: inches(1.2), height: inches(0.8) },
        rotationMilliDegree: 0,
        locked: false,
        source: { kind: "embedded", dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" },
        altText: "手工图片",
      },
      {
        id: crypto.randomUUID() as never,
        type: "text",
        contentRef: "decorative",
        text: "手工标注",
        frame: { x: inches(1.1), y: inches(6.4), width: inches(2.6), height: inches(0.35) },
        rotationMilliDegree: 0,
        locked: false,
        style: { ...bodyStyle, fontSizePt: 14, bold: true },
      },
    );
    const contentBefore = JSON.stringify(slide.content);
    const imageId = slide.elements.find((element) => element.type === "image")!.id;
    const noteId = slide.elements.find((element) => element.type === "text" && element.text === "手工标注")!.id;
    // The picture and the note were added by hand, so the relayout has to keep
    // them and rebuild only what the page generated.
    const classified = classifyRelayoutElements(slide);
    expect(classified.preserved.some((element) => element.id === imageId)).toBe(true);
    expect(classified.preserved.some((element) => element.id === noteId)).toBe(true);
    expect(inferRelayoutContext(slide, source).templateLayout).toBeDefined();
    const command = { type: "relayout-slide" as const, slideId: slide.id };
    expect(commandDomain(command)).toBe("design");
    const result = produce(source, (draft) => applyCommand(draft, command));
    const resultSlide = result.slides[0]!;
    expect(JSON.stringify(resultSlide.content)).toBe(contentBefore);
    expect(resultSlide.elements.some((element) => element.id === imageId)).toBe(true);
    expect(
      resultSlide.elements.some(
        (element) => element.id === noteId && element.type === "text" && element.text === "手工标注",
      ),
    ).toBe(true);
    expect(resultSlide.elements.some((element) => element.type === "text" && element.text === "项要点")).toBe(true);
    expect(resultSlide.elements.filter((element) => element.origin === "user").length).toBeGreaterThanOrEqual(2);
    expect(resultSlide.layoutId).toBeDefined();
    expect(result.layouts?.some((layout) => layout.id === resultSlide.layoutId)).toBe(true);
  });

  it("按角色把图放在引擎算出的图位上", () => {
    const source = pageWithBody();
    const slideId = source.slides[0]!.id;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-image",
        slideId,
        dataUrl,
        mimeType: "image/png",
        altText: "配图",
        naturalWidth: 1024,
        naturalHeight: 768,
        role: "hero",
      }),
    );
    const image = result.slides[0]!.elements.find((element) => element.type === "image")!;
    // 主视觉在右半页，不是页面中间那块空地。
    expect(image.frame.x).toBeGreaterThan(source.pageSize.width * 0.45);
  });

  it("给图腾地方时只动正文的几何，一个字都不改", () => {
    const source = pageWithBody();
    const slideId = source.slides[0]!.id;
    const contentBefore = JSON.stringify(source.slides[0]!.content);
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-image",
        slideId,
        dataUrl,
        mimeType: "image/png",
        altText: "配图",
        naturalWidth: 1024,
        naturalHeight: 768,
        role: "hero",
      }),
    );
    const image = result.slides[0]!.elements.find((element) => element.type === "image")!;
    const body = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.contentRef === "body",
    )!;
    expect(body.frame.x + body.frame.width).toBeLessThanOrEqual(image.frame.x);
    expect(body.text).toBe("正文内容");
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
  });

  it("通栏图把正文推到图的下方", () => {
    const source = pageWithBody();
    const slideId = source.slides[0]!.id;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-image",
        slideId,
        dataUrl,
        mimeType: "image/png",
        altText: "配图",
        naturalWidth: 2048,
        naturalHeight: 512,
        role: "band",
      }),
    );
    const image = result.slides[0]!.elements.find((element) => element.type === "image")!;
    const body = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.contentRef === "body",
    )!;
    expect(body.frame.y).toBeGreaterThan(image.frame.y + image.frame.height);
  });

  it("锁定的正文不因为配图被挪动", () => {
    const source = pageWithBody();
    const slideId = source.slides[0]!.id;
    const body = source.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.contentRef === "body",
    )!;
    body.locked = true;
    const before = body.frame.width;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-image",
        slideId,
        dataUrl,
        mimeType: "image/png",
        altText: "配图",
        naturalWidth: 1024,
        naturalHeight: 768,
        role: "hero",
      }),
    );
    const after = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.contentRef === "body",
    )!;
    expect(after.frame.width).toBe(before);
  });

  it("拒绝不认识的角色", () => {
    const source = pageWithBody();
    const slideId = source.slides[0]!.id;
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "add-image",
          slideId,
          dataUrl,
          mimeType: "image/png",
          altText: "配图",
          role: "giant" as never,
        }),
      ),
    ).toThrow("INVALID_VISUAL_ASSET_ROLE");
  });

  it("不带角色时沿用原来的插图位置", () => {
    const source = pageWithBody();
    const slideId = source.slides[0]!.id;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-image",
        slideId,
        dataUrl,
        mimeType: "image/png",
        altText: "配图",
        naturalWidth: 1024,
        naturalHeight: 768,
      }),
    );
    const image = result.slides[0]!.elements.find((element) => element.type === "image")!;
    expect(image.frame.x).toBe(inches(2));
    const body = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.contentRef === "body",
    )!;
    expect(body.frame.width).toBe(inches(11.7));
  });

  it("grows a short cover title and keeps a long one at the display size", () => {
    const coverSize = (title: string) => {
      const source = createDocument();
      const design = {
        layout: "cover" as const,
        background: "#FBFAF7",
        accent: "#2F6B5F",
        titleColor: "#1E2A32",
        bodyColor: "#333333",
      };
      const result = produce(source, (draft) =>
        applyCommand(draft, {
          type: "apply-ai-designed-draft",
          title: "封面",
          slides: [{ title, body: "", speakerNotes: "" }],
          designs: [design],
        }),
      );
      const element = result.slides[0]!.elements.find(
        (candidate): candidate is TextElement => candidate.type === "text" && candidate.text === title,
      )!;
      return element.style.fontSizePt;
    };
    expect(coverSize("岳阳楼记")).toBe(63);
    expect(coverSize("从洞庭湖到岳阳楼：一篇记文的地理与心事")).toBe(42);
  });

  it("uses an icon for a point that names something the icon set can draw", () => {
    const source = createDocument();
    const content = {
      title: "四条路径",
      body: "",
      speakerNotes: "",
      blocks: [
        {
          type: "bullet-list" as const,
          items: ["目标：提升覆盖率", "数据：增长 32%", "知人论世：生平与时代", "贯通整合：形成能力"],
        },
      ],
    };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#2F6B5F",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "图标", slides: [content], designs: [design] }),
    );
    const icons = result.slides[0]!.elements.filter((element) => element.type === "icon");
    expect(icons.map((element) => (element.type === "icon" ? element.name : ""))).toEqual(["target", "chart"]);
    const numbers = result.slides[0]!.elements.filter(
      (element) => element.type === "text" && /^\d{2}$/.test(element.text),
    );
    const numberTexts = numbers.map((element) => (element.type === "text" ? element.text : ""));
    expect(numberTexts).toContain("03");
    expect(numberTexts).toContain("04");
    expect(numberTexts).not.toContain("02");
  });

  it("inserts a built-in icon with the user as its origin", () => {
    const source = createDocument();
    const slideId = source.slides[0]!.id;
    const result = produce(source, (draft) => applyCommand(draft, { type: "add-icon", slideId, name: "target" }));
    const icon = result.slides[0]!.elements.at(-1)!;
    expect(icon.type).toBe("icon");
    if (icon.type !== "icon") throw new Error("expected an icon");
    expect(icon.name).toBe("target");
    expect(icon.origin).toBe("user");
    expect(icon.frame.width).toBe(inches(1));
  });

  it("updates the style and the name of an icon and refuses a text element", () => {
    const source = createDocument();
    const slideId = source.slides[0]!.id;
    const withIcon = produce(source, (draft) => applyCommand(draft, { type: "add-icon", slideId, name: "book" }));
    const iconId = withIcon.slides[0]!.elements.at(-1)!.id;

    const restyled = produce(withIcon, (draft) =>
      applyCommand(draft, {
        type: "set-icon-style",
        slideId,
        elementId: iconId,
        style: { color: "#112233", strokeWidth: 3 },
      }),
    );
    const icon = restyled.slides[0]!.elements.at(-1)!;
    if (icon.type !== "icon") throw new Error("expected an icon");
    expect(icon.style.color).toBe("#112233");
    expect(icon.style.strokeWidth).toBe(3);

    const renamed = produce(restyled, (draft) =>
      applyCommand(draft, { type: "set-icon-name", slideId, elementId: iconId, name: "water" }),
    );
    const renamedIcon = renamed.slides[0]!.elements.at(-1)!;
    expect(renamedIcon.type === "icon" ? renamedIcon.name : undefined).toBe("water");

    const textId = source.slides[0]!.elements[0]!.id;
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, { type: "set-icon-style", slideId, elementId: textId, style: { color: "#112233" } }),
      ),
    ).toThrow("ELEMENT_NOT_ICON");
  });
});
