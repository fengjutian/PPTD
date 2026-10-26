import { describe, expect, it } from "vitest";
import { presentationDocumentSchema } from "../document-model";
import { importedDeckToDocument, type ImportedDeck } from "./pptx-import";

function deck(overrides: Partial<ImportedDeck> = {}): ImportedDeck {
  return {
    title: "季度复盘",
    pageSize: { width: 12_192_000, height: 6_858_000 },
    theme: {
      majorFont: "Aptos Display",
      minorFont: "Aptos",
      colors: [
        { name: "lt1", value: "#FFFFFF" },
        { name: "tx1", value: "#111111" },
        { name: "accent1", value: "#3366CC" },
      ],
    },
    report: {
      format: "pptx",
      compatibility: "A",
      slideCount: 1,
      counts: { text: 1, image: 1, shape: 0, table: 1 },
      unsupported: [],
      warnings: [],
      assets: { extracted: 1, skipped: 0, bytes: 100 },
    },
    slides: [
      {
        index: 0,
        title: "季度复盘",
        body: "收入增长 12%",
        speakerNotes: "先讲结论",
        groups: [[0, 2]],
        elements: [
          {
            type: "text",
            frame: { x: 914_400, y: 457_200, width: 7_315_200, height: 914_400 },
            rotationMilliDegree: 0,
            text: "季度复盘",
            contentRef: "title",
            style: {
              fontFamily: "Aptos Display",
              fontSizePt: 40,
              color: "#111111",
              bold: true,
              italic: false,
              underline: false,
              strikethrough: false,
              align: "left",
              verticalAlign: "top",
              letterSpacingPt: 0.8,
              bullet: "none",
            },
            runs: [{ start: 0, end: 4, bold: true, color: "#3366CC", underline: false }],
          },
          {
            type: "image",
            frame: { x: 914_400, y: 1_828_800, width: 1_828_800, height: 1_828_800 },
            rotationMilliDegree: 0,
            dataUrl: "data:image/png;base64,AAAA",
            mimeType: "image/png",
            altText: "趋势图",
            crop: { top: 0.1, bottom: 0.1, left: 0, right: 0 },
          },
          {
            type: "table",
            frame: { x: 914_400, y: 3_657_600, width: 3_657_600, height: 1_371_600 },
            rotationMilliDegree: 0,
            header: ["项目", "数值"],
            rows: [["样本量", "38万"]],
          },
          {
            type: "chart",
            frame: { x: 4_572_000, y: 3_657_600, width: 4_572_000, height: 2_743_200 },
            rotationMilliDegree: 0,
            kind: "column",
            categories: ["一月", "二月"],
            values: [12, 18],
            colors: ["#3366CC"],
            showLegend: false,
            showValues: true,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("importedDeckToDocument", () => {
  it("maps a Level A deck into a review document without inventing content", () => {
    const document = importedDeckToDocument(deck());
    expect(() => presentationDocumentSchema.parse(document)).not.toThrow();
    expect(document.title).toBe("季度复盘");
    expect(document.pageSize).toEqual({ width: 12_192_000, height: 6_858_000 });
    const slide = document.slides[0]!;
    expect(slide.content.status).toBe("review");
    expect(slide.content.title).toBe("季度复盘");
    expect(slide.content.body).toBe("收入增长 12%");
    expect(slide.content.speakerNotes).toBe("先讲结论");
    expect(slide.background).toBe("#FFFFFF");

    const title = slide.elements.find((element) => element.type === "text" && element.contentRef === "title");
    expect(title).toMatchObject({ text: "季度复盘" });
    if (title?.type === "text") {
      expect(title.runs?.[0]).toMatchObject({ start: 0, end: 4, bold: true, color: "#3366CC" });
      expect(title.style.fontFamily).toBe("Aptos Display");
    }

    const image = slide.elements.find((element) => element.type === "image");
    expect(image).toMatchObject({ altText: "趋势图" });
    if (image?.type === "image") {
      expect(image.crop).toEqual({ top: 0.1, bottom: 0.1, left: 0, right: 0 });
    }

    const table = slide.elements.find((element) => element.type === "table");
    expect(table?.type).toBe("table");
    if (table?.type === "table") {
      const block = slide.content.blocks?.find((candidate) => candidate.id === table.contentBlockId);
      expect(block).toMatchObject({ type: "table-data", header: ["项目", "数值"], rows: [["样本量", "38万"]] });
    }
    const group = slide.groups?.[0];
    expect(group?.elementIds).toEqual([title!.id, table!.id]);
    const chart = slide.elements.find((element) => element.type === "chart");
    expect(chart?.type).toBe("chart");
    if (chart?.type === "chart") {
      expect(chart.kind).toBe("column");
      expect(chart.style.showValueLabels).toBe(true);
      const metrics = slide.content.blocks?.filter((block) => block.type === "metric") ?? [];
      expect(metrics.map((block) => (block.type === "metric" ? `${block.label}=${block.value}` : ""))).toEqual([
        "一月=12",
        "二月=18",
      ]);
    }
    expect(() => presentationDocumentSchema.parse(document)).not.toThrow();
  });

  it("falls back to a readable page title when the slide has none", () => {
    const source = deck();
    source.slides[0] = {
      ...source.slides[0]!,
      title: undefined,
      elements: source.slides[0]!.elements.filter((element) => element.type !== "text"),
    };
    const document = importedDeckToDocument(source);
    expect(document.slides[0]!.content.title).toBe("第 1 页");
  });

  it("keeps a resolved slide background instead of forcing the deck theme background", () => {
    const source = deck();
    source.slides[0]!.background = "#102030";
    const document = importedDeckToDocument(source);
    expect(document.slides[0]!.background).toBe("#102030");
  });

  it("maps a supported native slide transition", () => {
    const source = deck();
    source.slides[0]!.transition = { kind: "wipe", speed: "slow", direction: "down" };
    const document = importedDeckToDocument(source);
    expect(document.slides[0]!.transition).toEqual({ kind: "wipe", speed: "slow", direction: "down" });
  });

  it("clamps impossible crop values instead of producing an invalid image", () => {
    const source = deck();
    source.slides[0]!.elements = source.slides[0]!.elements.map((element) =>
      element.type === "image" ? { ...element, crop: { top: 1.4, bottom: -1, left: 2, right: 0 } } : element,
    );
    const document = importedDeckToDocument(source);
    const image = document.slides[0]!.elements.find((element) => element.type === "image");
    if (image?.type === "image") {
      expect(image.crop).toEqual({ top: 0.99, bottom: 0, left: 0.99, right: 0 });
    }
  });
});
