import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, emu, type ImageElement } from "../core/document-model";
import { resolveDocumentImages, resolveImageUrl, setImageProjectPath, subscribeImageProjectPath } from "./image-url-service";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));

const invokeMock = vi.mocked(invoke);

function imageElement(reference: string): ImageElement {
  return {
    id: crypto.randomUUID() as ImageElement["id"],
    type: "image",
    frame: { x: emu(0), y: emu(0), width: emu(914_400), height: emu(914_400) },
    rotationMilliDegree: 0,
    locked: false,
    source: { kind: "embedded", dataUrl: reference, mimeType: "image/png" },
    altText: "模板版式背景",
  };
}

describe("图片资源的解析", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setImageProjectPath(undefined);
  });

  it("还不知道项目路径时不把引用交给浏览器", async () => {
    const url = await resolveImageUrl("asset://a.png");

    // 引用不是浏览器能加载的地址，交出去就会画出一个破图图标。
    expect(url).toBeUndefined();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("知道项目路径后读出图片", async () => {
    invokeMock.mockResolvedValue("data:image/png;base64,AA==");
    setImageProjectPath("C:/p.pptd");

    const url = await resolveImageUrl("asset://b.png");

    expect(url).toBe("data:image/png;base64,AA==");
    expect(invokeMock).toHaveBeenCalledWith("read_image_asset", {
      projectPath: "C:/p.pptd",
      reference: "asset://b.png",
    });
  });

  it("内联的图片直接可用", async () => {
    const url = await resolveImageUrl("data:image/png;base64,BB==");

    expect(url).toBe("data:image/png;base64,BB==");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("同一张图片只读一次", async () => {
    invokeMock.mockResolvedValue("data:image/png;base64,AA==");
    setImageProjectPath("C:/p.pptd");

    const [first, second] = await Promise.all([
      resolveImageUrl("asset://c.png"),
      resolveImageUrl("asset://c.png"),
    ]);

    expect(first).toBe("data:image/png;base64,AA==");
    expect(second).toBe("data:image/png;base64,AA==");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("项目路径到达后通知订阅者重新解析", () => {
    const changes: number[] = [];
    const unsubscribe = subscribeImageProjectPath(() => changes.push(changes.length));

    setImageProjectPath("C:/q.pptd");
    setImageProjectPath("C:/q.pptd");
    expect(changes).toHaveLength(1);

    unsubscribe();
    setImageProjectPath("C:/r.pptd");
    expect(changes).toHaveLength(1);
  });

  it("导出时读不到图片就报错，而不是把引用塞进文件", async () => {
    const document = createDocument();
    document.slides[0]!.elements.push(imageElement("asset://d.png"));

    await expect(resolveDocumentImages(document)).rejects.toThrow("IMAGE_ASSET_UNAVAILABLE");
  });

  it("导出时把引用换成内联图片", async () => {
    invokeMock.mockResolvedValue("data:image/png;base64,AA==");
    setImageProjectPath("C:/p.pptd");
    const document = createDocument();
    document.slides[0]!.elements.push(imageElement("asset://e.png"));

    const resolved = await resolveDocumentImages(document);

    const image = resolved.slides[0]!.elements.at(-1);
    expect(image?.type === "image" && image.source.dataUrl).toBe("data:image/png;base64,AA==");
  });
});
