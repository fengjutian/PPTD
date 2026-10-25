import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand } from "./commands";

import { createDocument, type TextElement } from "../document-model";

import { contrastRatio, contrastRatioAgainstLuminance } from "../rendering/contrast";
import { estimateTextLines } from "../rendering/text-fit";

describe("commands 4", () => {
  it("keeps the template's white cover ink when a preset is applied", () => {
    const source = createDocument();
    const content = { title: "封面标题", body: "副标题", speakerNotes: "" };
    const design = {
      layout: "cover" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateTheme = {
      name: "模板",
      majorFont: "微软雅黑",
      minorFont: "微软雅黑",
      colors: [],
    };
    const templateLayouts = [
      {
        index: 0,
        name: "封面",
        backgroundImageDataUrl: "data:image/png;base64,AAAA",
        regions: [
          {
            role: "title" as const,
            frame: { x: 0.084, y: 0.34, width: 0.832, height: 0.167 },
            textColor: "#FFFFFF",
            fontSizePt: 66,
          },
          {
            role: "body" as const,
            frame: { x: 0.125, y: 0.589, width: 0.75, height: 0.167 },
            textColor: "#FFFFFF",
            fontSizePt: 28,
          },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "封面",
        slides: [content],
        designs: [design],
        templateTheme,
        templateLayouts,
        themePresetId: "warm-paper",
      }),
    );
    const texts = result.slides[0]!.elements.filter((element): element is TextElement => element.type === "text");
    const title = texts.find((element) => element.text === content.title)!;
    const body = texts.find((element) => element.text === content.body)!;
    // The template set white ink on a dark cover. Applying a preset must not
    // flip that ink to the preset's dark primary because the page colour is
    // white while the artwork is not sampled.
    expect(title.style.color).toBe("#FFFFFF");
    expect(body.style.color).toBe("#FFFFFF");
  });

  it("paints a local scrim with the page colour instead of the design background", () => {
    const source = createDocument();
    const content = { title: "页", body: "正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#1A1A1A",
      accent: "#0F7869",
      titleColor: "#FFFFFF",
      bodyColor: "#DCE3EA",
      backgroundTreatment: "local-scrim" as const,
    };
    const layout = {
      index: 0,
      name: "内页",
      backgroundColor: "#FFFFFF",
      backgroundImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      regions: [
        { role: "title" as const, frame: { x: 0.07, y: 0.08, width: 0.86, height: 0.1 } },
        { role: "body" as const, frame: { x: 0.07, y: 0.22, width: 0.86, height: 0.6 } },
      ],
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "页",
        slides: [content],
        designs: [design],
        templateLayouts: [layout],
      }),
    );
    const large = result.slides[0]!.elements.filter(
      (element) =>
        element.type === "shape" &&
        element.frame.width > result.pageSize.width * 0.4 &&
        element.frame.height > result.pageSize.height * 0.3,
    );
    expect(large.some((element) => element.type === "shape" && element.style.fill === "#1A1A1A")).toBe(false);
  });

  it("keeps the footer readable over artwork whose probe is dark", () => {
    const source = createDocument();
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const layout = {
      index: 0,
      name: "内页",
      backgroundColor: "#FFFFFF",
      backgroundImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      backgroundLuminance: { title: { darkest: 0.02, lightest: 0.12 }, body: { darkest: 0.02, lightest: 0.12 } },
      regions: [
        { role: "title" as const, frame: { x: 0.07, y: 0.08, width: 0.86, height: 0.1 } },
        { role: "body" as const, frame: { x: 0.07, y: 0.22, width: 0.86, height: 0.6 } },
      ],
    };
    const pages = [
      { title: "第一页", body: "正文", speakerNotes: "" },
      { title: "第二页", body: "正文", speakerNotes: "" },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "课件",
        slides: pages,
        designs: [design, design],
        templateLayouts: [layout],
      }),
    );
    const footer = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === "01 / 02",
    )!;
    expect(contrastRatio(footer.style.color, "#FFFFFF")!).toBeGreaterThanOrEqual(4.5);
  });

  it("draws split columns as cards instead of bare text", () => {
    const source = createDocument();
    const items = [
      "滕子京因事被贬，出任岳州巴陵郡地方官",
      "到任后主持重修岳阳楼，使旧迹重光",
      "滕子京以书信形式嘱托范仲淹为新楼作记，并附上洞庭湖的图景与修建始末，请他以文字记下这件事并寄托自己的政治理想与人生感慨",
      "范仲淹应嘱作文，遂成《岳阳楼记》",
    ];
    const content = { title: "写作缘起", body: items.join("\n"), speakerNotes: "" };
    const design = {
      layout: "split" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "分层", slides: [content], designs: [design] }),
    );
    const cards = result.slides[0]!.elements.filter(
      (element) => element.type === "shape" && element.style.fill === "#F3F5F7",
    );
    expect(cards).toHaveLength(2);
  });

  it("numbers the pages of a generated deck but not a one-page draft or a cover", () => {
    const source = createDocument();
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const pages = [
      { title: "第一页", body: "第一页正文", speakerNotes: "" },
      { title: "第二页", body: "第二页正文", speakerNotes: "" },
    ];
    const deck = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "岳阳楼记",
        slides: pages,
        designs: [design, design],
      }),
    );
    const textsOf = (index: number) =>
      deck.slides[index]!.elements.filter((element) => element.type === "text").map((element) => element.text);
    expect(textsOf(0)).toContain("01 / 02");
    expect(textsOf(1)).toContain("02 / 02");
    expect(textsOf(0)).toContain("岳阳楼记");

    const single = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "单页", slides: [pages[0]!], designs: [design] }),
    );
    expect(single.slides[0]!.elements.some((element) => element.type === "text" && element.text === "01 / 01")).toBe(
      false,
    );

    const cover = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "封面",
        slides: pages,
        designs: [{ ...design, layout: "cover" as const }, design],
      }),
    );
    expect(cover.slides[0]!.elements.some((element) => element.type === "text" && element.text === "01 / 02")).toBe(
      false,
    );
  });

  it("names the section the page belongs to in the footer", () => {
    const source = createDocument();
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const pages = [
      { title: "第一部分 洞庭湖", body: "", speakerNotes: "" },
      { title: "岳阳楼记", body: "正文", speakerNotes: "" },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "教学课件",
        slides: pages,
        designs: [{ ...design, layout: "section" as const }, design],
      }),
    );
    const footer = result.slides[1]!.elements.flatMap((element) =>
      element.type === "text" && element.frame.y > result.pageSize.height * 0.9 ? [element.text] : [],
    );
    expect(footer).toEqual(["第一部分 洞庭湖", "02 / 02"]);
  });

  it("leaves the page number to a template that already prints one", () => {
    const source = createDocument();
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const pages = [
      { title: "第一页", body: "第一页正文", speakerNotes: "" },
      { title: "第二页", body: "第二页正文", speakerNotes: "" },
    ];
    const layout = {
      index: 0,
      name: "内页",
      backgroundColor: "#FFFFFF",
      regions: [
        { role: "title" as const, frame: { x: 0.07, y: 0.08, width: 0.86, height: 0.1 } },
        { role: "body" as const, frame: { x: 0.07, y: 0.22, width: 0.86, height: 0.6 } },
        { role: "body" as const, frame: { x: 0.86, y: 0.93, width: 0.08, height: 0.035 } },
      ],
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "模板页脚",
        slides: pages,
        designs: [design, design],
        templateLayouts: [layout],
      }),
    );
    expect(result.slides[0]!.elements.some((element) => element.type === "text" && element.text === "01 / 02")).toBe(
      false,
    );
  });

  it("drops a small ornament that runs across the title and keeps a panel that carries the page", () => {
    const source = createDocument();
    const content = { title: "岳阳楼记", body: "正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const decorations = [
      { shape: "rectangle" as const, fill: "#FF00AA", frame: { x: 0.06, y: 0.12, width: 0.03, height: 0.05 } },
      { shape: "rectangle" as const, fill: "#EEF2F6", frame: { x: 0, y: 0, width: 0.12, height: 1 } },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "装饰",
        slides: [content],
        designs: [design],
        templateDecorations: decorations,
      }),
    );
    const fills = result.slides[0]!.elements.filter((element) => element.type === "shape").map(
      (element) => element.style.fill,
    );
    expect(fills).not.toContain("#FF00AA");
    expect(fills).toContain("#EEF2F6");
  });

  it("keeps the rail numeral and the pull quote above running copy", () => {
    const source = createDocument();
    const items = [
      "总写洞庭湖全景",
      "'衔远山，吞长江，浩浩汤汤'",
      "描写气象万千的景色",
      "过渡到登楼览物之情",
      "'前人之述备矣'",
    ];
    const content = {
      title: "原文赏析",
      body: items.join("\n"),
      speakerNotes: "",
      blocks: [
        { type: "quote" as const, text: "先天下之忧而忧，后天下之乐而乐" },
        { type: "bullet-list" as const, items },
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
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "岳阳楼记", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    const number = texts.find((element) => element.text === "01");
    const point = texts.find((element) => element.text === items[0]);
    expect(number?.style.fontSizePt).toBeGreaterThanOrEqual((point?.style.fontSizePt ?? 0) * 1.15);
    const quote = texts.find((element) => element.text.includes("先天下"));
    expect(quote?.style.fontSizePt).toBeGreaterThanOrEqual(18);
  });

  it("keeps every reviewed step of a timeline and of a process", () => {
    const source = createDocument();
    const steps = Array.from({ length: 8 }, (_, index) => ({ label: `阶段${index + 1}`, text: `说明${index + 1}` }));
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const timeline = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "时间线",
        slides: [
          { title: "里程碑", body: "", speakerNotes: "", blocks: [{ type: "timeline" as const, items: steps }] },
        ],
        designs: [design],
      }),
    );
    const timelineCopy = timeline.slides[0]!.elements.filter((element) => element.type === "text")
      .map((element) => element.text)
      .join("\n");
    for (const step of steps) {
      expect(timelineCopy).toContain(step.label);
      expect(timelineCopy).toContain(step.text);
    }

    const process = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "流程",
        slides: [
          { title: "实施流程", body: "", speakerNotes: "", blocks: [{ type: "process" as const, items: steps }] },
        ],
        designs: [design],
      }),
    );
    const processCopy = process.slides[0]!.elements.filter((element) => element.type === "text")
      .map((element) => element.text)
      .join("\n");
    for (const step of steps) {
      expect(processCopy).toContain(step.label);
      expect(processCopy).toContain(step.text);
    }
  });

  it("keeps every reviewed metric of a page", () => {
    const source = createDocument();
    const units = ["%", "万", "人", "单", "天", "次", "项"];
    const metrics = Array.from({ length: 7 }, (_, index) => ({
      type: "metric" as const,
      label: `指标${index + 1}`,
      value: `${index + 1}${units[index]}`,
    }));
    const content = { title: "核心指标", body: "指标说明", speakerNotes: "", blocks: metrics };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "指标", slides: [content], designs: [design] }),
    );
    const copy = result.slides[0]!.elements.filter((element) => element.type === "text")
      .map((element) => element.text)
      .join("\n");
    for (const metric of metrics) {
      expect(copy).toContain(metric.label);
      expect(copy).toContain(metric.value);
    }
  });

  it("keeps every reviewed metric of a page that is drawn as a chart", () => {
    const source = createDocument();
    const metrics = Array.from({ length: 7 }, (_, index) => ({
      type: "metric" as const,
      label: `指标${index + 1}`,
      value: `${index + 1}%`,
    }));
    const content = { title: "核心指标", body: "", speakerNotes: "", blocks: metrics };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "指标", slides: [content], designs: [design] }),
    );
    const chart = result.slides[0]!.elements.find((element) => element.type === "chart");
    const blocks = result.slides[0]!.content.blocks ?? [];
    expect(chart?.type === "chart" && chart.contentBlockIds).toEqual(
      blocks.filter((block) => block.type === "metric").map((block) => block.id),
    );
  });

  it("renders metric blocks as value-first cards", () => {
    const source = createDocument();
    const content = {
      title: "核心指标",
      body: "指标说明",
      speakerNotes: "",
      blocks: [
        { type: "metric" as const, label: "增长率", value: "42%" },
        { type: "metric" as const, label: "客户数", value: "120" },
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
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "指标", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map(
      (element) => element.text,
    );
    expect(texts).toEqual(["核心指标", "42%", "增长率", "120", "客户数"]);
  });

  it("links each stat card to the reviewed metric it draws", () => {
    const source = createDocument();
    const content = {
      title: "核心指标",
      body: "指标说明",
      speakerNotes: "",
      blocks: [
        { type: "metric" as const, label: "增长率", value: "42%" },
        { type: "metric" as const, label: "客户数", value: "120" },
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
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "指标", slides: [content], designs: [design] }),
    );
    const slide = result.slides[0]!;
    const metricIds = slide.content.blocks?.filter((block) => block.type === "metric").map((block) => block.id) ?? [];
    const linked = slide.elements.filter(
      (element): element is TextElement => element.type === "text" && Boolean(element.contentBlockRef),
    );
    // Without the link the card is just two strings and editing it would leave
    // the reviewed number behind.
    expect(linked).toHaveLength(4);
    expect(linked.map((element) => element.contentBlockRef!.blockId)).toEqual([
      metricIds[0],
      metricIds[0],
      metricIds[1],
      metricIds[1],
    ]);
    expect(linked.map((element) => element.contentBlockRef!.field)).toEqual(["value", "label", "value", "label"]);
    expect(linked.map((element) => element.text)).toEqual(["42%", "增长率", "120", "客户数"]);
  });

  it("renders process blocks as numbered native-object steps", () => {
    const source = createDocument();
    const content = {
      title: "实施流程",
      body: "审核正文",
      speakerNotes: "",
      blocks: [
        {
          type: "process" as const,
          items: [
            { label: "分析", text: "确认目标" },
            { label: "执行", text: "完成交付" },
          ],
        },
      ],
    };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "流程", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map(
      (element) => element.text,
    );
    expect(texts).toEqual(["实施流程", "1", "分析", "确认目标", "2", "执行", "完成交付"]);
    expect(result.slides[0]!.elements.every((element) => element.type === "text" || element.type === "shape")).toBe(
      true,
    );
  });

  it("does not silently drop points when a cards layout receives more than six", () => {
    const source = createDocument();
    const body = Array.from({ length: 7 }, (_, index) => `${index + 1}. 第${index + 1}个要点`).join("\n");
    const content = { title: "七个要点", body, speakerNotes: "" };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "七个要点", slides: [content], designs: [design] }),
    );
    const copy = result.slides[0]!.elements.filter(
      (element): element is Extract<typeof element, { type: "text" }> => element.type === "text",
    )
      .map((element) => element.text)
      .join("\n");
    for (let index = 1; index <= 7; index += 1) expect(copy).toContain(`第${index}个要点`);
    expect(result.slides[0]!.content.body).toBe(body);
  });

  it("sets the two columns on one baseline with a hanging indent per point", () => {
    const source = createDocument();
    const items = [
      "近年多次进行组织架构调整，AI相关业务被独立或前置",
      "高管汇报关系与考核权重明显向智能云、大模型、自动驾驶倾斜",
      "销售与商业化资源在内部预算分配中逐步让位于AI基础设施建设",
      "人员招聘与人才激励的重点明显向AI研发岗位集中",
      "组织层面的优先级重排是判断战略转型真实性的关键信号",
    ];
    const content = { title: "组织架构调整", body: items.join("\n"), speakerNotes: "" };
    const design = {
      layout: "split" as const,
      composition: "columns" as const,
      background: "#FFFFFF",
      accent: "#B08A2E",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "组织", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element): element is TextElement => element.type === "text");
    const markers = texts.filter((element) => element.text === "•");
    const copies = texts.filter((element) => element.text !== content.title && element.text !== "•");
    expect(markers).toHaveLength(items.length);
    expect(copies).toHaveLength(items.length);
    // A card body is read, not shouted: the old 26pt ceiling read as a poster.
    expect(copies.every((element) => element.style.fontSizePt <= 20)).toBe(true);
    expect(markers.every((element) => element.style.fontSizePt <= 14)).toBe(true);
    // A 30+ character title at 40pt turns into three lines and eats the page.
    const heading = texts.find((element) => element.text === content.title)!;
    expect(heading.style.fontSizePt).toBeLessThanOrEqual(30);
    // The lead clause is bold, the predicate stays regular: hierarchy inside a
    // card without rewriting the reviewed sentence. Points without a natural
    // subject/predicate split keep one uniform run.
    const emphasized = copies.filter((element) => element.runs?.[0]?.start === 0);
    expect(emphasized.length).toBeGreaterThan(0);
    expect(emphasized.every((element) => (element.runs?.[0]?.end ?? 0) < element.text.length)).toBe(true);
    // The cut is chosen to balance the two columns by height, so both columns
    // carry points and their first rows sit on one baseline.
    const columns = [
      copies.filter((element) => element.frame.x + element.frame.width / 2 < source.pageSize.width / 2),
      copies.filter((element) => element.frame.x + element.frame.width / 2 >= source.pageSize.width / 2),
    ];
    expect(columns[0]!.length).toBeGreaterThan(0);
    expect(columns[1]!.length).toBeGreaterThan(0);
    expect(columns[0]![0]!.frame.y).toBe(columns[1]![0]!.frame.y);
    // 悬挂缩进：文字从标记右侧开始，换行后不会再退回标记下面。
    expect(columns[0]![0]!.frame.x).toBeGreaterThan(markers[0]!.frame.x);
    // 行距均匀：相邻两行的间距不因原来的空行而翻倍。
    const longest = columns[0]!.length >= columns[1]!.length ? columns[0]! : columns[1]!;
    expect(longest.length).toBeGreaterThanOrEqual(3);
    const firstGap = longest[1]!.frame.y - (longest[0]!.frame.y + longest[0]!.frame.height);
    const secondGap = longest[2]!.frame.y - (longest[1]!.frame.y + longest[1]!.frame.height);
    expect(firstGap).toBeGreaterThan(0);
    expect(Math.abs(firstGap - secondGap)).toBeLessThanOrEqual(2000);
    // 中缝不再立一根比卡片还高的装饰线。
    const divider = result.slides[0]!.elements.find(
      (element) =>
        element.type === "shape" &&
        element.frame.width < source.pageSize.width * 0.02 &&
        element.frame.height > source.pageSize.height * 0.4 &&
        element.frame.x > source.pageSize.width * 0.45 &&
        element.frame.x < source.pageSize.width * 0.55,
    );
    expect(divider).toBeUndefined();
  });

  it("keeps an explicitly requested split layout instead of forcing numbered text into cards", () => {
    const source = createDocument();
    const longItem =
      "这是一个用于验证中文文本框宽度估算和自动字号适配的较长段落，不能越过双栏边界覆盖另一列内容，并需要保留完整上下文";
    const content = {
      title: "排版检查",
      body: `1. ${longItem}\n2. ${longItem}\n3. ${longItem}\n4. ${longItem}`,
      speakerNotes: "",
    };
    const design = {
      layout: "split" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "自动适配", slides: [content], designs: [design] }),
    );
    const bodies = result.slides[0]!.elements.filter(
      (element): element is Extract<typeof element, { type: "text" }> =>
        element.type === "text" &&
        element.text !== content.title &&
        element.text !== "•" &&
        !/^\d+$/.test(element.text),
    );
    // Two columns, four points: every point is its own text frame so a wrapped
    // point keeps its hanging indent instead of running back under the marker.
    expect(bodies).toHaveLength(4);
    // The copy may grow into the room the column has, but never to display size.
    expect(bodies.every((element) => element.style.fontSizePt <= 26 && element.style.fontSizePt >= 12)).toBe(true);
    for (const [bodyIndex, body] of bodies.entries()) {
      expect(
        bodies
          .slice(bodyIndex + 1)
          .every(
            (candidate) =>
              body.frame.x + body.frame.width <= candidate.frame.x ||
              candidate.frame.x + candidate.frame.width <= body.frame.x ||
              body.frame.y + body.frame.height <= candidate.frame.y ||
              candidate.frame.y + candidate.frame.height <= body.frame.y,
          ),
      ).toBe(true);
    }
  });

  it("centers an incomplete final card row on the shared alignment grid", () => {
    const source = createDocument();
    const content = {
      title: "五项重点",
      body: "1. 第一项\n2. 第二项\n3. 第三项\n4. 第四项\n5. 第五项",
      speakerNotes: "",
    };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "视觉对齐", slides: [content], designs: [design] }),
    );
    const labels = result.slides[0]!.elements.filter(
      (element): element is Extract<typeof element, { type: "text" }> =>
        element.type === "text" && /^第[一二三四五]项$/.test(element.text),
    );
    expect(labels).toHaveLength(5);
    expect(labels[3]!.frame.x).toBeGreaterThan(labels[0]!.frame.x);
    expect(labels[4]!.frame.x + labels[4]!.frame.width).toBeLessThan(labels[2]!.frame.x + labels[2]!.frame.width);
    expect(labels[3]!.frame.y).toBe(labels[4]!.frame.y);
  });

  it("places editable content inside a vision-recommended safe region", () => {
    const source = createDocument();
    const content = { title: "避开模板标志", body: "正文位于视觉模型识别的留白区域", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#234567",
      accent: "#22AA99",
      titleColor: "#FFFFFF",
      bodyColor: "#FFFFFF",
      safeRegion: { x: 0.28, y: 0.18, width: 0.64, height: 0.68 },
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "安全区", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    expect(texts[0]!.frame.x).toBe(Math.round(source.pageSize.width * design.safeRegion.x));
    expect(texts.every((element) => element.frame.x >= Math.round(source.pageSize.width * design.safeRegion.x))).toBe(
      true,
    );
    expect(
      texts.every(
        (element) =>
          element.frame.x + element.frame.width <=
          Math.round(source.pageSize.width * (design.safeRegion.x + design.safeRegion.width)) + 1,
      ),
    ).toBe(true);
  });

  it("places editable text on the placeholder geometry of the rendered template layout", () => {
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
        backgroundImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        regions: [
          { role: "title" as const, frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 } },
          { role: "body" as const, frame: { x: 0.052, y: 0.119, width: 0.423, height: 0.046 } },
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
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    const body = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === content.body,
    )!;
    expect(title.frame).toEqual({
      x: Math.round(source.pageSize.width * 0.052),
      y: Math.round(source.pageSize.height * 0.03),
      width: Math.round(source.pageSize.width * 0.799),
      height: Math.round(source.pageSize.height * 0.059),
    });
    // The largest body region carries the copy, not the short subtitle placeholder.
    expect(body.frame).toEqual({
      x: Math.round(source.pageSize.width * 0.052),
      y: Math.round(source.pageSize.height * 0.222),
      width: Math.round(source.pageSize.width * 0.897),
      height: Math.round(source.pageSize.height * 0.621),
    });
  });

  it("keeps the template artwork visible instead of covering the page with a panel", () => {
    const source = createDocument();
    const content = { title: "对比度修复", body: "正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
      backgroundTreatment: "local-scrim" as const,
    };
    const templateLayouts = [
      {
        index: 11,
        name: "内页（浅色）1",
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
      }),
    );
    const shapes = result.slides[0]!.elements.filter((element) => element.type === "shape");
    expect(shapes.length).toBeGreaterThan(0);
    // The scrim hugs the text block; it must never become a full page sheet.
    expect(
      shapes.every(
        (shape) =>
          shape.frame.width < source.pageSize.width * 0.98 && shape.frame.height < source.pageSize.height * 0.98,
      ),
    ).toBe(true);
    expect(result.slides[0]!.elements[0]).toMatchObject({ type: "image" });
  });

  it("uses the ink and the size the template assigned to its placeholders", () => {
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
        regions: [
          {
            role: "title" as const,
            frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 },
            textColor: "#273D79",
            fontSizePt: 26,
          },
          {
            role: "body" as const,
            frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 },
            textColor: "#999A9A",
            fontSizePt: 18,
          },
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
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    const body = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === content.body,
    )!;
    expect(title.type === "text" && title.style.color).toBe("#273D79");
    expect(title.type === "text" && title.style.fontSizePt).toBe(26);
    expect(body.type === "text" && body.style.fontSizePt).toBe(18);
    // The template body grey is too light to read, so the ink is corrected while
    // the template's own size and geometry stay in place.
    expect(body.type === "text" && body.style.color).not.toBe("#999A9A");
    expect(body.type === "text" && contrastRatio(body.style.color, "#FFFFFF")!).toBeGreaterThanOrEqual(4.5);
  });

  it("repairs text that would be unreadable on the page it is placed on", () => {
    const source = createDocument();
    const content = { title: "浅底白字", body: "正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#FFFFFF",
      bodyColor: "#FFFFFF",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "对比度", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    expect(
      texts.every((element) => element.type === "text" && contrastRatio(element.style.color, "#FFFFFF")! >= 4.5),
    ).toBe(true);
    // The title keeps more weight than the body so the page keeps a hierarchy.
    expect(texts[0]!.type === "text" && texts[0]!.style.color).not.toBe(
      texts[1]!.type === "text" && texts[1]!.style.color,
    );
  });

  it("rotates the template artwork across pages instead of repeating one layout", () => {
    const source = createDocument();
    const slides = [
      { title: "第一页", body: "正文一", speakerNotes: "" },
      { title: "第二页", body: "正文二", speakerNotes: "" },
      { title: "第三页", body: "正文三", speakerNotes: "" },
    ];
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const regionSet = [
      { role: "title" as const, frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 } },
      { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 } },
    ];
    const templateLayouts = [
      { index: 11, name: "内页（浅色）1", backgroundImageDataUrl: "data:image/png;base64,AAAA", regions: regionSet },
      { index: 13, name: "内页（浅色）3", backgroundImageDataUrl: "data:image/png;base64,BBBB", regions: regionSet },
      { index: 14, name: "内页（深色）1", backgroundImageDataUrl: "data:image/png;base64,CCCC", regions: regionSet },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "多版式",
        slides,
        designs: [design, design, design],
        templateLayouts,
      }),
    );
    const backgrounds = result.slides.map((slide) => slide.elements.find((element) => element.type === "image"));
    expect(backgrounds.map((element) => (element?.type === "image" ? element.source.dataUrl : undefined))).toEqual([
      templateLayouts[0]!.backgroundImageDataUrl,
      templateLayouts[1]!.backgroundImageDataUrl,
      templateLayouts[2]!.backgroundImageDataUrl,
    ]);
  });

  it("keeps a CJK headline on one line inside the template title box", () => {
    const source = createDocument();
    const content = { title: "昆佰泰基因测序整体解决方案", body: "副标题", speakerNotes: "" };
    const design = {
      layout: "cover" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#FFFFFF",
      bodyColor: "#FFFFFF",
    };
    const templateLayouts = [
      {
        index: 1,
        name: "封面1",
        backgroundImageDataUrl: "data:image/png;base64,AAAA",
        regions: [
          {
            role: "title" as const,
            frame: { x: 0.084, y: 0.34, width: 0.832, height: 0.167 },
            textColor: "#FFFFFF",
            fontSizePt: 66,
          },
          {
            role: "body" as const,
            frame: { x: 0.125, y: 0.589, width: 0.75, height: 0.167 },
            textColor: "#FFFFFF",
            fontSizePt: 28,
          },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "标题",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    const widthPt = title.frame.width / 12_700;
    // A CJK glyph fills a full em, so thirteen characters need thirteen times
    // the font size. Measuring them narrower let the line wrap and pushed the
    // second line into the artwork below the headline.
    expect(title.type === "text" && title.style.fontSizePt * content.title.length).toBeLessThanOrEqual(widthPt);
    expect(estimateTextLines(content.title, widthPt, title.type === "text" ? title.style.fontSizePt : 0)).toBe(1);
  });

  it("keeps the ink readable across every patch of artwork that carries it", () => {
    const source = createDocument();
    const content = { title: "深色版式", body: "正文内容", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateLayouts = [
      {
        index: 14,
        name: "内页（深色）1",
        backgroundImageDataUrl: "data:image/png;base64,AAAA",
        backgroundLuminance: {
          title: { darkest: 0.3947, lightest: 0.5795 },
          body: { darkest: 0.3993, lightest: 0.612 },
        },
        regions: [
          {
            role: "title" as const,
            frame: { x: 0.052, y: 0.03, width: 0.806, height: 0.059 },
            textColor: "#FFFFFF",
            fontSizePt: 26,
          },
          {
            role: "body" as const,
            frame: { x: 0.052, y: 0.225, width: 0.897, height: 0.621 },
            textColor: "#FFFFFF",
            fontSizePt: 18,
          },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "标题",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    const range = templateLayouts[0]!.backgroundLuminance!.title!;
    // The template asks for white, which cannot carry the text on that teal
    // artwork. The ink has to hold on the darkest and on the lightest patch.
    expect(texts.every((element) => element.type === "text" && element.style.color !== "#FFFFFF")).toBe(true);
    expect(
      texts.every(
        (element) => element.type === "text" && contrastRatioAgainstLuminance(element.style.color, range.darkest)! >= 3,
      ),
    ).toBe(true);
  });

  it("lets a design override the ink the template assigned to its placeholders", () => {
    const source = createDocument();
    const content = { title: "覆盖墨色", body: "正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#101010",
      bodyColor: "#202020",
      inkOverride: true,
    };
    const templateLayouts = [
      {
        index: 11,
        name: "内页（浅色）1",
        backgroundImageDataUrl: "data:image/png;base64,AAAA",
        regions: [
          {
            role: "title" as const,
            frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 },
            textColor: "#273D79",
            fontSizePt: 26,
          },
          {
            role: "body" as const,
            frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 },
            textColor: "#999A9A",
            fontSizePt: 18,
          },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "标题",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    // Without the override the template ink wins, so a repair could never
    // change the colour of a template page.
    expect(title.type === "text" && title.style.color).toBe("#101010");
  });
});
