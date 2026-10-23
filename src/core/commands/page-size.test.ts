import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import {
  createDocument,
  emu,
  inches,
  matchPageSizePreset,
  pageSizeFromInches,
  PAGE_SIZE_PRESETS,
} from "../document-model";

describe("set-page-size", () => {
  it("changes the page as a design change and leaves copy and objects alone", () => {
    const source = createDocument();
    const contentBefore = JSON.stringify(source.slides[0]!.content);
    const framesBefore = source.slides[0]!.elements.map((element) => ({ ...element.frame }));
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "set-page-size", pageSize: pageSizeFromInches(10, 7.5)! }),
    );
    expect(result.pageSize).toEqual(pageSizeFromInches(10, 7.5));
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
    expect(result.slides[0]!.elements.map((element) => element.frame)).toEqual(framesBefore);
    expect(commandDomain({ type: "set-page-size", pageSize: pageSizeFromInches(10, 7.5)! })).toBe("design");
  });

  it("scales frames, type and strokes only when the caller opts in", () => {
    const source = createDocument();
    const title = source.slides[0]!.elements[0]!;
    if (title.type !== "text") throw new Error("expected text");
    title.style.fontSizePt = 28;
    title.style.letterSpacingPt = 1;
    const contentBefore = JSON.stringify(source.slides[0]!.content);
    const target = pageSizeFromInches(10, 7.5)!;
    const scaleX = target.width / source.pageSize.width;
    const scaleY = target.height / source.pageSize.height;
    const typeScale = Math.min(scaleX, scaleY);

    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "set-page-size", pageSize: target, scaleObjects: true }),
    );
    const scaled = result.slides[0]!.elements[0]!;
    expect(scaled.frame.x).toBe(emu(Math.round(inches(0.75) * scaleX)));
    expect(scaled.frame.y).toBe(emu(Math.round(inches(0.65) * scaleY)));
    expect(scaled.frame.width).toBe(emu(Math.round(inches(7.5) * scaleX)));
    expect(scaled.frame.height).toBe(emu(Math.round(inches(0.8) * scaleY)));
    expect(scaled.type === "text" ? scaled.style.fontSizePt : 0).toBeCloseTo(28 * typeScale, 2);
    expect(scaled.type === "text" ? scaled.style.letterSpacingPt : 0).toBeCloseTo(1 * typeScale, 2);
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
    expect(commandDomain({ type: "set-page-size", pageSize: target, scaleObjects: true })).toBe("design");
  });

  it("scales table typography with the page but leaves the cells alone", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    applyCommand(source, { type: "add-table", slideId: slide.id, columns: 2, rows: 1 });
    const table = slide.elements.find((element) => element.type === "table");
    if (table?.type !== "table") throw new Error("expected table");
    table.style.fontSizePt = 14;
    const block = slide.content.blocks!.find((candidate) => candidate.id === table.contentBlockId);
    if (block?.type !== "table-data") throw new Error("expected table block");
    block.header[0] = "原样保留";
    const contentBefore = JSON.stringify(slide.content);

    const target = pageSizeFromInches(10, 7.5)!;
    const typeScale = Math.min(target.width / source.pageSize.width, target.height / source.pageSize.height);
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "set-page-size", pageSize: target, scaleObjects: true }),
    );
    const scaled = result.slides[0]!.elements.find((element) => element.type === "table");
    expect(scaled?.type === "table" ? scaled.style.fontSizePt : 0).toBeCloseTo(14 * typeScale, 2);
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
  });

  it("rejects sizes PowerPoint could not open", () => {
    const source = createDocument();
    for (const pageSize of [
      { width: inches(0.5), height: inches(7.5) },
      { width: inches(57), height: inches(7.5) },
      { width: inches(10), height: inches(0.5) },
      { width: emu(inches(10)), height: emu(inches(7.5)) + 0.5 },
    ]) {
      expect(() =>
        produce(source, (draft) =>
          applyCommand(draft, {
            type: "set-page-size",
            pageSize: pageSize as { width: never; height: never },
          }),
        ),
      ).toThrow("INVALID_PAGE_SIZE");
    }
  });

  it("matches the built-in presets only on the exact size", () => {
    expect(matchPageSizePreset(pageSizeFromInches(13.333, 7.5)!)).toMatchObject({ id: "16:9" });
    expect(matchPageSizePreset(pageSizeFromInches(10, 7.5)!)).toMatchObject({ id: "4:3" });
    expect(matchPageSizePreset(pageSizeFromInches(13, 7.5)!)).toBeUndefined();
    expect(PAGE_SIZE_PRESETS).toHaveLength(3);
    // Fractional inches become whole EMU, never a fractional coordinate.
    const size = pageSizeFromInches(13.333, 7.5)!;
    expect(Number.isSafeInteger(size.width)).toBe(true);
    expect(Number.isSafeInteger(size.height)).toBe(true);
  });

  it("rejects non-finite input before it reaches the document", () => {
    expect(pageSizeFromInches(Number.NaN, 7.5)).toBeUndefined();
    expect(pageSizeFromInches(10, Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
