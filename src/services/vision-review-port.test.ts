import { describe, expect, it } from "vitest";
import { validateVisualRenderPayload } from "./vision-review-port";

describe("vision review payload", () => {
  it("accepts bounded JPEG slide renders", () => {
    expect(() => validateVisualRenderPayload({ slides: ["data:image/jpeg;base64,AA=="], contactSheet: "data:image/jpeg;base64,AA==" })).not.toThrow();
  });
  it("rejects unsupported image payloads and empty decks", () => {
    expect(() => validateVisualRenderPayload({ slides: [], contactSheet: "data:image/jpeg;base64,AA==" })).toThrow("AI_VISION_SLIDE_COUNT_INVALID");
    expect(() => validateVisualRenderPayload({ slides: ["data:image/png;base64,AA=="], contactSheet: "data:image/jpeg;base64,AA==" })).toThrow("AI_VISION_IMAGE_INVALID");
  });
});
