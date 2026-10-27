/**
 * 把一张图放进一个框里需要多少裁剪。
 *
 * 生成出来的图有自己的宽高比，页面上的框有另一个。直接把图拉满框会让
 * 人脸变胖、几何图形变形——这是"AI 配图一眼假"最常见的来源。
 *
 * 正确做法是裁剪：把图按框的比例切掉多余的部分，露出来的部分正好铺满框。
 * 这和 PowerPoint 的"填充"裁剪是同一件事，导出器写的就是这个矩形。
 */

import type { ImageCrop } from "../document-model";

/** 一个归一化的矩形。 */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 算出"填充"裁剪：图铺满框，多余部分被切掉。
 *
 * 裁剪量是相对原图的比例。宽图放进窄框时切掉左右，高图放进扁框时切掉
 * 上下，切掉的量相等，图因此不变形。
 */
export function coverCrop(
  natural: { width: number; height: number },
  target: { width: number; height: number },
  focalPoint: { x: number; y: number } = { x: 0.5, y: 0.5 },
): ImageCrop | undefined {
  if (natural.width <= 0 || natural.height <= 0 || target.width <= 0 || target.height <= 0) return undefined;
  const naturalAspect = natural.width / natural.height;
  const targetAspect = target.width / target.height;
  // 比例相同就没有要切的部分。
  if (Math.abs(naturalAspect - targetAspect) < 1e-6) return undefined;
  if (naturalAspect > targetAspect) {
    // 图更宽：切掉左右，两边各切一半。
    const keep = targetAspect / naturalAspect;
    const left = Math.max(0, Math.min(1 - keep, focalPoint.x - keep / 2));
    return { top: 0, bottom: 0, left, right: 1 - keep - left };
  }
  // 图更高：切掉上下。
  const keep = naturalAspect / targetAspect;
  const top = Math.max(0, Math.min(1 - keep, focalPoint.y - keep / 2));
  return { top, bottom: 1 - keep - top, left: 0, right: 0 };
}

/**
 * 图在框里的可见区域。
 *
 * 裁剪之后露出来的那一块在原图里的位置。画布渲染和导出用同一个结果，
 * 所以屏幕上看到的和 PowerPoint 里打开的是同一张图。
 */
export function visibleSourceRect(
  natural: { width: number; height: number },
  crop: ImageCrop | undefined,
): NormalizedRect {
  const left = crop?.left ?? 0;
  const right = crop?.right ?? 0;
  const top = crop?.top ?? 0;
  const bottom = crop?.bottom ?? 0;
  return {
    x: left,
    y: top,
    width: Math.max(0, 1 - left - right),
    height: Math.max(0, 1 - top - bottom),
  };
}
