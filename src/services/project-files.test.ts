import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createDocument, emu, type ImageElement } from "../core/document-model";
import { readStoredDocument, saveProject, saveRecovery } from "./project-files";
import { setImageProjectPath } from "./image-url-service";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function withBackground(): ImageElement {
  return {
    id: crypto.randomUUID() as ImageElement["id"],
    type: "image",
    frame: { x: emu(0), y: emu(0), width: emu(914_400), height: emu(914_400) },
    rotationMilliDegree: 0,
    locked: false,
    source: { kind: "embedded", dataUrl: "asset://background.png", mimeType: "image/png" },
    altText: "模板版式背景",
  };
}

describe("stored documents", () => {
  it("reads a document whose page references resolve", () => {
    const document = createDocument();
    const layoutId = crypto.randomUUID();
    document.layouts = [{ id: layoutId, name: "内页（浅色）1" }];
    document.slides[0]!.layoutId = layoutId;

    const stored = readStoredDocument(document);

    expect(stored.removedLayoutReferences).toBe(0);
    expect(stored.document.slides[0]!.layoutId).toBe(layoutId);
  });

  it("keeps the pages of a document whose layout references dangle", () => {
    const document = createDocument();
    document.slides[0]!.layoutId = crypto.randomUUID();
    document.slides[0]!.content.title = "仍然保留的标题";

    const stored = readStoredDocument(document);

    expect(stored.removedLayoutReferences).toBe(1);
    expect(stored.document.slides[0]!.content.title).toBe("仍然保留的标题");
    expect(stored.document.slides[0]!.layoutId).toBeUndefined();
  });

  it("reports a broken document instead of returning half of it", () => {
    expect(() => readStoredDocument({ schemaVersion: 9, title: "缺少页面" })).toThrow();
  });
});

describe("保存时把图片一起带走", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "project_modified_at") return Promise.resolve(1);
      if (command === "save_project" || command === "save_recovery") return Promise.resolve({ missingAssets: [] });
      return Promise.resolve(undefined);
    });
    setImageProjectPath("C:/source.pptd");
  });

  it("另存项目时告诉后端图片来自哪个项目", async () => {
    const document = createDocument();
    document.slides[0]!.elements.push(withBackground());

    // 资源引用留在文档里交给后端搬，不再把所有图片塞回 base64 走一遍 IPC。
    const result = await saveProject(document, "C:/other.pptd");

    expect(result?.report.missingAssets).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("save_project", expect.objectContaining({
      path: "C:/other.pptd",
      sourcePath: "C:/source.pptd",
    }));
    const payload = invokeMock.mock.calls.find(([command]) => command === "save_project")?.[1] as { document: typeof document };
    expect(payload.document.slides[0]!.elements.at(-1)).toMatchObject({ source: { dataUrl: "asset://background.png" } });
  });

  it("另存项目后把后端报回来的缺图带给调用方", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "save_project") return Promise.resolve({ missingAssets: ["asset://background.png"] });
      if (command === "project_modified_at") return Promise.resolve(1);
      return Promise.resolve(undefined);
    });
    const document = createDocument();

    const result = await saveProject(document, "C:/other.pptd");

    // 后端写了文件但没写全，这个缺口必须能报给用户。
    expect(result?.report.missingAssets).toEqual(["asset://background.png"]);
  });

  it("自动保存把缺图原样带回来", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "save_recovery") return Promise.resolve({ missingAssets: ["asset://background.png"] });
      return Promise.resolve(undefined);
    });
    const document = createDocument();

    const report = await saveRecovery(document, "C:/source.pptd");

    expect(report?.missingAssets).toEqual(["asset://background.png"]);
    expect(invokeMock).toHaveBeenCalledWith("save_recovery", expect.objectContaining({ sourcePath: "C:/source.pptd" }));
  });
});
