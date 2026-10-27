import { describe, expect, it } from "vitest";

import { variantCanEnterGallery } from "./variant-quality-policy";

describe("variant quality policy", () => {
  it("keeps a candidate when only non-blocking layout audit findings remain", () => {
    expect(variantCanEnterGallery({ deterministicPassed: true, aestheticPassed: true })).toBe(true);
  });

  it("rejects deterministic or aesthetic failures", () => {
    expect(variantCanEnterGallery({ deterministicPassed: false, aestheticPassed: true })).toBe(false);
    expect(variantCanEnterGallery({ deterministicPassed: true, aestheticPassed: false })).toBe(false);
  });
});
