import { describe, expect, it } from "vitest";

import type { AiSlideDesign } from "../core/commands";
import { buildPreviewAssets, previewAssetRole, previewPlaceholderDataUrl } from "./preview-placeholder";

const design = (overrides: Partial<AiSlideDesign> = {}): AiSlideDesign => ({
  layout: "title-body",
  background: "#FFFFFF",
  accent: "#2563EB",
  titleColor: "#0B1F3A",
  bodyColor: "#5B6B7F",
  ...overrides,
});

describe("preview placeholders", () => {
  it("stands in for the picture slots the design asked for", () => {
    const assets = buildPreviewAssets([
      design({ layout: "cover", visualAsset: { enabled: true, role: "hero" } }),
      design({ layout: "title-body" }),
      design({ layout: "title-body", visualAsset: { enabled: true, role: "side" } }),
    ]);
    // A page that asked for no picture keeps no slot: the real deck will not
    // have one either.
    expect(assets.map((asset) => asset.slideIndex)).toEqual([0, 2]);
    expect(assets[0]?.altText).toContain("配图占位");
  });

  it("uses the shape the command layer reserves for the role", () => {
    const [hero] = buildPreviewAssets([design({ layout: "cover", visualAsset: { enabled: true, role: "side" } })]);
    // A cover promotes any request to the hero slot.
    expect(previewAssetRole(design({ layout: "cover" }))).toBe("hero");
    expect(hero!.naturalWidth / hero!.naturalHeight).toBeCloseTo(4 / 3, 2);

    const [band] = buildPreviewAssets([design({ visualAsset: { enabled: true, role: "band" } })]);
    expect(band!.naturalWidth / band!.naturalHeight).toBeCloseTo(4, 2);
  });

  it("is a real PNG that can be decoded by the renderer", () => {
    const url = previewPlaceholderDataUrl("side");
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    const bytes = Buffer.from(url.split(",")[1]!, "base64");
    // PNG signature: a renderer that cannot decode the stand-in would draw the
    // empty half-page this module exists to prevent.
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // Generated once and reused across cards.
    expect(previewPlaceholderDataUrl("side")).toBe(url);
  });
});
