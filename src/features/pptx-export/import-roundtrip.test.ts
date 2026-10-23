import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { importedDeckToDocument, type ImportedDeck } from "../../core/commands";
import { parsePresentationDocument, presentationDocumentSchema } from "../../core/document-model";
import fixture from "../../core/commands/__fixtures__/imported-deck-level-a.json";
import { buildPptx } from "./export-pptx";

describe("imported deck round trip", () => {
  it("maps, reopens and exports the same Level A content", async () => {
    const document = importedDeckToDocument(fixture as unknown as ImportedDeck);
    expect(() => presentationDocumentSchema.parse(document)).not.toThrow();
    expect(document.slides).toHaveLength(2);

    // Reopening a project parses the persisted document through the same
    // schema; this is the domain-level half of save → reopen.
    const reopened = parsePresentationDocument(JSON.parse(JSON.stringify(document)));
    expect(reopened.slides).toHaveLength(2);
    expect(reopened.slides[0]!.content.status).toBe("review");
    expect(reopened.slides[0]!.content.speakerNotes).toBe("第一页备注");
    expect(reopened.slides[0]!.content.blocks?.[0]).toMatchObject({
      type: "table-data",
      header: ["项目", "数值"],
    });

    const result = await buildPptx(reopened, { fontAvailable: () => true });
    expect(result.report.package.valid).toBe(true);
    const files = unzipSync(result.bytes);
    const presentationXml = strFromU8(files["ppt/presentation.xml"]!);
    expect((presentationXml.match(/<p:sldId /g) ?? []).length).toBe(2);
    const firstSlide = strFromU8(files["ppt/slides/slide1.xml"]!);
    expect(firstSlide).toContain("导入往返样例");
    expect(firstSlide).toContain("<a:tbl>");
    expect(Object.keys(files).some((name) => name.startsWith("ppt/media/"))).toBe(true);
    expect(result.report.issues.some((issue) => issue.code === "content-not-approved")).toBe(true);
    expect(result.report.issues.some((issue) => issue.severity === "error")).toBe(false);
  });
});
