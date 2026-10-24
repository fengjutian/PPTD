/**
 * The relation a data page is trying to show, before choosing a chart type.
 *
 * A page can carry correct numbers and still communicate the wrong thing: a
 * time series drawn as a pie, or shares drawn as columns. The relation is a
 * generation-time dimension, not a persisted document field; the resulting
 * chart kind is what the document stores.
 */

import type { ChartKind } from "../document-model";

export type DataRelation = "proportion" | "change" | "composition" | "comparison" | "magnitude";

export const DATA_RELATIONS: readonly DataRelation[] = [
  "proportion",
  "change",
  "composition",
  "comparison",
  "magnitude",
];

const COMPATIBLE: Readonly<Record<DataRelation, readonly ChartKind[]>> = {
  // A single whole split into shares.
  proportion: ["pie", "bar"],
  // Values over time; a line is the only native kind that reads as a trend.
  change: ["line"],
  // How parts make up a category set; a short list can be a pie, longer ones bars.
  composition: ["pie", "bar"],
  // Categories compared side by side.
  comparison: ["column", "bar"],
  // How large values are; length is the readable channel.
  magnitude: ["column", "bar"],
};

export function isChartKindCompatible(relation: DataRelation, kind: ChartKind): boolean {
  return COMPATIBLE[relation].includes(kind);
}

/** The kind the relation prefers when the model did not pick a compatible one. */
export function preferredChartKind(relation: DataRelation, pointCount: number): ChartKind {
  switch (relation) {
    case "proportion":
      return pointCount <= 5 ? "pie" : "bar";
    case "change":
      return "line";
    case "composition":
      return pointCount <= 4 ? "pie" : "bar";
    case "comparison":
      return pointCount <= 4 ? "column" : "bar";
    case "magnitude":
      return pointCount <= 4 ? "column" : "bar";
  }
}

/**
 * Resolves the final chart kind.
 *
 * A requested kind wins only when it fits the relation. Otherwise the relation
 * decides, so a model cannot draw a trend as a pie by repeating the mistake.
 * Without a relation the requested kind is kept, preserving legacy behavior.
 */
export function resolveChartKind(input: {
  relation?: DataRelation;
  requestedKind?: ChartKind;
  pointCount: number;
}): ChartKind {
  const { relation, requestedKind, pointCount } = input;
  if (relation) {
    if (requestedKind && isChartKindCompatible(relation, requestedKind)) {
      // A pie with too many slices is unreadable even though it is technically
      // compatible with the relation.
      const pieLimit = relation === "proportion" ? 5 : relation === "composition" ? 4 : 0;
      if (requestedKind === "pie" && pieLimit > 0 && pointCount > pieLimit) {
        return preferredChartKind(relation, pointCount);
      }
      return requestedKind;
    }
    return preferredChartKind(relation, pointCount);
  }
  if (requestedKind) return requestedKind;
  return pointCount > 4 ? "bar" : "column";
}
