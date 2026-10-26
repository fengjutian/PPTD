import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPptx } from "../../src/features/pptx-export/export-pptx";
import { buildVocabularyPreviewDocument } from "./fixture";

describe("tone probe", () => {
  it("writes the vocabulary deck", async () => {
    const result = await buildPptx(buildVocabularyPreviewDocument(), { prevalidatedIssues: [] });
    writeFileSync(".tmp/tone.pptx", result.bytes);
    expect(result.report.slideCount).toBe(4);
  }, 60_000);
});
