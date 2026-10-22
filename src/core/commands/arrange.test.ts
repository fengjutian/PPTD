import { describe, expect, it } from "vitest";
import { emu, inches, type ElementId, type RectEmu } from "../document-model";
import { alignFrames, distributeFrames, framesInSelection, framesIntersect, unionFrame } from "./arrange";

function rect(x: number, y: number, width: number, height: number): RectEmu {
  return { x: emu(x), y: emu(y), width: emu(width), height: emu(height) };
}

describe("arrange geometry", () => {
  it("takes the outer bounds of a group", () => {
    const bounds = unionFrame([
      rect(inches(1), inches(2), inches(1), inches(1)),
      rect(inches(4), inches(0.5), inches(2), inches(1)),
    ]);
    expect(bounds).toEqual(rect(inches(1), inches(0.5), inches(5), inches(2.5)));
  });

  it("returns nothing for an empty group", () => {
    expect(unionFrame([])).toBeUndefined();
  });

  it("aligns to the group bounds, not to the page", () => {
    const frames = [rect(inches(1), inches(1), inches(1), inches(1)), rect(inches(3), inches(4), inches(2), inches(1))];
    const reference = unionFrame(frames)!;
    const aligned = alignFrames(frames, reference, { horizontal: "left" });
    expect(aligned[0]!.x).toBe(reference.x);
    expect(aligned[1]!.x).toBe(reference.x);
    // The vertical axis stays untouched when only one direction is asked for.
    expect(aligned[0]!.y).toBe(frames[0]!.y);
    expect(aligned[1]!.y).toBe(frames[1]!.y);
  });

  it("aligns the right edges to the group right edge", () => {
    const frames = [rect(inches(1), inches(1), inches(1), inches(1)), rect(inches(3), inches(4), inches(2), inches(1))];
    const reference = unionFrame(frames)!;
    const aligned = alignFrames(frames, reference, { horizontal: "right" });
    expect(aligned[0]!.x + aligned[0]!.width).toBe(reference.x + reference.width);
    expect(aligned[1]!.x + aligned[1]!.width).toBe(reference.x + reference.width);
  });

  it("centers every element on the group center line", () => {
    const frames = [rect(inches(1), inches(1), inches(1), inches(1)), rect(inches(3), inches(4), inches(2), inches(1))];
    const reference = unionFrame(frames)!;
    const aligned = alignFrames(frames, reference, { horizontal: "center" });
    const center = reference.x + Math.round(reference.width / 2);
    for (const frame of aligned) {
      expect(frame.x + Math.round(frame.width / 2)).toBe(center);
    }
  });

  it("keeps the two ends fixed and spaces the middle evenly", () => {
    const frames = [
      rect(inches(0), inches(0), inches(1), inches(1)),
      rect(inches(1.5), inches(0), inches(1), inches(1)),
      rect(inches(5), inches(0), inches(1), inches(1)),
    ];
    const distributed = distributeFrames(frames, "horizontal");
    expect(distributed[0]!.x).toBe(frames[0]!.x);
    expect(distributed[2]!.x).toBe(frames[2]!.x);
    const gapLeft = distributed[1]!.x - (distributed[0]!.x + distributed[0]!.width);
    const gapRight = distributed[2]!.x - (distributed[1]!.x + distributed[1]!.width);
    expect(gapLeft).toBe(gapRight);
  });

  it("does not distribute fewer than three elements", () => {
    const frames = [rect(inches(0), inches(0), inches(1), inches(1)), rect(inches(4), inches(0), inches(1), inches(1))];
    expect(distributeFrames(frames, "horizontal")).toEqual(frames);
  });

  it("counts overlapping frames as selected", () => {
    expect(
      framesIntersect(
        rect(inches(0), inches(0), inches(1), inches(1)),
        rect(inches(0.5), inches(0.5), inches(1), inches(1)),
      ),
    ).toBe(true);
    expect(
      framesIntersect(
        rect(inches(0), inches(0), inches(1), inches(1)),
        rect(inches(2), inches(2), inches(1), inches(1)),
      ),
    ).toBe(false);
  });

  it("selects every element the marquee touches", () => {
    const elements = [
      { id: "a" as ElementId, frame: rect(inches(1), inches(1), inches(1), inches(1)) },
      { id: "b" as ElementId, frame: rect(inches(5), inches(5), inches(1), inches(1)) },
    ];
    expect(framesInSelection(elements, rect(inches(0), inches(0), inches(2), inches(2)))).toEqual(["a"]);
    expect(framesInSelection(elements, rect(inches(0), inches(0), inches(10), inches(10)))).toEqual(["a", "b"]);
  });
});
