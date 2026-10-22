import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rasterizePptxForReview } from "./pptx-rasterizer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));

const invokeMock = vi.mocked(invoke);

describe("真实 PPTX 栅格化", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("本机没有 PowerPoint 时如实报告不可用，而不是假装成功", async () => {
    invokeMock.mockRejectedValue("REVIEW_RASTERER_UNAVAILABLE:program not found");
    const outcome = await rasterizePptxForReview(new Uint8Array([0x50, 0x4b]));
    expect(outcome.status).toBe("unavailable");
    if (outcome.status === "unavailable") expect(outcome.reason).toContain("REVIEW_RASTERER_UNAVAILABLE");
  });

  it("空的文稿不会被送去渲染", async () => {
    const outcome = await rasterizePptxForReview(new Uint8Array());
    expect(outcome.status).toBe("unavailable");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("渲染器没有产出任何一页时如实报告不可用", async () => {
    invokeMock.mockResolvedValue([]);
    const outcome = await rasterizePptxForReview(new Uint8Array([0x50, 0x4b]));
    expect(outcome.status).toBe("unavailable");
    if (outcome.status === "unavailable") expect(outcome.reason).toBe("REVIEW_RASTER_EMPTY");
  });

  it("渲染器返回了不是数组的结果时如实报告不可用", async () => {
    invokeMock.mockResolvedValue("not-a-list");
    const outcome = await rasterizePptxForReview(new Uint8Array([0x50, 0x4b]));
    expect(outcome.status).toBe("unavailable");
  });

  it("把文稿当原始字节送出去，不转成 JSON 数组", async () => {
    invokeMock.mockResolvedValue([]);
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    await rasterizePptxForReview(bytes);
    expect(invokeMock).toHaveBeenCalledWith("rasterize_pptx_for_review", bytes);
  });
});
