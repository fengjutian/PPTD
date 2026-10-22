import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parsePresentationDocument } from "./src/core/document-model/schema";

describe("recovery snapshot", () => {
  it("parses", () => {
    const raw = JSON.parse(
      readFileSync(`${process.env.APPDATA}\\com.pptd.desktop\\recovery\\latest.pptd`, "utf8"),
    );
    const parsed = parsePresentationDocument(raw);
    expect(parsed.slides.length).toBeGreaterThan(0);
  });
});
