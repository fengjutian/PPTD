import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  isTauri: () => true,
}));

const { clearVisionCapabilityCache, probeVisionCapability } = await import("./ai-vision");

describe("vision capability probe", () => {
  beforeEach(() => {
    invoke.mockReset();
    clearVisionCapabilityCache();
  });

  it("caches a positive answer for the provider and model", async () => {
    invoke.mockResolvedValue(true);
    await expect(probeVisionCapability("minimax", "MiniMax-M3")).resolves.toBe(true);
    await expect(probeVisionCapability("minimax", "MiniMax-M3")).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps visual review enabled when the probe itself fails", async () => {
    invoke.mockRejectedValue(new Error("AI_VISION_REQUEST_FAILED: offline"));
    await expect(probeVisionCapability("minimax", "MiniMax-M3")).resolves.toBe(true);
  });

  it("disables visual review when the model rejects images", async () => {
    invoke.mockResolvedValue(false);
    await expect(probeVisionCapability("minimax", "text-only")).resolves.toBe(false);
  });
});
