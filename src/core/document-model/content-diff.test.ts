import { describe, expect, it } from "vitest";
import { createDocument, createSlide } from "./factory";
import { contentVersionSlides } from "./content-version";
import { diffContentVersion, summarizeContentBlock } from "./content-diff";
import type { ContentBlock, ContentVersion, PresentationDocument } from "./types";

function snapshot(document: PresentationDocument): ContentVersion {
  return {
    id: crypto.randomUUID(),
    contentRevision: document.revisions.content,
    documentRevision: document.revisions.document,
    slides: contentVersionSlides(document),
  };
}

function metric(id: string, value: string): ContentBlock {
  return { id, type: "metric", label: "收入", value };
}

describe("content diff", () => {
  it("reports no difference for an unchanged deck", () => {
    const document = createDocument();
    document.slides[0]!.content.title = "标题";
    const version = snapshot(document);
    expect(diffContentVersion(version, document)).toEqual([]);
  });

  it("reports title, body and speaker-note changes", () => {
    const document = createDocument();
    document.slides[0]!.content.title = "旧标题";
    document.slides[0]!.content.body = "旧正文";
    document.slides[0]!.content.speakerNotes = "旧备注";
    const version = snapshot(document);

    document.slides[0]!.content.title = "新标题";
    document.slides[0]!.content.body = "新正文";
    document.slides[0]!.content.speakerNotes = "新备注";

    expect(diffContentVersion(version, document)).toEqual([
      {
        slideId: document.slides[0]!.id,
        status: "changed",
        beforeTitle: "旧标题",
        afterTitle: "新标题",
        changes: [
          { field: "title", change: "changed", before: "旧标题", after: "新标题" },
          { field: "body", change: "changed", before: "旧正文", after: "新正文" },
          { field: "speakerNotes", change: "changed", before: "旧备注", after: "新备注" },
        ],
      },
    ]);
  });

  it("reports a metric value change and a table cell change by block", () => {
    const document = createDocument();
    const metricId = crypto.randomUUID();
    const tableId = crypto.randomUUID();
    document.slides[0]!.content.blocks = [
      metric(metricId, "38万"),
      { id: tableId, type: "table-data", header: ["项目", "数值"], rows: [["样本量", "120"]] },
    ];
    const version = snapshot(document);

    (document.slides[0]!.content.blocks![0] as Extract<ContentBlock, { type: "metric" }>).value = "42万";
    (document.slides[0]!.content.blocks![1] as Extract<ContentBlock, { type: "table-data" }>).rows = [
      ["样本量", "150"],
    ];

    expect(diffContentVersion(version, document)[0]!.changes).toEqual([
      { field: "block", change: "changed", before: "收入：38万", after: "收入：42万" },
      {
        field: "block",
        change: "changed",
        before: "表头：项目 / 数值；样本量 / 120",
        after: "表头：项目 / 数值；样本量 / 150",
      },
    ]);
  });

  it("reports added and removed blocks", () => {
    const document = createDocument();
    const metricBlock = metric(crypto.randomUUID(), "38万");
    const paragraph: ContentBlock = { id: crypto.randomUUID(), type: "paragraph", text: "补充说明" };
    document.slides[0]!.content.blocks = [metricBlock];
    const version = snapshot(document);

    document.slides[0]!.content.blocks = [metricBlock, paragraph];
    expect(diffContentVersion(version, document)[0]!.changes).toEqual([
      { field: "block", change: "added", after: "补充说明" },
    ]);

    const withParagraph = snapshot(document);
    document.slides[0]!.content.blocks = [paragraph];
    expect(diffContentVersion(withParagraph, document)[0]!.changes).toEqual([
      { field: "block", change: "removed", before: "收入：38万" },
    ]);
  });

  it("reports a block reorder even when every block value is unchanged", () => {
    const document = createDocument();
    const first = metric(crypto.randomUUID(), "38万");
    const second = metric(crypto.randomUUID(), "42万");
    document.slides[0]!.content.blocks = [first, second];
    const version = snapshot(document);

    document.slides[0]!.content.blocks = [second, first];

    expect(diffContentVersion(version, document)[0]!.changes).toEqual([
      {
        field: "blockOrder",
        change: "changed",
        before: "收入：38万；收入：42万",
        after: "收入：42万；收入：38万",
      },
    ]);
  });

  it("does not report a difference when only block ids were regenerated", () => {
    const document = createDocument();
    document.slides[0]!.content.blocks = [metric(crypto.randomUUID(), "38万")];
    const version = snapshot(document);

    document.slides[0]!.content.blocks = [metric(crypto.randomUUID(), "38万")];

    expect(diffContentVersion(version, document)).toEqual([]);
  });

  it("reports added and removed pages", () => {
    const document = createDocument();
    document.slides.push(createSlide(2));
    document.slides[1]!.content.title = "第二页";
    const version = snapshot(document);
    const secondId = document.slides[1]!.id;

    document.slides.push(createSlide(3));
    document.slides[2]!.content.title = "新增页";
    document.slides.splice(1, 1);

    const diff = diffContentVersion(version, document);
    expect(diff.map((item) => item.status).sort()).toEqual(["added", "removed"]);
    expect(diff.find((item) => item.status === "added")).toMatchObject({ afterTitle: "新增页", afterIndex: 1 });
    expect(diff.find((item) => item.status === "removed")).toMatchObject({ beforeTitle: "第二页", slideId: secondId });
  });

  it("reports a page move when the page set is unchanged", () => {
    const document = createDocument();
    document.slides.push(createSlide(2));
    document.slides[1]!.content.title = "第二页";
    const version = snapshot(document);

    document.slides.reverse();

    const diff = diffContentVersion(version, document);
    expect(diff).toHaveLength(2);
    expect(diff.every((item) => item.status === "moved")).toBe(true);
    expect(diff[0]).toMatchObject({ beforeTitle: "第二页", beforeIndex: 1, afterIndex: 0 });
  });

  it("does not call every later page moved after an insertion", () => {
    const document = createDocument();
    document.slides.push(createSlide(2));
    document.slides[1]!.content.title = "第二页";
    const version = snapshot(document);

    document.slides.unshift(createSlide(3));
    document.slides[0]!.content.title = "新增页";

    const diff = diffContentVersion(version, document);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ status: "added", afterTitle: "新增页" });
  });

  it("summarizes every block kind without leaking object syntax", () => {
    expect(summarizeContentBlock({ id: "x", type: "paragraph", text: "一段话" })).toBe("一段话");
    expect(summarizeContentBlock({ id: "x", type: "bullet-list", items: ["甲", "乙"] })).toBe("甲；乙");
    expect(summarizeContentBlock({ id: "x", type: "quote", text: "原话", attribution: "某人" })).toBe("“原话” —— 某人");
    expect(summarizeContentBlock({ id: "x", type: "timeline", items: [{ label: "2024", text: "立项" }] })).toBe(
      "2024：立项",
    );
    expect(
      summarizeContentBlock({
        id: "x",
        type: "comparison",
        leftLabel: "方案 A",
        leftItems: ["快"],
        rightLabel: "方案 B",
        rightItems: ["稳"],
      }),
    ).toBe("方案 A：快 ｜ 方案 B：稳");
    expect(summarizeContentBlock({ id: "x", type: "table-data", header: ["列"], rows: [["值"]] })).toBe("表头：列；值");
  });
});
