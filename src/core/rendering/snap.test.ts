import { describe, expect, it } from "vitest";
import { EMU_PER_INCH, emu } from "../document-model";
import {
  buildSnapTargets,
  DEFAULT_GRID_SIZE,
  gridTargets,
  resizeEdgesOf,
  snapAnchors,
  snapMovingFrame,
  snapPosition,
  snapResizedFrame,
  TARGET_TIER,
} from "./snap";

const inch = (value: number) => emu(value * EMU_PER_INCH);

describe("snap targets", () => {
  it("lays out grid lines from the page origin", () => {
    const targets = gridTargets(inch(1), inch(0.25));
    expect(targets.map((target) => target.position)).toEqual([0, inch(0.25), inch(0.5), inch(0.75), inch(1)]);
    expect(targets.every((target) => target.tier === TARGET_TIER.grid)).toBe(true);
  });

  it("produces no grid line when the grid snapping is switched off", () => {
    const targets = buildSnapTargets({
      gridSnapEnabled: false,
      gridSize: DEFAULT_GRID_SIZE,
      pageWidth: inch(10),
      pageHeight: inch(5),
      guides: [],
    });
    // 只剩页面中线。
    expect(targets.x).toHaveLength(1);
    expect(targets.x[0]!.position).toBe(inch(5));
  });

  it("keeps the page centre available even without a grid", () => {
    const targets = buildSnapTargets({
      gridSnapEnabled: false,
      gridSize: DEFAULT_GRID_SIZE,
      pageWidth: inch(10),
      pageHeight: inch(5),
      guides: [],
    });
    expect(targets.y[0]!.position).toBe(inch(2.5));
    expect(targets.y[0]!.tier).toBe(TARGET_TIER.center);
  });

  it("lets a guide win over the page centre even when the centre is closer", () => {
    const targets = buildSnapTargets({
      gridSnapEnabled: false,
      gridSize: DEFAULT_GRID_SIZE,
      pageWidth: inch(10),
      pageHeight: inch(5),
      guides: [{ axis: "x", position: inch(3.2) }],
    });
    // 指针在 3.1：页面中线 5.0 更远，但参考线层级更高。
    const hit = snapPosition(inch(3.1), targets.x, inch(0.3));
    expect(hit?.tier).toBe(TARGET_TIER.guide);
    expect(hit?.position).toBe(inch(3.2));
  });

  it("lets the page centre win over the dense grid", () => {
    const targets = buildSnapTargets({
      gridSnapEnabled: true,
      gridSize: inch(0.1),
      pageWidth: inch(10),
      pageHeight: inch(5),
      guides: [],
    });
    // 网格线每 0.1 英寸一条，几乎处处都有；页面中线必须压过它。
    const hit = snapPosition(inch(5.001), targets.x, inch(0.3));
    expect(hit?.tier).toBe(TARGET_TIER.center);
    expect(hit?.position).toBe(inch(5));
  });
});

describe("snap position", () => {
  it("does not snap beyond the threshold", () => {
    const hit = snapPosition(inch(1.5), [{ position: inch(1), tier: TARGET_TIER.grid }], inch(0.2));
    expect(hit).toBeUndefined();
  });

  it("snaps to the nearest line inside the threshold", () => {
    const hit = snapPosition(inch(1.05), [{ position: inch(1), tier: TARGET_TIER.grid }], inch(0.2));
    expect(hit?.position).toBe(inch(1));
    expect(hit?.delta).toBeCloseTo(-inch(0.05), 3);
  });

  it("picks the closest of several lines of the same tier", () => {
    const hit = snapPosition(
      inch(1.06),
      [
        { position: inch(1), tier: TARGET_TIER.grid },
        { position: inch(1.08), tier: TARGET_TIER.grid },
      ],
      inch(0.2),
    );
    expect(hit?.position).toBe(inch(1.08));
  });
});

