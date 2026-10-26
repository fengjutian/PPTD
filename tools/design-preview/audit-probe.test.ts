import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPptx } from "../../src/features/pptx-export/export-pptx";
import { buildDesignPreviewDocument } from "./fixture";

describe("contact sheet probe", () => {
  it("writes the current ten-page deck", async () => {
    const result = await buildPptx(buildDesignPreviewDocument(), { prevalidatedIssues: [] });
    writeFileSync(".tmp/audit.pptx", result.bytes);
    expect(result.report.slideCount).toBe(10);
  }, 60_000);
});
