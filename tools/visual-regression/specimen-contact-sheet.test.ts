import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { CONCEPT_PRESET_IDS } from "../../src/core/design/deck-concept";
import { decodePng, encodePng } from "../../src/core/rendering/png";
import { evaluateVisualRegression, type VisualRegressionPolicy } from "../../src/core/rendering/visual-regression";
import { buildPptx } from "../../src/features/pptx-export/export-pptx";
import { buildSpecimenDocument, SPECIMEN_PAGE_COUNT } from "../../src/services/theme-specimen";
import { createContactSheet } from "./contact-sheet";
import { detectRasterizer, type PptxRasterizer } from "./rasterizer";

const BASELINE_ROOT = fileURLToPath(new URL("./baseline/specimens/", import.meta.url));
const UPDATE_BASELINE = process.env.PPTD_VISUAL_BASELINE === "update";
const SKIP_VISUAL = process.env.PPTD_SKIP_VISUAL === "1";
const POLICY: VisualRegressionPolicy = { channelTolerance: 8, maxChangedRatio: 0.002 };
const TIMEOUT_MS = 600_000;
let rasterizer: PptxRasterizer | undefined;

beforeAll(async () => {
  if (!SKIP_VISUAL) rasterizer = await detectRasterizer();
}, 240_000);

describe("概念方向八页样张 contact sheet", () => {
  for (const conceptPresetId of CONCEPT_PRESET_IDS) {
    it(
      `${conceptPresetId} 与已确认基线一致`,
      async (context) => {
        if (SKIP_VISUAL || !rasterizer || rasterizer.coverage !== "all") {
          context.skip();
          return;
        }
        const workDirectory = join(tmpdir(), `pptd-specimen-${conceptPresetId}-${process.pid}-${Date.now()}`);
        mkdirSync(workDirectory, { recursive: true });
        const { bytes } = await buildPptx(buildSpecimenDocument({ conceptPresetId }));
        const pptxPath = join(workDirectory, `${conceptPresetId}.pptx`);
        writeFileSync(pptxPath, bytes);
        const slides = await rasterizer.rasterize(pptxPath, join(workDirectory, "rendered"));
        expect(slides, `${conceptPresetId} 页数`).toHaveLength(SPECIMEN_PAGE_COUNT);

        const sheet = createContactSheet(
          slides.map((slide) => decodePng(slide.png)),
          {
            columns: 4,
            tileWidth: 400,
            tileHeight: 225,
            gap: 16,
          },
        );
        const png = encodePng(sheet);
        const baselineDirectory = join(BASELINE_ROOT, rasterizer.name);
        const baselinePath = join(baselineDirectory, `${conceptPresetId}.png`);
        mkdirSync(baselineDirectory, { recursive: true });
        if (!existsSync(baselinePath) || UPDATE_BASELINE) {
          writeFileSync(baselinePath, png);
          throw new Error(`样张基线已建立，请目视确认后重新运行：${baselinePath}`);
        }
        const outcome = evaluateVisualRegression(
          decodePng(png),
          decodePng(new Uint8Array(readFileSync(baselinePath))),
          {
            policy: POLICY,
            includeDiffImage: true,
          },
        );
        if (outcome.status !== "match" && outcome.diff) {
          const diffPath = join(workDirectory, `${conceptPresetId}-diff.png`);
          writeFileSync(diffPath, encodePng(outcome.diff));
          throw new Error(`${outcome.message}\n差异图：${diffPath}`);
        }
        expect(outcome.status).toBe("match");
      },
      TIMEOUT_MS,
    );
  }
});
