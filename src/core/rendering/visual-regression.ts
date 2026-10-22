import { comparePixels, type ChangedBounds, type PixelDiffOptions } from "./pixel-diff";
import type { PixelImage } from "./png";

/**
 * What counts as a regression.
 *
 * A renderer is not bit exact, so a few hundred pixels may always differ
 * without anything being wrong. The share of the picture that may change is
 * the line between noise and a real change.
 */
export interface VisualRegressionPolicy {
  /** How far a colour channel may drift before the pixel counts as changed. */
  channelTolerance: number;
  /** The share of the picture that may change before the rendering regressed. */
  maxChangedRatio: number;
}

export const defaultVisualRegressionPolicy: VisualRegressionPolicy = {
  channelTolerance: 8,
  maxChangedRatio: 0.002,
};

export type VisualRegressionStatus = "match" | "regressed" | "dimension-mismatch";

export interface VisualRegressionOutcome {
  status: VisualRegressionStatus;
  changedPixels: number;
  /** The share of the picture that changed, between 0 and 1. */
  changedRatio: number;
  /** The area that changed, when the two pictures have the same size. */
  bounds?: ChangedBounds;
  /** A picture that marks the changed pixels, when one was built. */
  diff?: PixelImage;
  /** What happened, in a sentence that can go straight into a report. */
  message: string;
}

export interface VisualRegressionOptions extends PixelDiffOptions {
  policy?: VisualRegressionPolicy;
}

/**
 * Decides whether a rendering still matches its reference.
 *
 * The reference is a picture of the same deck that was accepted before. A
 * difference is a regression only when it is bigger than the noise the
 * renderer produces by itself; a picture of a different size is always a
 * regression, because the layout changed.
 */
export function evaluateVisualRegression(
  current: PixelImage,
  baseline: PixelImage,
  options: VisualRegressionOptions = {},
): VisualRegressionOutcome {
  const policy = options.policy ?? defaultVisualRegressionPolicy;
  const diff = comparePixels(current, baseline, {
    channelTolerance: options.channelTolerance ?? policy.channelTolerance,
    includeDiffImage: options.includeDiffImage ?? false,
  });

  if (diff.kind === "dimension-mismatch") {
    return {
      status: "dimension-mismatch",
      changedPixels: diff.changedPixels,
      changedRatio: diff.changedRatio,
      diff: diff.diff,
      message: `画面尺寸变了：参考 ${baseline.width}×${baseline.height}，当前 ${current.width}×${current.height}`,
    };
  }

  if (diff.kind === "identical") {
    return {
      status: "match",
      changedPixels: 0,
      changedRatio: 0,
      diff: diff.diff,
      message: "与参考图一致",
    };
  }

  const percent = (diff.changedRatio * 100).toFixed(3);
  const limit = (policy.maxChangedRatio * 100).toFixed(3);
  const regressed = diff.changedRatio > policy.maxChangedRatio;
  return {
    status: regressed ? "regressed" : "match",
    changedPixels: diff.changedPixels,
    changedRatio: diff.changedRatio,
    bounds: diff.bounds,
    diff: diff.diff,
    message: regressed
      ? `${diff.changedPixels} 个像素与参考图不同（${percent}%，超过 ${limit}% 的容忍度）`
      : `${diff.changedPixels} 个像素与参考图不同（${percent}%，在 ${limit}% 的容忍度内）`,
  };
}
