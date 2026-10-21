import { EMU_PER_INCH, emu, type Emu, type RectEmu } from "../../core/document-model";

/** Length unit the position and size fields are shown in. The document always stores EMU. */
export type LengthUnit = "inch" | "cm";

export const CM_PER_INCH = 2.54;
/** Smallest edge the panel accepts, in EMU. Mirrors the 0.01 inch floor of the width field. */
export const MIN_SIZE_EMU = Math.round(0.01 * EMU_PER_INCH);

export function emuToUnit(value: Emu, unit: LengthUnit): number {
  const inches = value / EMU_PER_INCH;
  return unit === "cm" ? inches * CM_PER_INCH : inches;
}

export function unitToEmu(value: number, unit: LengthUnit): Emu {
  const inches = unit === "cm" ? value / CM_PER_INCH : value;
  return emu(inches * EMU_PER_INCH);
}

export function unitLabel(unit: LengthUnit): string {
  return unit === "cm" ? "厘米" : "英寸";
}

/**
 * Resizes one edge of a frame. With the aspect ratio locked the other edge
 * follows the ratio the element had before the edit, so the shape never
 * silently changes its proportions.
 */
export function resizeWithAspectLock(frame: RectEmu, field: "width" | "height", nextEdge: Emu, locked: boolean): RectEmu {
  const next = { ...frame, [field]: nextEdge };
  if (!locked || frame.width <= 0 || frame.height <= 0) return next;
  const ratio = frame.width / frame.height;
  if (field === "width") next.height = emu(Math.max(MIN_SIZE_EMU, Math.round(nextEdge / ratio)));
  else next.width = emu(Math.max(MIN_SIZE_EMU, Math.round(nextEdge * ratio)));
  return next;
}