describe("snap anchors", () => {
  it("snaps the centre anchor so an object can be centred on a line", () => {
    const targets = [{ position: inch(5), tier: TARGET_TIER.center }];
    // 中心 5.05 离目标线最近，吸附应当用中心这条锚点。
    const frame = { x: inch(4.9), y: inch(0), width: inch(0.3), height: inch(1) };
    const hit = snapAnchors([frame.x, frame.x + frame.width / 2, frame.x + frame.width], targets, inch(0.2));
    expect(hit?.target).toBe(inch(5));
    expect(hit?.delta).toBeCloseTo(-inch(0.05), 3);
  });

  it("uses the edge anchor when the edge is closer to the line", () => {
    const targets = [{ position: inch(5), tier: TARGET_TIER.center }];
    // 右边缘 4.9 离目标线 0.1，中心 4.8 离 0.2：边缘更近，边缘胜出。
    const frame = { x: inch(4.7), y: inch(0), width: inch(0.2), height: inch(1) };
    const hit = snapAnchors([frame.x, frame.x + frame.width / 2, frame.x + frame.width], targets, inch(0.2));
    expect(hit?.delta).toBeCloseTo(inch(0.1), 3);
  });
});

describe("snap moving frame", () => {
  const targets = buildSnapTargets({
    gridSnapEnabled: false,
    gridSize: DEFAULT_GRID_SIZE,
    pageWidth: inch(10),
    pageHeight: inch(5),
    guides: [],
  });

  it("moves the frame so its centre lands on the page centre line", () => {
    const frame = { x: inch(4.4), y: inch(1), width: inch(1), height: inch(1) };
    const snapped = snapMovingFrame(frame, targets, inch(0.3));
    expect(snapped.frame.x).toBe(inch(4.5));
    expect(snapped.hitX).toBe(inch(5));
    // 尺寸不变，吸附只移动位置。
    expect(snapped.frame.width).toBe(frame.width);
  });

  it("snaps the nearer edge when the edge is closer than the centre", () => {
    const frame = { x: inch(4.85), y: inch(1), width: inch(1), height: inch(1) };
    const snapped = snapMovingFrame(frame, targets, inch(0.3));
    // 左边缘 4.85 离中线 5.0 更近，所以左边缘贴上去。
    expect(snapped.frame.x).toBe(inch(5));
    expect(snapped.hitX).toBe(inch(5));
  });

  it("leaves the frame alone when nothing is within reach", () => {
    const frame = { x: inch(1.234), y: inch(1.234), width: inch(1), height: inch(1) };
    const snapped = snapMovingFrame(frame, targets, inch(0.01));
    expect(snapped.frame.x).toBe(frame.x);
    expect(snapped.frame.y).toBe(frame.y);
    expect(snapped.hitX).toBeUndefined();
  });
});

describe("snap resized frame", () => {
  const targets = buildSnapTargets({
    gridSnapEnabled: false,
    gridSize: DEFAULT_GRID_SIZE,
    pageWidth: inch(10),
    pageHeight: inch(5),
    guides: [],
  });

  it("snaps only the dragged edge and keeps the opposite edge still", () => {
    const frame = { x: inch(1), y: inch(1), width: inch(3.85), height: inch(2) };
    const snapped = snapResizedFrame(frame, { east: true }, targets, inch(0.3));
    // 右边缘贴到页面中线 5.0，左边缘仍在 1.0。
    expect(snapped.frame.x).toBe(inch(1));
    expect(snapped.frame.width).toBe(inch(4));
  });

  it("keeps the right edge still when the left edge is dragged", () => {
    const frame = { x: inch(4.8), y: inch(1), width: inch(2), height: inch(2) };
    const snapped = snapResizedFrame(frame, { west: true }, targets, inch(0.3));
    expect(snapped.frame.x).toBe(inch(5));
    expect(snapped.frame.x + snapped.frame.width).toBe(inch(6.8));
  });

  it("never collapses the frame when snapping the west edge", () => {
    const frame = { x: inch(5.2), y: inch(1), width: inch(1), height: inch(2) };
    const snapped = snapResizedFrame(frame, { west: true }, targets, inch(0.3));
    expect(snapped.frame.width).toBeGreaterThan(0);
  });
});

describe("resize edges", () => {
  it("maps a direction to the edges it moves", () => {
    expect(resizeEdgesOf("se")).toEqual({ west: false, east: true, north: false, south: true });
    expect(resizeEdgesOf("nw")).toEqual({ west: true, east: false, north: true, south: false });
    expect(resizeEdgesOf("n")).toEqual({ west: false, east: false, north: true, south: false });
  });
});
