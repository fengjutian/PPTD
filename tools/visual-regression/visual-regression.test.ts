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

/**
 * Starting PowerPoint through COM and rendering the deck costs far more than
 * the default timeouts of the test runner allow: on a cold machine the COM
 * handshake alone takes about eight seconds, and the export plus the rendering
 * adds tens of seconds on top of it. Without these limits the check would
 * always fail on its own timeout and would never compare a single picture.
 */
const RASTERIZER_TIMEOUT_MS = 240_000;
const VISUAL_TEST_TIMEOUT_MS = 240_000;

/**
 * The check needs a real presentation application. A build machine without one
 * cannot produce a meaningful reference, so the check is skipped there instead
 * of failing or silently passing.
 */
const SKIP_VISUAL = process.env.PPTD_SKIP_VISUAL === "1";

let rasterizer: PptxRasterizer | undefined;

beforeAll(async () => {
  if (SKIP_VISUAL) {
    console.warn("视觉回归已跳过：PPTD_SKIP_VISUAL=1，构建机没有可用的演示应用工具链。");
    return;
  }
  rasterizer = await detectRasterizer();
  if (!rasterizer) {
    console.warn("视觉回归已跳过：本机没有找到 PowerPoint 或 LibreOffice。");
  }
}, RASTERIZER_TIMEOUT_MS);

describe("导出视觉回归", () => {
  it(
    "导出的页面与参考图一致",
    async (context) => {
      if (SKIP_VISUAL || !rasterizer) {
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
        const outcome = evaluateVisualRegression(
          decodePng(slide.png),
          decodePng(new Uint8Array(readFileSync(baselinePath))),
          {
            policy: POLICY,
            includeDiffImage: true,
          },
        );
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
    },
    VISUAL_TEST_TIMEOUT_MS,
  );
});
