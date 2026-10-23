import { EMU_PER_INCH, emu } from "./factory";
import type { Emu } from "./types";

/** The page sizes the design ribbon offers, in inches. */
export interface PageSizePreset {
  id: "16:9" | "4:3" | "16:10";
  label: string;
  widthIn: number;
  heightIn: number;
}

export const PAGE_SIZE_PRESETS: readonly PageSizePreset[] = [
  { id: "16:9", label: "16:9 宽屏", widthIn: 13.333, heightIn: 7.5 },
  { id: "4:3", label: "4:3 标准", widthIn: 10, heightIn: 7.5 },
  { id: "16:10", label: "16:10", widthIn: 13.333, heightIn: 8.333 },
] as const;

/**
 * PowerPoint refuses a page narrower than 1 inch or wider than 56 inches.
 * Keeping the same bounds here means a size this editor accepts can always be
 * opened and edited in PowerPoint.
 */
export const MIN_PAGE_SIZE_IN = 1;
export const MAX_PAGE_SIZE_IN = 56;

export function pageSizeFromInches(widthIn: number, heightIn: number): { width: Emu; height: Emu } | undefined {
  if (!Number.isFinite(widthIn) || !Number.isFinite(heightIn)) return undefined;
  if (widthIn < MIN_PAGE_SIZE_IN || widthIn > MAX_PAGE_SIZE_IN) return undefined;
  if (heightIn < MIN_PAGE_SIZE_IN || heightIn > MAX_PAGE_SIZE_IN) return undefined;
  return { width: emu(widthIn * EMU_PER_INCH), height: emu(heightIn * EMU_PER_INCH) };
}

/** The preset a page exactly matches, when it matches one. */
export function matchPageSizePreset(pageSize: { width: Emu; height: Emu }): PageSizePreset | undefined {
  return PAGE_SIZE_PRESETS.find((preset) => {
    const size = pageSizeFromInches(preset.widthIn, preset.heightIn);
    return size !== undefined && size.width === pageSize.width && size.height === pageSize.height;
  });
}
