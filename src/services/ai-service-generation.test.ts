import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  aiDraftSchema,
  briefsFromDraft,
  cancelAiGeneration,
  describeAiError,
  designTemplateForPrompt,
  extractSourceFacts,
  generatePresentationDraft,
  generatePresentationDesign,
  mergeStreamProgress,
  polishPresentationTopic,
  reviewDeckContent,
  rewritePresentationSlide,
  splitSlideContent,
  suggestImagePrompts,
  suggestSlideTitles,
  writeSpeakerNotes,
  type AiGenerationProgress,
} from "./ai-service";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

it("adds explicit layout capabilities before template data is sent to AI", () => {
  const template = designTemplateForPrompt({
    slideWidthEmu: null,
    slideHeightEmu: null,
    themeColors: [],
    majorFont: null,
    minorFont: null,
    defaultBackgroundColor: null,
    slides: [],
    layouts: [
      {
        index: 0,
        name: "双栏图文",
        backgroundColor: null,
        regions: [
          { role: "title", x: 0, y: 0, width: 1, height: 0.1 },
          { role: "body", x: 0, y: 0.2, width: 0.45, height: 0.7 },
          { role: "body", x: 0.55, y: 0.2, width: 0.45, height: 0.7 },
          { role: "image", x: 0.55, y: 0.2, width: 0.45, height: 0.7 },
        ],
      },
    ],
  });
  expect(template.layouts[0]?.capabilities).toEqual({
    hasTitle: true,
    hasBody: true,
    hasImage: true,
    columns: 2,
    free: false,
  });
});

