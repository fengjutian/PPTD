/**
 * 视口的缩放计算。
 *
 * 画布的缩放是一个纯几何问题：给定容器有多大、页面有多大，算出该用多少
 * 倍。放在 core 里是为了能脱离界面单独测——"适应窗口"写错时，测试应该
 * 直接抓到，而不是靠眼睛看画布。
 */

/** 画布周围必须留出的空白，屏幕像素。 */
export const FIT_MARGIN_PX = 48;

/** 视口缩放的下限和上限，和界面上的加减按钮一致。 */
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 3;

export interface FitViewportInput {
  /** 画布容器能用的宽度，屏幕像素。 */
  availableWidth: number;
  /** 画布容器能用的高度，屏幕像素。 */
  availableHeight: number;
  /** 页面宽度，页面坐标（EMU）。 */
  pageWidth: number;
  /** 页面高度，页面坐标（EMU）。 */
  pageHeight: number;
  /** 画布在页面上占的基准宽度，屏幕像素。 */
  baseWidth: number;
}

/**
 * 整页放进容器所需的缩放倍数。
 *
 * 宽度和高度都要放得下，取两者的较小值——只满足一个方向的话，页面还是
 * 会被裁掉。留出固定边距，免得页面正好贴住容器边缘。
 */
export function fitZoom(input: FitViewportInput): number {
  const { availableWidth, availableHeight, pageWidth, pageHeight, baseWidth } = input;
  if (availableWidth <= 0 || availableHeight <= 0 || pageWidth <= 0 || pageHeight <= 0 || baseWidth <= 0) {
    return 1;
  }
  const usableWidth = Math.max(availableWidth - FIT_MARGIN_PX * 2, 1);
  const usableHeight = Math.max(availableHeight - FIT_MARGIN_PX * 2, 1);
  // 基准画布宽 960 像素对应整个页宽，所以缩放倍数直接决定页面的屏幕尺寸。
  const byWidth = usableWidth / baseWidth;
  const pageHeightAtBase = (pageHeight / pageWidth) * baseWidth;
  const byHeight = usableHeight / pageHeightAtBase;
  const zoom = Math.min(byWidth, byHeight);
  // 向下取整到百分位：四舍五入会让页面刚好超出容器一点点，
  // 表现为底部被裁掉一条。
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.floor(zoom * 100) / 100));
}
