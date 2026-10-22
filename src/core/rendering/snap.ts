/**
 * 网格与参考线的吸附计算。
 *
 * 网格和参考线是编辑器辅助元素：它们只存在于交互层，不进入文档模型，
 * 也不参与导出。吸附规则集中放在这里，画布和缩放预览用同一套算法，
 * 这样"屏幕上吸附到哪"和"导出后落在哪"不会各算各的。
 *
 * 所有坐标都是页面坐标（EMU）。屏幕像素只在换算阈值时出现。
 */

import { EMU_PER_INCH, emu, type RectEmu } from "../document-model";

/** 吸附目标所在的轴。x 轴目标是竖线，y 轴目标是横线。 */
export type SnapAxis = "x" | "y";

/**
 * 目标的层级。
 *
 * 层级比距离优先：用户亲手摆的参考线是明确的意图，哪怕页面中线离得更近，
 * 也应该先服从参考线。页面中线又比网格准——网格线很密，任何位置旁边都
 * 有一条网格线，如果按距离决胜，页面中线永远抢不过网格。
 */
export const TARGET_TIER = {
  grid: 1,
  center: 2,
  guide: 3,
} as const;

export type TargetTier = (typeof TARGET_TIER)[keyof typeof TARGET_TIER];

export interface SnapTarget {
  /** 目标在轴上的位置，EMU。 */
  position: number;
  /** 层级，见 TARGET_TIER。 */
  tier: TargetTier;
}

export interface AxisSnapResult {
  /** 吸附后的位置。 */
  position: number;
  /** 相对原位置的偏移量。 */
  delta: number;
  /** 命中的目标位置。 */
  target: number;
  /** 命中目标的层级。 */
  tier: TargetTier;
}

/** 两条候选线之间的最小可分辨距离（EMU）。 */
const EPSILON = 1;

/**
 * 把一个位置吸附到最近的候选线上。
 *
 * 阈值内才算命中，阈值外返回 undefined——超过阈值还硬贴上去，
 * 用户会以为画布卡住了。
 *
 * 先按层级挑：高层级里有候选就只用高层级的候选，再在同层级里挑最近的。
 */
export function snapPosition(
  position: number,
  targets: readonly SnapTarget[],
  threshold: number,
): AxisSnapResult | undefined {
  let best: AxisSnapResult | undefined;
  for (const target of targets) {
    const delta = target.position - position;
    const distance = Math.abs(delta);
    if (distance > threshold) continue;
    if (best) {
      // 层级高的直接赢，不再看距离。
      if (target.tier > best.tier) {
        best = { position: target.position, delta, target: target.position, tier: target.tier };
        continue;
      }
      if (target.tier < best.tier) continue;
    }
    // 同层级里更近的赢。
    if (!best || distance < Math.abs(best.delta) - EPSILON) {
      best = { position: target.position, delta, target: target.position, tier: target.tier };
    }
  }
  return best;
}

/**
 * 让一个框的若干锚点吸附到候选线上。
 *
 * 移动时用三条锚点（左、中心、右）参与吸附，这样对象贴到别的对象边缘
 * 或者页面中线上时都能对上。只吸附一条边会让居中对齐永远差一点。
 */
export function snapAnchors(
  anchors: readonly number[],
  targets: readonly SnapTarget[],
  threshold: number,
): AxisSnapResult | undefined {
  let best: AxisSnapResult | undefined;
  for (const anchor of anchors) {
    const hit = snapPosition(anchor, targets, threshold);
    if (!hit) continue;
    if (!best) {
      best = hit;
      continue;
    }
    if (hit.tier > best.tier) {
      best = hit;
      continue;
    }
    if (hit.tier < best.tier) continue;
    if (Math.abs(hit.delta) < Math.abs(best.delta) - EPSILON) best = hit;
  }
  return best;
}

/** 网格线的位置。网格从页面原点开始，间距由调用方给定。 */
export function gridTargets(pageExtent: number, gridSize: number): SnapTarget[] {
  if (gridSize <= 0) return [];
  const targets: SnapTarget[] = [];
  const count = Math.floor(pageExtent / gridSize);
  for (let index = 0; index <= count; index += 1) {
    targets.push({ position: Math.round(index * gridSize), tier: TARGET_TIER.grid });
  }
  return targets;
}

/** 把参考线转成吸附目标。 */
export function guideTargets(guides: readonly SnapGuide[], axis: SnapAxis): SnapTarget[] {
  return guides.filter((guide) => guide.axis === axis).map((guide) => ({ position: guide.position, tier: TARGET_TIER.guide }));
}

