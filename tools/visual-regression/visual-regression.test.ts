import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { buildPptx } from "../../src/features/pptx-export/export-pptx";
import { decodePng, encodePng } from "../../src/core/rendering/png";
import { evaluateVisualRegression, type VisualRegressionPolicy } from "../../src/core/rendering/visual-regression";
import { visualRegressionFixture } from "./fixture";
import { detectRasterizer, type PptxRasterizer } from "./rasterizer";

/**
 * The visual regression check of the export.
 *
 * The deck is exported, the file is rendered by a real application, and the
 * pictures are compared with the reference of the same renderer. A difference
 * that is bigger than the noise of the renderer is a regression: something in
 * the exporter changed the way the deck looks.
 *
 * The references belong to the machine that produced them. Another renderer, a
 * different PowerPoint version or a missing font produces a different picture,
 * so each renderer keeps its own folder of references.
 */

const BASELINE_ROOT = fileURLToPath(new URL("./baseline/", import.meta.url));
const POLICY: VisualRegressionPolicy = { channelTolerance: 8, maxChangedRatio: 0.002 };
const UPDATE_BASELINE = process.env.PPTD_VISUAL_BASELINE === "update";

let rasterizer: PptxRasterizer | undefined;

beforeAll(async () => {
  rasterizer = await detectRasterizer();
});

describe("导出视觉回归", () => {
  it("导出的页面与参考图一致", async (context) => {
    if (!rasterizer) {
      context.skip();
      return;
    }

    const workDirectory = join(tmpdir(), `pptd-visual-${process.pid}-${Date.now()}`);
    mkdirSync(workDirectory, { recursive: true });
    const baselineDirectory = join(BASELINE_ROOT, rasterizer.name);
    mkdirSync(baselineDirectory, { recursive: true });

    const { bytes } = await buildPptx(visualRegressionFixture());
    const pptxPath = join(workDirectory, "visual-regression.pptx");
    writeFileSync(pptxPath, bytes);

    const slides = await rasterizer.rasterize(pptxPath, join(workDirectory, "rendered"));
    expect(slides.length).toBeGreaterThan(0);

    const problems: string[] = [];
    const created: string[] = [];

    for (const slide of slides) {
      const baselinePath = join(baselineDirectory, `slide-${slide.index}.png`);
      if (!existsSync(baselinePath) || UPDATE_BASELINE) {
        writeFileSync(baselinePath, slide.png);
        created.push(baselinePath);
        continue;
      }
      const outcome = evaluateVisualRegression(decodePng(slide.png), decodePng(new Uint8Array(readFileSync(baselinePath))), {
        policy: POLICY,
        includeDiffImage: true,
      });
      if (outcome.status === "match") continue;
      problems.push(`第 ${slide.index} 页：${outcome.message}`);
      if (outcome.diff) {
        const diffPath = join(workDirectory, `diff-slide-${slide.index}.png`);
        writeFileSync(diffPath, encodePng(outcome.diff));
        problems.push(`差异图：${diffPath}`);
      }
    }

    if (created.length > 0) {
      throw new Error(`参考图已建立，请检查后提交并在再次运行时确认一致：\n${created.join("\n")}`);
    }
    expect(problems.join("\n")).toBe("");
  });
});
