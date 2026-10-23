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
