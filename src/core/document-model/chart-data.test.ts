import { describe, expect, it } from "vitest";
import { formatChartValue, parseMetricValue, resolveChartData } from "./chart-data";
import { createDocument, emu } from "./factory";
import type { ChartElement } from "./types";

function chartOf(blockIds: string[]): ChartElement {
  return {
    id: crypto.randomUUID() as never,
    type: "chart",
    contentBlockIds: blockIds,
    kind: "column",
    frame: { x: emu(0), y: emu(0), width: emu(100), height: emu(100) },
    rotationMilliDegree: 0,
    locked: false,
    style: {
      fontFamily: "Microsoft YaHei",
      fontSizePt: 14,
      textColor: "#17181c",
      seriesColors: ["#3366CC"],
      showLegend: false,
      showValueLabels: true,
    },
  };
}

describe("chart data", () => {
  it("reads a number with a scale or a percentage", () => {
    expect(parseMetricValue("38万")).toEqual({ value: 38, unit: "万" });
    expect(parseMetricValue("3.5亿")).toEqual({ value: 3.5, unit: "亿" });
    expect(parseMetricValue("12%")).toEqual({ value: 12, unit: "%" });
    expect(parseMetricValue("1,234")).toEqual({ value: 1234, unit: "" });
    expect(parseMetricValue("42")).toEqual({ value: 42, unit: "" });
  });

  it("refuses a value that is not a plain number", () => {
    // A value with a unit noun is not chartable: reading "38万人" as 38 would
    // change what the approved number means.
    expect(parseMetricValue("38万人")).toBeUndefined();
    expect(parseMetricValue("约 38 万")).toBeUndefined();
    expect(parseMetricValue("持平")).toBeUndefined();
  });

  it("reads the categories and the values from the reviewed metric blocks", () => {
    const document = createDocument();
    const first = { id: crypto.randomUUID(), type: "metric" as const, label: "年检测样本量", value: "38万" };
    const second = { id: crypto.randomUUID(), type: "metric" as const, label: "覆盖机构", value: "12万" };
    document.slides[0]!.content.blocks = [first, second];
    const resolved = resolveChartData(document.slides[0]!, chartOf([first.id, second.id]));
    expect(resolved).toMatchObject({
      categories: ["年检测样本量", "覆盖机构"],
      series: [{ name: "万", values: [38, 12] }],
      data: [
        { category: "年检测样本量", value: 38 },
        { category: "覆盖机构", value: 12 },
      ],
      unit: "万",
    });
  });

  it("refuses metrics that do not share one unit", () => {
    const document = createDocument();
    const first = { id: crypto.randomUUID(), type: "metric" as const, label: "样本量", value: "38万" };
    const second = { id: crypto.randomUUID(), type: "metric" as const, label: "增长率", value: "12%" };
    document.slides[0]!.content.blocks = [first, second];
    expect(resolveChartData(document.slides[0]!, chartOf([first.id, second.id]))).toBeUndefined();
  });

  it("reads a chart block directly", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.content.blocks = [
      {
        id: "chart-1",
        type: "chart",
        kind: "column",
        categories: ["一月", "二月"],
        values: [12, 18],
        unit: "万",
      },
    ];
    expect(resolveChartData(slide, chartOf(["chart-1"]))).toMatchObject({
      categories: ["一月", "二月"],
      series: [{ name: "万", values: [12, 18] }],
      data: [
        { category: "一月", value: 12 },
        { category: "二月", value: 18 },
      ],
      unit: "万",
    });
  });

  it("reads multiple named series", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.content.blocks = [
      {
        id: "chart-2",
        type: "chart",
        kind: "column",
        categories: ["第一季度", "第二季度"],
        series: [
          { name: "收入", values: [38, 52] },
          { name: "利润", values: [8, 14] },
        ],
        unit: "万元",
      },
    ];
    const resolved = resolveChartData(slide, chartOf(["chart-2"]));
    expect(resolved?.series.map((series) => series.name)).toEqual(["收入", "利润"]);
    expect(resolved?.series[1]?.values).toEqual([8, 14]);
  });

  it("refuses a chart that points at a block that is gone", () => {
    const document = createDocument();
    const first = { id: crypto.randomUUID(), type: "metric" as const, label: "样本量", value: "38万" };
    document.slides[0]!.content.blocks = [first];
    expect(resolveChartData(document.slides[0]!, chartOf([crypto.randomUUID()]))).toBeUndefined();
  });

  it("shows the value with its unit", () => {
    expect(formatChartValue(38, "万")).toBe("38万");
    expect(formatChartValue(3.456, "亿")).toBe("3.46亿");
    expect(formatChartValue(42, "")).toBe("42");
  });
});
