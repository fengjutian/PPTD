import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/core/commands";
import { createDocument } from "../../src/core/document-model";
import { buildPptx } from "../../src/features/pptx-export/export-pptx";
import { detectRasterizer } from "./rasterizer";

const SCRIPT = fileURLToPath(new URL("./check-animation.ps1", import.meta.url));

/**
 * PowerPoint is the only judge of whether a timing tree is usable.
 *
 * The regular unit tests prove the shape of the XML; this probe opens the file
 * in PowerPoint and asks how many effects the timeline actually has. It is
 * part of `npm run test:visual`, because it needs the same application the
 * visual baselines need. Without PowerPoint it skips instead of pretending to
 * pass.
 */
describe("native animation in PowerPoint", () => {
  it("opens and reports the effects written by the exporter", async (context) => {
    const rasterizer = await detectRasterizer();
    if (!rasterizer || rasterizer.name !== "powerpoint") {
      context.skip();
      return;
    }

    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-text", slideId: slide.id });
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "rectangle" });
    const [title, text, shape] = slide.elements;
    applyCommand(document, {
      type: "add-animation",
      slideId: slide.id,
      elementId: title!.id,
      animation: { effect: "fade", start: "on-click", durationMs: 500, delayMs: 0, direction: "none" },
    });
    applyCommand(document, {
      type: "add-animation",
      slideId: slide.id,
      elementId: text!.id,
      animation: { effect: "fly-in", start: "after-previous", durationMs: 700, delayMs: 100, direction: "left" },
    });
    applyCommand(document, {
      type: "add-animation",
      slideId: slide.id,
      elementId: shape!.id,
      animation: { effect: "wipe", start: "on-click", durationMs: 400, delayMs: 0, direction: "right" },
    });
    applyCommand(document, {
      type: "set-slide-transition",
      slideId: slide.id,
      transition: { kind: "fade", speed: "fast" },
    });

    const result = await buildPptx(document);
    const directory = mkdtempSync(join(tmpdir(), "pptd-animation-"));
    const path = join(directory, "probe.pptx");
    writeFileSync(path, result.bytes);

    // PowerPoint's COM server occasionally refuses a second client when the
    // suite runs in parallel. That is a transient failure, not a missing
    // animation: retry once before calling it a regression.
    const readEffects = () =>
      execFileSync(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Pptx", path],
        { encoding: "utf8", timeout: 180_000 },
      );
    let output: string;
    try {
      output = readEffects();
    } catch {
      output = readEffects();
    }
    expect(output).toContain("slides=1");
    expect(output).toContain("effects=3");
  }, 180_000);
});
