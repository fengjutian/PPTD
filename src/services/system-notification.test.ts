import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./project-files", () => ({ isDesktopRuntime: vi.fn(() => true) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { notifySystem, prepareSystemNotifications } from "./system-notification";

describe("system notifications", () => {
  beforeEach(() => {
    vi.mocked(isPermissionGranted).mockReset();
    vi.mocked(requestPermission).mockReset();
    vi.mocked(sendNotification).mockReset();
  });

  it("uses the Tauri notification plugin in the desktop runtime", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);

    await notifySystem({ title: "PPTD · AI 生成失败", body: "演示大纲缺少 purpose" });

    expect(sendNotification).toHaveBeenCalledWith({
      title: "PPTD · AI 生成失败",
      body: "演示大纲缺少 purpose",
    });
  });

  it("requests native notification permission when it has not been granted", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue("granted");

    await expect(prepareSystemNotifications()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledOnce();
  });
});
