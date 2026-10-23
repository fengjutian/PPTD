import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createDocument } from "../core/document-model";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

const invokeMock = vi.mocked(invoke);

/**
 * 自动保存。
 *
 * 项目已经有路径时，自动保存要写项目本体。只写恢复副本的话，用户下次打开
 * 看到的还是上一次的版本，还得自己记得按保存——那就不叫自动保存。
 */
describe("自动保存", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "save_project" || command === "save_recovery") return Promise.resolve({ missingAssets: [] });
      return Promise.resolve(undefined);
    });
  });

  it("有项目路径时写项目本体", async () => {
    const { autoSave } = await import("./project-files");
    const result = await autoSave(createDocument(), "C:/project.pptd", "C:/project.pptd");
    expect(result.saved).toBe(true);
    const commands = invokeMock.mock.calls.map((call) => call[0]);
    expect(commands).toContain("save_project");
    expect(commands).not.toContain("save_recovery");
    // 写的是这个项目，不是别处。
    const saveCall = invokeMock.mock.calls.find((call) => call[0] === "save_project");
    expect((saveCall?.[1] as { path: string }).path).toBe("C:/project.pptd");
  });

  it("没有项目路径时只写恢复副本", async () => {
    const { autoSave } = await import("./project-files");
    const result = await autoSave(createDocument(), undefined, undefined);
    // 没有路径就无处可写：不能因此弹出保存对话框打断用户。
    expect(result.saved).toBe(false);
    const commands = invokeMock.mock.calls.map((call) => call[0]);
    expect(commands).toContain("save_recovery");
    expect(commands).not.toContain("save_project");
  });

  it("把图片的源路径告诉后端", async () => {
    const { autoSave } = await import("./project-files");
    await autoSave(createDocument(), "C:/project.pptd", "C:/images.pptd");
    const saveCall = invokeMock.mock.calls.find((call) => call[0] === "save_project");
    expect((saveCall?.[1] as { sourcePath: string }).sourcePath).toBe("C:/images.pptd");
  });

  it("把缺失的图片资源报告出来", async () => {
    const { autoSave } = await import("./project-files");
    invokeMock.mockImplementation((command: string) => {
      if (command === "save_project") return Promise.resolve({ missingAssets: ["asset://background.png"] });
      return Promise.resolve(undefined);
    });
    const result = await autoSave(createDocument(), "C:/project.pptd", undefined);
    expect(result.report?.missingAssets).toEqual(["asset://background.png"]);
  });
});
