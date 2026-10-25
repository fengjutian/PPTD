/**
 * Geometry shared by the chart painter and its tests.
 *
 * The visual review draws charts on a canvas, so the plot has to reserve room
 * for axis labels and value labels. Keeping the arithmetic here means a bar can
 * never be painted above its own plot area just because the code subtracted the
 * plot height twice.
 */

export interface ChartPlotArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface ChartDomain {
  min: number;
  max: number;
  step: number;
}

/**
 * The drawing area of a vertical chart.
 *
 * The left gutter holds the value labels, the top gutter holds value labels of
 * the highest point, and the bottom gutter holds the category labels.
 */
export function chartPlotArea(width: number, height: number, fontSize: number): ChartPlotArea {
  const left = Math.min(width * 0.2, fontSize * 3.4);
  const right = Math.max(6, fontSize * 0.9);
  const top = fontSize * 1.9;
  const bottom = Math.max(top + 1, height - fontSize * 2.1);
  return {
    left,
    top,
    right: Math.max(left + 1, width - right),
    bottom,
    width: Math.max(1, width - left - right),
    height: Math.max(1, bottom - top),
  };
}

/**
 * A rounded domain with a readable step: 0..128 becomes 0..150 with three
 * steps, so the line does not touch the top of the plot and the labels are
 * round numbers instead of 42.7.
 */
export function niceChartDomain(min: number, max: number, tickCount = 3): ChartDomain {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1 };
  const lower = Math.min(min, 0);
  const upper = Math.max(max, lower + 1);
  const rawStep = (upper - lower) / Math.max(1, tickCount);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  const step = niceResidual * magnitude;
  return { min: Math.floor(lower / step) * step, max: Math.ceil(upper / step) * step, step };
}

/** The y of a value inside the plot; clamped so no mark can leave the plot. */
export function chartValueY(value: number, domain: ChartDomain, plot: ChartPlotArea): number {
  const span = domain.max - domain.min || 1;
  const ratio = (value - domain.min) / span;
  return plot.bottom - Math.max(0, Math.min(1, ratio)) * plot.height;
}
