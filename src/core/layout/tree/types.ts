import type { LayoutRect } from "../geometry/coordinate-system";
import type { LayoutSpacingToken } from "../geometry/layout-functions";

export type LayoutNodeType = "canvas" | "section" | "row" | "column" | "grid" | "slot";
export type LayoutContainerType = Exclude<LayoutNodeType, "slot">;
export type LayoutState = "managed" | "detached" | "overlay";
export type LayoutSlotRole = "title" | "body" | "image" | "chart" | "table" | "metric" | "decoration";

export type LayoutSize =
  | { readonly mode: "fixed"; readonly value: number }
  | { readonly mode: "fraction"; readonly weight: number }
  | { readonly mode: "fill" }
  | { readonly mode: "content"; readonly min?: number; readonly max?: number };

export interface LayoutNodeBase {
  readonly id: string;
  readonly width: LayoutSize;
  readonly height: LayoutSize;
  readonly layoutState: LayoutState;
}

export interface LayoutContainerNode extends LayoutNodeBase {
  readonly type: LayoutContainerType;
  readonly gap?: LayoutSpacingToken;
  readonly padding?: LayoutSpacingToken;
  readonly columns?: number;
  readonly children: readonly LayoutNode[];
}

export interface LayoutSlotNode extends LayoutNodeBase {
  readonly type: "slot";
  readonly role: LayoutSlotRole;
  readonly contentRef?: string;
  readonly fit?: "contain" | "cover" | "stretch";
}

export type LayoutNode = LayoutContainerNode | LayoutSlotNode;

export interface LayoutTreeDraft {
  readonly coordinateSpace: "normalized-1000";
  readonly registryVersion: 1;
  readonly root: LayoutContainerNode & { readonly type: "canvas" };
}

export const LAYOUT_SCHEMA_VERSION = 1 as const;

/** A reusable, persisted layout skeleton. It never contains user copy. */
export interface LayoutDefinition {
  readonly id: string;
  readonly name: string;
  readonly layoutSchemaVersion: typeof LAYOUT_SCHEMA_VERSION;
  readonly tree: LayoutTreeDraft;
}

/** Properties that a page may override without forking its definition. */
export interface LayoutNodeOverride {
  readonly nodeId: string;
  readonly width?: LayoutSize;
  readonly height?: LayoutSize;
  readonly layoutState?: LayoutState;
  readonly gap?: LayoutSpacingToken;
  readonly padding?: LayoutSpacingToken;
  readonly columns?: number;
}

/** A page instance: stable definition reference, content bindings and local overrides. */
export interface LayoutBinding {
  readonly definitionId: string;
  readonly slotBindings: Readonly<Record<string, string>>;
  readonly overrides?: readonly LayoutNodeOverride[];
}

export interface LayoutMeasurement {
  readonly width: number;
  readonly height: number;
}

export interface MeasurementSnapshot {
  readonly version: 1;
  readonly measurerId: string;
  readonly measurements: Readonly<Record<string, LayoutMeasurement>>;
}

export type LayoutTreeIssueCode =
  | "INVALID_LAYOUT_TREE"
  | "INVALID_NODE_REFERENCE"
  | "UNSUPPORTED_NODE_TYPE"
  | "INSUFFICIENT_CAPACITY"
  | "MEASURE_UNAVAILABLE"
  | "OUT_OF_BOUNDS"
  | "OVERLAP";

export interface LayoutTreeIssue {
  readonly code: LayoutTreeIssueCode;
  readonly paths: readonly string[];
  readonly message: string;
}

export interface CompiledLayoutTree {
  readonly normalized: LayoutTreeDraft;
  readonly slots: ReadonlyMap<string, LayoutRect>;
  readonly nodeRects: ReadonlyMap<string, LayoutRect>;
  readonly issues: readonly LayoutTreeIssue[];
}

