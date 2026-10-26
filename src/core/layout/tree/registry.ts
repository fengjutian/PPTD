import type { LayoutNodeType, LayoutSlotRole } from "./types";

export const LAYOUT_REGISTRY_VERSION = 1 as const;

export interface LayoutCapability {
  readonly type: LayoutNodeType;
  readonly acceptsChildren: boolean;
  readonly allowedParents: readonly LayoutNodeType[];
  readonly allowedChildren: readonly LayoutNodeType[];
  readonly ai: { readonly create: boolean; readonly update: boolean; readonly remove: boolean };
  readonly slotRoles?: readonly LayoutSlotRole[];
}

const containers = ["section", "row", "column", "grid"] as const;
const children = [...containers, "slot"] as const;
const containerParents = ["canvas", ...containers] as const;

export const LAYOUT_CAPABILITIES: Readonly<Record<LayoutNodeType, LayoutCapability>> = {
  canvas: {
    type: "canvas",
    acceptsChildren: true,
    allowedParents: [],
    allowedChildren: children,
    ai: { create: false, update: false, remove: false },
  },
  section: {
    type: "section",
    acceptsChildren: true,
    allowedParents: containerParents,
    allowedChildren: children,
    ai: { create: true, update: true, remove: true },
  },
  row: {
    type: "row",
    acceptsChildren: true,
    allowedParents: containerParents,
    allowedChildren: children,
    ai: { create: true, update: true, remove: true },
  },
  column: {
    type: "column",
    acceptsChildren: true,
    allowedParents: containerParents,
    allowedChildren: children,
    ai: { create: true, update: true, remove: true },
  },
  grid: {
    type: "grid",
    acceptsChildren: true,
    allowedParents: containerParents,
    allowedChildren: children,
    ai: { create: true, update: true, remove: true },
  },
  slot: {
    type: "slot",
    acceptsChildren: false,
    allowedParents: containerParents,
    allowedChildren: [],
    ai: { create: true, update: true, remove: true },
    slotRoles: ["title", "body", "image", "chart", "table", "metric", "decoration"],
  },
};

export function layoutCapability(type: LayoutNodeType): LayoutCapability {
  return LAYOUT_CAPABILITIES[type];
}