describe("多页草稿的分批编排", () => {
  const outlineFor = (count: number) => ({
    title: "岳阳楼记课件",
    pages: Array.from({ length: count }, (_, index) => ({
      index,
      title: `第 ${index + 1} 页标题`,
      purpose: `承担第 ${index + 1} 个沟通任务`,
    })),
  });
  const batchFor = (startIndex: number, count: number) => ({
    slides: Array.from({ length: count }, (_, offset) => ({
      title: `模型自拟标题 ${startIndex + offset + 1}`,
      body: `第 ${startIndex + offset + 1} 页正文`,
      speakerNotes: "备注",
      plan: { purpose: "页面目的", conclusion: "单一结论", visualIntent: "structured-text", density: "medium" },
      blocks: [{ type: "bullet-list", items: [`要点 ${startIndex + offset + 1}`] }],
    })),
  });

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("先取大纲，再并行分批写正文，最后按大纲顺序合并", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "generate_presentation_outline") return outlineFor(12);
      if (command === "generate_presentation_slides_batch") {
        const request = (args as { request: { startIndex: number; count: number } }).request;
        return batchFor(request.startIndex, request.count);
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const progress: AiGenerationProgress[] = [];
    const draft = await generatePresentationDraft("岳阳楼记", 12, { onProgress: (value) => progress.push(value) });

    expect(draft.slides).toHaveLength(12);
    // 页面标题以已定稿的大纲为准，模型自拟标题不会覆盖大纲。
    expect(draft.slides[0]!.title).toBe("第 1 页标题");
    expect(draft.slides[11]!.title).toBe("第 12 页标题");
    expect(draft.slides[11]!.body).toBe("第 12 页正文");
    expect(draft.slides[3]!.blocks[0]).toMatchObject({ type: "bullet-list" });
    expect(
      vi.mocked(invoke).mock.calls.filter((call) => call[0] === "generate_presentation_slides_batch"),
    ).toHaveLength(3);
    expect(progress.some((item) => item.stage === "outline")).toBe(true);
    expect(progress[progress.length - 1]).toMatchObject({ completed: 3, total: 3 });
  });

  it("按大纲的 index 排序，正文不会配到错误的标题下", async () => {
    const shuffled = outlineFor(7);
    shuffled.pages.reverse();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "generate_presentation_outline") return shuffled;
      if (command === "generate_presentation_slides_batch") {
        const request = (args as { request: { startIndex: number; count: number } }).request;
        return batchFor(request.startIndex, request.count);
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const draft = await generatePresentationDraft("主题", 7);

    expect(draft.slides.map((slide) => slide.title)).toEqual(
      Array.from({ length: 7 }, (_, index) => `第 ${index + 1} 页标题`),
    );
    expect(draft.slides.map((slide) => slide.body)).toEqual(
      Array.from({ length: 7 }, (_, index) => `第 ${index + 1} 页正文`),
    );
  });

  it("报告生成失败的具体阶段和字段，而不是只说格式错误", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "generate_presentation_outline") {
        return {
          title: "销售分析",
          pages: [{ index: 0, title: "销售保持增长" }],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const error = await generatePresentationDraft("销售分析", 10).catch((reason: unknown) => reason);
    expect(describeAiError(error)).toBe("AI 返回的演示大纲未通过校验：pages.0.purpose 缺少必填字段");
  });

  it("页数不多时保持一次请求，不额外调用大纲", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "generate_presentation") {
        return {
          title: "短稿",
          slides: Array.from({ length: 4 }, (_, index) => ({
            title: `第 ${index + 1} 页`,
            body: "正文",
            speakerNotes: "",
          })),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const draft = await generatePresentationDraft("主题", 4);

    expect(draft.slides).toHaveLength(4);
    expect(vi.mocked(invoke).mock.calls.map((call) => call[0])).toEqual(["generate_presentation"]);
  });

  it("用户取消后停止后续分批", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "generate_presentation_outline") return outlineFor(12);
      if (command === "generate_presentation_slides_batch") return batchFor(0, 5);
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(generatePresentationDraft("主题", 12, { isCancelled: () => true })).rejects.toThrow(
      "AI_GENERATION_CANCELLED",
    );
    expect(vi.mocked(invoke).mock.calls.map((call) => call[0])).toEqual(["generate_presentation_outline"]);
  });

  it("把任务号带给后端，取消指令也走同一条通道", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "generate_presentation_outline") return outlineFor(12);
      if (command === "generate_presentation_slides_batch") {
        const request = (args as { request: { startIndex: number; count: number } }).request;
        return batchFor(request.startIndex, request.count);
      }
      if (command === "cancel_ai_generation") return true;
      throw new Error(`unexpected command: ${command}`);
    });

    await generatePresentationDraft("主题", 12, { taskId: 42 });
    const batchCall = vi.mocked(invoke).mock.calls.find((call) => call[0] === "generate_presentation_slides_batch");
    expect(batchCall?.[1]).toMatchObject({ request: { taskId: 42 } });

    // 取消必须打到后端：只停界面等待，模型会继续生成一份没人要的草稿。
    await expect(cancelAiGeneration(42)).resolves.toBe(true);
    expect(vi.mocked(invoke).mock.calls.at(-1)).toEqual(["cancel_ai_generation", { taskId: 42 }]);
  });

  it("开启流式进度，让后端边写边汇报", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "generate_presentation") {
        return {
          title: "短稿",
          slides: Array.from({ length: 4 }, (_, index) => ({
            title: `第 ${index + 1} 页`,
            body: "正文",
            speakerNotes: "",
          })),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await generatePresentationDraft("主题", 4, { taskId: 9 });

    const call = vi.mocked(invoke).mock.calls.find((item) => item[0] === "generate_presentation");
    expect(call?.[1]).toMatchObject({ request: { taskId: 9, streamProgress: true } });
  });

  it("设计阶段同样走流式，界面才能显示已设计几页", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("AI_DESIGN_REQUEST_FAILED: 连接中断"));
    const draft = aiDraftSchema.parse({
      title: "短稿",
      slides: [{ title: "第一页", body: "正文", speakerNotes: "" }],
    });
    const template = {
      slideWidthEmu: null,
      slideHeightEmu: null,
      themeColors: [],
      majorFont: null,
      minorFont: null,
      defaultBackgroundColor: null,
      slides: [],
      layouts: [],
    };

    const concept = {
      id: "editorial-test",
      preset: "editorial" as const,
      name: "编辑测试",
      idea: "测试配方目录",
      typeContrast: "strong" as const,
      imagery: "none" as const,
      rationale: "测试",
      motif: "rules" as const,
      recipes: ["cover-statement", "editorial-index"] as const,
      rhythm: ["statement", "evidence"] as const,
      surface: "rules" as const,
      imageryRoles: ["none"] as const,
    };

    await expect(generatePresentationDesign(draft, briefsFromDraft(draft), template, { concept })).rejects.toThrow(
      "AI_DESIGN_REQUEST_FAILED",
    );

    const call = vi.mocked(invoke).mock.calls.find((item) => item[0] === "generate_presentation_design");
    expect(call?.[1]).toMatchObject({
      request: {
        streamProgress: true,
        recipeCatalog: [
          { id: "cover-statement", requiresImage: false },
          { id: "editorial-index", requiresImage: false },
        ],
      },
    });
  });

  it("有素材时把事实清单带给后端，并挂到草稿上", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "generate_presentation") {
        return {
          title: "百度年报",
          slides: Array.from({ length: 3 }, (_, index) => ({
            title: `第 ${index + 1} 页`,
            body: "正文",
            speakerNotes: "",
          })),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const facts = [
      { id: "F1", statement: "2024 年智能云收入 320 亿元", figure: "320 亿元" },
      { id: "F2", statement: "2024 年在线营销收入 730 亿元" },
    ];

    const draft = await generatePresentationDraft("百度年报", 3, { facts });

    const call = vi.mocked(invoke).mock.calls.find((item) => item[0] === "generate_presentation");
    expect(call?.[1]).toMatchObject({ request: { facts } });
    // 事实跟着草稿走：审核页据此显示每页引用了什么。
    expect(draft.sourceFacts).toEqual(facts);
  });

  it("没有素材时不带事实字段，也不改变草稿", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "generate_presentation") {
        return {
          title: "短稿",
          slides: Array.from({ length: 3 }, (_, index) => ({
            title: `第 ${index + 1} 页`,
            body: "正文",
            speakerNotes: "",
          })),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const draft = await generatePresentationDraft("主题", 3);

    const call = vi.mocked(invoke).mock.calls.find((item) => item[0] === "generate_presentation");
    expect((call?.[1] as { request: Record<string, unknown> }).request.facts).toBeUndefined();
    expect(draft.sourceFacts).toBeUndefined();
  });

  it("抽取素材事实时重新编号并去掉重复条目", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "extract_source_facts") {
        return {
          facts: [
            { id: "F7", statement: "2024 年智能云收入 320 亿元", figure: "320 亿元", period: "2024 年" },
            { statement: "2024 年在线营销收入 730 亿元" },
            { statement: "2024 年在线营销收入 730 亿元" },
          ],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const facts = await extractSourceFacts("百度年报", "素材原文");

    expect(facts.map((fact) => fact.id)).toEqual(["F1", "F2"]);
    expect(facts[0]).toMatchObject({ statement: "2024 年智能云收入 320 亿元", figure: "320 亿元" });
  });

  it("润色主题时只替换输入文字，不启动草稿生成", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "polish_presentation_topic")
        return "为产品团队制作季度复盘，面向管理层说明成果、问题与下一步行动。";
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(polishPresentationTopic("做个季度复盘")).resolves.toContain("季度复盘");
    expect(vi.mocked(invoke).mock.calls.map((call) => call[0])).toEqual(["polish_presentation_topic"]);
  });

  it("单页重写只带这一页的事实，候选版本不写回草稿", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "rewrite_presentation_slide") {
        return {
          slide: {
            body: "模型写的正文",
            speakerNotes: " 先讲结论 ",
            blocks: [{ type: "bullet-list", items: ["搜索广告仍是利润来源", "云业务首次全年盈利"] }],
          },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const suggestion = await rewritePresentationSlide({
      topic: "Alphabet 2023 年报",
      deckTitle: "Alphabet 2023 年报",
      outline: ["封面", "广告基本盘稳固，云与 AI 重塑增长路径", "反垄断裁决与资本开支"],
      slideIndex: 1,
      slide: {
        title: "广告基本盘稳固，云与 AI 重塑增长路径",
        body: "旧正文",
        speakerNotes: "旧备注",
        plan: {
          purpose: "说明两条业务线",
          conclusion: "广告稳、云与 AI 增长",
          visualIntent: "structured-text",
          density: "medium",
        },
        blocks: [{ type: "paragraph", text: "旧正文" }],
      },
      instruction: "更精炼",
      taskId: 7,
    });

    // 块才是渲染器真正画的东西；正文跟着块重算，审核页的计数才不会和画面分叉。
    expect(suggestion.body).toBe("搜索广告仍是利润来源\n云业务首次全年盈利");
    expect(suggestion.speakerNotes).toBe("先讲结论");
    expect(suggestion.blocks).toHaveLength(1);
    const request = vi.mocked(invoke).mock.calls.find((call) => call[0] === "rewrite_presentation_slide")?.[1] as {
      request: Record<string, unknown>;
    };
    expect(request.request).toMatchObject({ slideIndex: 1, instruction: "更精炼", taskId: 7 });
    expect(request.request).toMatchObject({ model: expect.any(String), provider: expect.any(String) });
  });

  it("重写时带着素材事实，并把新的引用带回来", async () => {
    const facts = [{ id: "F1", statement: "2024 年智能云收入 320 亿元", figure: "320 亿元" }];
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "rewrite_presentation_slide") {
        return {
          slide: {
            body: "2024 年智能云收入 320 亿元",
            speakerNotes: "",
            blocks: [{ type: "bullet-list", items: ["2024 年智能云收入 320 亿元"] }],
            factRefs: ["F1"],
          },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const suggestion = await rewritePresentationSlide({
      topic: "百度年报",
      deckTitle: "百度年报",
      outline: ["封面", "智能云成为第二增长曲线"],
      slideIndex: 1,
      slide: {
        title: "智能云成为第二增长曲线",
        body: "旧正文",
        speakerNotes: "",
        plan: { purpose: "说明云业务", conclusion: "云是第二曲线", visualIntent: "structured-text", density: "medium" },
        blocks: [{ type: "paragraph", text: "旧正文" }],
      },
      facts,
    });

    const request = vi.mocked(invoke).mock.calls.find((call) => call[0] === "rewrite_presentation_slide")?.[1] as {
      request: Record<string, unknown>;
    };
    expect(request.request).toMatchObject({ facts });
    // 新版本自己给出引用，替换这一页时才会跟着更新，而不是沿用旧引用。
    expect(suggestion.factRefs).toEqual(["F1"]);
  });

  it("模型只给内容块时，正文按块重算", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "rewrite_presentation_slide") {
        return { slide: { blocks: [{ type: "paragraph", text: "只给了块，没给正文" }] } };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const suggestion = await rewritePresentationSlide({
      topic: "主题",
      deckTitle: "标题",
      outline: ["标题"],
      slideIndex: 0,
      slide: {
        title: "标题",
        body: "",
        speakerNotes: "",
        plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
        blocks: [],
      },
    });

    expect(suggestion.body).toBe("只给了块，没给正文");
    expect(suggestion.speakerNotes).toBe("");
  });

  it("模型没给内容块时，用正文还原一种块", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "rewrite_presentation_slide") return { slide: { body: "第一行\n第二行", speakerNotes: "" } };
      throw new Error(`unexpected command: ${command}`);
    });

    const suggestion = await rewritePresentationSlide({
      topic: "主题",
      deckTitle: "标题",
      outline: ["标题"],
      slideIndex: 0,
      slide: {
        title: "标题",
        body: "",
        speakerNotes: "",
        plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
        blocks: [],
      },
    });

    expect(suggestion.blocks).toEqual([{ type: "bullet-list", items: ["第一行", "第二行"] }]);
  });

  it("空结果不当作可替换的版本", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "rewrite_presentation_slide") return { slide: { body: "  ", speakerNotes: "", blocks: [] } };
      throw new Error(`unexpected command: ${command}`);
    });

    const error = await rewritePresentationSlide({
      topic: "主题",
      deckTitle: "标题",
      outline: ["标题"],
      slideIndex: 0,
      slide: {
        title: "标题",
        body: "旧正文",
        speakerNotes: "",
        plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
        blocks: [],
      },
    }).catch((reason: unknown) => reason);

    expect(describeAiError(error)).toBe("AI 没有返回可用的正文，请重新生成");
  });

  it("标题候选会剔掉当前标题和重复项", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "suggest_slide_titles")
        return { titles: ["旧标题", "广告仍是利润来源", "广告仍是利润来源", "云业务首次全年盈利"] };
      throw new Error(`unexpected command: ${command}`);
    });

    const titles = await suggestSlideTitles({
      topic: "主题",
      deckTitle: "标题",
      outline: ["旧标题"],
      slideIndex: 0,
      slide: {
        title: "旧标题",
        body: "正文",
        speakerNotes: "",
        plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
        blocks: [],
      },
    });

    expect(titles).toEqual(["广告仍是利润来源", "云业务首次全年盈利"]);
  });

  it("备注单独生成，空备注不当作可用结果", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "write_speaker_notes") return { speakerNotes: " 先讲结论，再讲依据。 " };
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(
      writeSpeakerNotes({
        topic: "主题",
        deckTitle: "标题",
        outline: ["标题"],
        slideIndex: 0,
        slide: {
          title: "标题",
          body: "正文",
          speakerNotes: "",
          plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
          blocks: [],
        },
      }),
    ).resolves.toBe("先讲结论，再讲依据。");

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "write_speaker_notes") return { speakerNotes: "   " };
      throw new Error(`unexpected command: ${command}`);
    });
    const error = await writeSpeakerNotes({
      topic: "主题",
      deckTitle: "标题",
      outline: ["标题"],
      slideIndex: 0,
      slide: {
        title: "标题",
        body: "正文",
        speakerNotes: "",
        plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
        blocks: [],
      },
    }).catch((reason: unknown) => reason);

    expect(describeAiError(error)).toBe("AI 没有写出可用的演讲备注，请重试");
  });

  it("画面描述候选去重，空结果不当作可用描述", async () => {
    const input = {
      topic: "主题",
      deckTitle: "标题",
      outline: ["标题"],
      slideIndex: 0,
      slide: {
        title: "标题",
        body: "正文",
        speakerNotes: "",
        plan: {
          purpose: "目的",
          conclusion: "结论",
          visualIntent: "structured-text" as const,
          density: "medium" as const,
        },
        blocks: [],
      },
    };

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "suggest_image_prompts")
        return { prompts: ["一间明亮的现代化数据中心", "一间明亮的现代化数据中心", "抽象几何线条构成的上升箭头"] };
      throw new Error(`unexpected command: ${command}`);
    });
    await expect(suggestImagePrompts(input)).resolves.toEqual([
      "一间明亮的现代化数据中心",
      "抽象几何线条构成的上升箭头",
    ]);

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "suggest_image_prompts") return { prompts: ["  ", "  "] };
      throw new Error(`unexpected command: ${command}`);
    });
    const error = await suggestImagePrompts(input).catch((reason: unknown) => reason);
    expect(describeAiError(error)).toBe("AI 没有给出可用的画面描述，请重试");
  });

  it("拆页返回两页，正文按各自的块重算", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "split_slide_content")
        return {
          pages: [
            {
              title: "第一页标题",
              body: "旧的投影",
              speakerNotes: "",
              plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
              blocks: [{ type: "bullet-list", items: ["要点一", "要点二"] }],
            },
            {
              title: "第二页标题",
              body: "",
              speakerNotes: "备注",
              plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
              blocks: [{ type: "paragraph", text: "第二页正文" }],
            },
          ],
        };
      throw new Error(`unexpected command: ${command}`);
    });

    const pages = await splitSlideContent({
      topic: "主题",
      deckTitle: "标题",
      outline: ["第一页标题"],
      slideIndex: 0,
      slide: {
        title: "第一页标题",
        body: "正文",
        speakerNotes: "",
        plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
        blocks: [],
      },
    });

    expect(pages.map((page) => page.title)).toEqual(["第一页标题", "第二页标题"]);
    expect(pages[0]!.body).toBe("要点一\n要点二");
    expect(pages[1]!.body).toBe("第二页正文");
  });

  it("拆出来的两页标题相同或有一页为空都算失败", async () => {
    const input = {
      topic: "主题",
      deckTitle: "标题",
      outline: ["标题"],
      slideIndex: 0,
      slide: {
        title: "标题",
        body: "正文",
        speakerNotes: "",
        plan: {
          purpose: "目的",
          conclusion: "结论",
          visualIntent: "structured-text" as const,
          density: "medium" as const,
        },
        blocks: [],
      },
    };
    const page = (title: string, blocks: unknown[]) => ({
      title,
      body: "正文",
      speakerNotes: "",
      plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
      blocks,
    });

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "split_slide_content")
        return {
          pages: [
            page("同一页", [{ type: "paragraph", text: "第一段" }]),
            page("同一页", [{ type: "paragraph", text: "第二段" }]),
          ],
        };
      throw new Error(`unexpected command: ${command}`);
    });
    const duplicate = await splitSlideContent(input).catch((reason: unknown) => reason);
    expect(describeAiError(duplicate)).toBe("AI 拆出的两页标题相同，请重试");

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "split_slide_content")
        return { pages: [page("第一页", [{ type: "paragraph", text: "第一段" }]), page("第二页", [])] };
      throw new Error(`unexpected command: ${command}`);
    });
    const empty = await splitSlideContent(input).catch((reason: unknown) => reason);
    expect(describeAiError(empty)).toBe("AI 拆出的页面没有内容，请重试");
  });

  it("整册审稿剔掉越界页码和重复条目，也不改任何文字", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "review_deck_content")
        return {
          issues: [
            { slideIndex: 0, severity: "warning", kind: "duplicate", message: "与第 2 页重复" },
            { slideIndex: 0, severity: "warning", kind: "duplicate", message: "与第 2 页重复" },
            { slideIndex: 9, severity: "error", kind: "broken-flow", message: "页码越界" },
            { slideIndex: 1, severity: "error", kind: "missing-conclusion", message: "这一页没有结论" },
          ],
        };
      throw new Error(`unexpected command: ${command}`);
    });

    const issues = await reviewDeckContent({
      deckTitle: "标题",
      presentationBrief: aiDraftSchema.parse({
        title: "标题",
        slides: [{ title: "甲", body: "乙", speakerNotes: "" }],
      }).presentationBrief,
      slides: [
        { title: "甲", body: "乙", speakerNotes: "" },
        { title: "丙", body: "丁", speakerNotes: "" },
      ],
      taskId: 3,
    });

    expect(issues.map((issue) => issue.slideIndex)).toEqual([0, 1]);
  });
});

describe("流式进度汇总", () => {
  it("把并行批次的页数相加，同一批次重复上报时取最新值", () => {
    const totals = new Map<string, { received: number; pages: number }>();

    const first = mergeStreamProgress(totals, { taskId: 1, key: "batch-0", phase: "content", received: 100, pages: 1 });
    const second = mergeStreamProgress(totals, { taskId: 1, key: "batch-5", phase: "content", received: 80, pages: 1 });
    const again = mergeStreamProgress(totals, { taskId: 1, key: "batch-0", phase: "content", received: 240, pages: 3 });

    expect(first).toEqual({ pages: 1, received: 100 });
    expect(second).toEqual({ pages: 2, received: 180 });
    // 同一批次不会把页数重复累加。
    expect(again).toEqual({ pages: 4, received: 320 });
  });

  it("大纲阶段不计入已写页数", () => {
    const totals = new Map<string, { received: number; pages: number }>();

    const outline = mergeStreamProgress(totals, {
      taskId: 1,
      key: "outline",
      phase: "outline",
      received: 400,
      pages: 0,
    });

    expect(outline.pages).toBe(0);
  });
});