/**
 * 组装一页上所有可吸附的目标。
 *
 * 页面中线始终可用：把对象放在页面正中是最常见的排版动作，
 * 不应该要求用户先摆一条参考线。
 *
 * 网格线只在开启网格吸附时才参与——网格很密，不开吸附却参与比选，
 * 对象会被网格线切成碎片。
 */
export function buildSnapTargets(options: {
  gridSnapEnabled: boolean;
  gridSize: number;
  pageWidth: number;
  pageHeight: number;
  guides: readonly SnapGuide[];
}): { x: SnapTarget[]; y: SnapTarget[] } {
  const x: SnapTarget[] = [];
  const y: SnapTarget[] = [];
  if (options.gridSnapEnabled && options.gridSize > 0) {
    x.push(...gridTargets(options.pageWidth, options.gridSize));
    y.push(...gridTargets(options.pageHeight, options.gridSize));
  }
  x.push({ position: Math.round(options.pageWidth / 2), tier: TARGET_TIER.center });
  y.push({ position: Math.round(options.pageHeight / 2), tier: TARGET_TIER.center });
  x.push(...guideTargets(options.guides, "x"));
  y.push(...guideTargets(options.guides, "y"));
  return { x, y };
}

/**
 * 移动一个框时的吸附。
 *
 * 返回的是吸附后的整个框：命中某条线时整体平移，尺寸不变。
 */
export function snapMovingFrame(
  frame: RectEmu,
  targets: { x: readonly SnapTarget[]; y: readonly SnapTarget[] },
  threshold: number,
): { frame: RectEmu; hitX?: number; hitY?: number } {
  let x: number = frame.x;
  let y: number = frame.y;
  let hitX: number | undefined;
  let hitY: number | undefined;

  const horizontal = snapAnchors([frame.x, frame.x + frame.width / 2, frame.x + frame.width], targets.x, threshold);
  if (horizontal) {
    x = frame.x + horizontal.delta;
    hitX = horizontal.target;
  }
  const vertical = snapAnchors([frame.y, frame.y + frame.height / 2, frame.y + frame.height], targets.y, threshold);
  if (vertical) {
    y = frame.y + vertical.delta;
    hitY = vertical.target;
  }
  return { frame: { ...frame, x: emu(x), y: emu(y) }, hitX, hitY };
}

/** 缩放时会被拖动的边。 */
export interface ResizeEdges {
  west?: boolean;
  east?: boolean;
  north?: boolean;
  south?: boolean;
}

/**
 * 缩放一个框时的吸附。
 *
 * 只有被拖动的那条边参与吸附，被固定的边保持原位，这样对象不会在缩放
 * 过程中偷偷变形。
 */
export function snapResizedFrame(
  frame: RectEmu,
  edges: ResizeEdges,
  targets: { x: readonly SnapTarget[]; y: readonly SnapTarget[] },
  threshold: number,
): { frame: RectEmu; hitX?: number; hitY?: number } {
  let next = frame;
  let hitX: number | undefined;
  let hitY: number | undefined;

  if (edges.east) {
    const hit = snapPosition(frame.x + frame.width, targets.x, threshold);
    if (hit) {
      next = { ...next, width: emu(Math.max(1, hit.position - next.x)) };
      hitX = hit.target;
    }
  } else if (edges.west) {
    const hit = snapPosition(frame.x, targets.x, threshold);
    if (hit) {
      const right = frame.x + frame.width;
      next = { ...next, x: emu(hit.position), width: emu(Math.max(1, right - hit.position)) };
      hitX = hit.target;
    }
  }

  if (edges.south) {
    const hit = snapPosition(frame.y + frame.height, targets.y, threshold);
    if (hit) {
      next = { ...next, height: emu(Math.max(1, hit.position - next.y)) };
      hitY = hit.target;
    }
  } else if (edges.north) {
    const hit = snapPosition(frame.y, targets.y, threshold);
    if (hit) {
      const bottom = frame.y + frame.height;
      next = { ...next, y: emu(hit.position), height: emu(Math.max(1, bottom - hit.position)) };
      hitY = hit.target;
    }
  }

  return { frame: next, hitX, hitY };
}

/** 缩放方向到被拖动的边。 */
export function resizeEdgesOf(direction: string): ResizeEdges {
  return {
    west: direction.includes("w"),
    east: direction.includes("e"),
    north: direction.includes("n"),
    south: direction.includes("s"),
  };
}

/** 默认网格间距：0.1 英寸，和常见的排版栅格一致。 */
export const DEFAULT_GRID_SIZE = emu(0.1 * EMU_PER_INCH);

/** 吸附阈值（屏幕像素）。超过这个距离就不再吸附。 */
export const SNAP_THRESHOLD_PX = 8;
