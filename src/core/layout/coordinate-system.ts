import type { Emu, RectEmu } from "../document-model";
import type { NormalizedRect, PageChrome } from "./page-chrome";

export const LAYOUT_SPACE_SIZE = 1000;

export type LayoutUnit = number & { readonly __brand: "LayoutUnit" };

export interface LayoutPoint {
  x: LayoutUnit;
  y: LayoutUnit;
}

export interface LayoutRect {
  x: LayoutUnit;
  y: LayoutUnit;
  width: LayoutUnit;
  height: LayoutUnit;
}

export interface PageCoordinateSystem {
  coordinateSpace: "normalized-1000";
  page: LayoutRect;
  safe: LayoutRect;
  title: LayoutRect;
  content: LayoutRect;
  footer: LayoutRect;
  rail?: LayoutRect;
  image?: LayoutRect;
}

export function layoutUnit(value: number): LayoutUnit {
  if (!Number.isInteger(value) || value < 0 || value > LAYOUT_SPACE_SIZE) {
    throw new Error("INVALID_LAYOUT_UNIT");
  }
  return value as LayoutUnit;
}

export function layoutRect(x: number, y: number, width: number, height: number): LayoutRect {
  const rect = { x: layoutUnit(x), y: layoutUnit(y), width: layoutUnit(width), height: layoutUnit(height) };
  if (width <= 0 || height <= 0 || x + width > LAYOUT_SPACE_SIZE || y + height > LAYOUT_SPACE_SIZE) {
    throw new Error("INVALID_LAYOUT_RECT");
  }
  return rect;
}

export function normalizedToLayoutRect(rect: NormalizedRect): LayoutRect {
  return layoutRect(
    Math.round(rect.x * LAYOUT_SPACE_SIZE),
    Math.round(rect.y * LAYOUT_SPACE_SIZE),
    Math.round(rect.width * LAYOUT_SPACE_SIZE),
    Math.round(rect.height * LAYOUT_SPACE_SIZE),
  );
}

export function layoutRectToNormalized(rect: LayoutRect): NormalizedRect {
  return {
    x: rect.x / LAYOUT_SPACE_SIZE,
    y: rect.y / LAYOUT_SPACE_SIZE,
    width: rect.width / LAYOUT_SPACE_SIZE,
    height: rect.height / LAYOUT_SPACE_SIZE,
  };
}

export function layoutRectToEmu(rect: LayoutRect, page: { width: Emu; height: Emu }): RectEmu {
  return {
    x: Math.round((rect.x / LAYOUT_SPACE_SIZE) * page.width) as Emu,
    y: Math.round((rect.y / LAYOUT_SPACE_SIZE) * page.height) as Emu,
    width: Math.round((rect.width / LAYOUT_SPACE_SIZE) * page.width) as Emu,
    height: Math.round((rect.height / LAYOUT_SPACE_SIZE) * page.height) as Emu,
  };
}

export function pageCoordinateSystemFromChrome(
  chrome: PageChrome,
  options: { safe?: NormalizedRect; rail?: NormalizedRect; image?: NormalizedRect } = {},
): PageCoordinateSystem {
  return {
    coordinateSpace: "normalized-1000",
    page: layoutRect(0, 0, LAYOUT_SPACE_SIZE, LAYOUT_SPACE_SIZE),
    safe: normalizedToLayoutRect(options.safe ?? chrome.content),
    title: normalizedToLayoutRect(chrome.title),
    content: normalizedToLayoutRect(chrome.content),
    footer: layoutRect(Math.round(chrome.content.x * 1000), 940, Math.round(chrome.content.width * 1000), 40),
    ...(options.rail ? { rail: normalizedToLayoutRect(options.rail) } : {}),
    ...(options.image ? { image: normalizedToLayoutRect(options.image) } : {}),
  };
}
