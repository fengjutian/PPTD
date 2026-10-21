import type { ChartElement, Slide } from "./types";

/**
 * Chart data of a slide.
 *
 * The numbers of a chart are the reviewed numbers of the page. A metric block
 * carries them as the string the reviewer approved ("38万", "12%"), and the
 * chart reads them back instead of storing a second copy. A chart therefore
 * cannot show a number that is not in the content, and editing the content
 * changes the chart without touching the design.
 */

export interface ChartDatum {
  /** The label of the metric, used as the category of the chart. */
  category: string;
  value: number;
}

export interface ResolvedChartData {
  data: ChartDatum[];
  /** The unit every value carries, e.g. "万" or "%". Empty when there is none. */
  unit: string;
}

/**
 * A metric value is chartable when it is a number with an optional scale or
 * percentage. A value with a unit noun ("38万人") is not chartable: reading it
 * as 38 would change what the approved number means.
 */
const METRIC_VALUE = /^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?))\s*(万|亿|千|百|%|‰)?$/;

export function parseMetricValue(value: string): { value: number; unit: string } | undefined {
  const match = METRIC_VALUE.exec(value.trim());
  if (!match) return undefined;
  const number = Number.parseFloat(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(number)) return undefined;
  return { value: number, unit: match[2] ?? "" };
}

/**
 * Reads the data of a chart from the content blocks it points at. Returns
 * undefined when a block is missing, is not a metric, carries a value that is
 * not a number, or the metrics do not share one unit: a chart with mixed units
 * would compare numbers that do not mean the same thing.
 */
export function resolveChartData(slide: Slide, element: ChartElement): ResolvedChartData | undefined {
  const blocks = slide.content.blocks ?? [];
  const data: ChartDatum[] = [];
  let unit: string | undefined;
  for (const blockId of element.contentBlockIds) {
    const block = blocks.find((candidate) => candidate.id === blockId);
    if (!block || block.type !== "metric") return undefined;
    const parsed = parseMetricValue(block.value);
    if (!parsed) return undefined;
    if (unit === undefined) unit = parsed.unit;
    else if (unit !== parsed.unit) return undefined;
    data.push({ category: block.label, value: parsed.value });
  }
  if (data.length === 0) return undefined;
  return { data, unit: unit ?? "" };
}

/** The value as it is shown next to a bar, e.g. "38万". */
export function formatChartValue(value: number, unit: string): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}${unit}`;
}
