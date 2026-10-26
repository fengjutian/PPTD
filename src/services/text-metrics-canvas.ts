import type { TextMeasurer } from "../core/rendering/text-metrics";

/**
 * The measurer of the running application, built on the real installed font.
 *
 * The browser draws a text with the font it actually has, so measuring it the
 * same way tells the core how wide the text will really be. The width is
 * returned in em, so the size of the font does not change the result and the
 * same text can be measured once for every size it is tried at.
 */

const MEASURE_SIZE = 100;
const CACHE_LIMIT = 500;

function quoted(family: string): string {
  return `"${family.replace(/"/g, '\\"')}"`;
}

export function createCanvasTextMeasurer(): TextMeasurer | undefined {
  if (typeof document === "undefined") return undefined;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return undefined;
  const cache = new Map<string, number>();
  return {
    widthEm(text, fontFamily, bold = false) {
      if (!text) return 0;
      const key = `${bold ? "b" : "r"}\u0000${fontFamily}\u0000${text}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      // The weight belongs in the font string: a bold run is wider, and a title
      // measured with the regular face wrapped a word later in the file than in
      // the picture the reviewer approved.
      context.font = `${bold ? 700 : 400} ${MEASURE_SIZE}px ${quoted(fontFamily)}`;
      const width = context.measureText(text).width / MEASURE_SIZE;
      // The cache is only a speed-up, so it may drop old entries.
      if (cache.size >= CACHE_LIMIT) cache.clear();
      cache.set(key, width);
      return width;
    },
  };
}
