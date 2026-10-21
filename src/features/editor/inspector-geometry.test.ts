import { describe, expect, it } from "vitest";
import { EMU_PER_INCH, emu } from "../../core/document-model";
import { MIN_SIZE_EMU, emuToUnit, resizeWithAspectLock, unitToEmu } from "./inspector-geometry";

describe("inspector geometry", () => {
  it("shows the stored size in the requested unit without changing it", () => {
    const width = emu(4 * EMU_PER_INCH);
    expect(emuToUnit(width, "inch")).toBeCloseTo(4, 6);
    expect(emuToUnit(width, "cm")).toBeCloseTo(10.16, 6);
    expect(unitToEmu(10.16, "cm")).toBe(width);
    expect(unitToEmu(4, "inch")).toBe(width);
  });

  it("keeps the original proportions when the width changes and the ratio is locked", () => {
    const frame = { x: emu(0), y: emu(0), width: emu(4 * EMU_PER_INCH), height: emu(2 * EMU_PER_INCH) };
    const next = resizeWithAspectLock(frame, "width", emu(8 * EMU_PER_INCH), true);
    expect(next.width).toBe(8 * EMU_PER_INCH);
    expect(next.height).toBe(4 * EMU_PER_INCH);
  });

  it("keeps the original proportions when the height changes and the ratio is locked", () => {
    const frame = { x: emu(0), y: emu(0), width: emu(4 * EMU_PER_INCH), height: emu(2 * EMU_PER_INCH) };
    const next = resizeWithAspectLock(frame, "height", emu(4 * EMU_PER_INCH), true);
    expect(next.height).toBe(4 * EMU_PER_INCH);
    expect(next.width).toBe(8 * EMU_PER_INCH);
  });

  it("leaves the other edge alone when the ratio is not locked", () => {
    const frame = { x: emu(0), y: emu(0), width: emu(4 * EMU_PER_INCH), height: emu(2 * EMU_PER_INCH) };
    const next = resizeWithAspectLock(frame, "width", emu(8 * EMU_PER_INCH), false);
    expect(next.width).toBe(8 * EMU_PER_INCH);
    expect(next.height).toBe(2 * EMU_PER_INCH);
  });

  it("never lets a locked edge collapse below the minimum size", () => {
    const frame = { x: emu(0), y: emu(0), width: emu(4 * EMU_PER_INCH), height: emu(2 * EMU_PER_INCH) };
    const next = resizeWithAspectLock(frame, "height", emu(0.001 * EMU_PER_INCH), true);
    expect(next.width).toBe(MIN_SIZE_EMU);
  });
});
