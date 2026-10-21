import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  value: null as { theme: string; uiFont: string; aiProviderId: string; aiModel: string } | null,
  saved: [] as { theme: string; uiFont: string; aiProviderId: string; aiModel: string }[],
}));

vi.mock("./app-database", () => ({
  loadStoredAppSettings: vi.fn(async () => store.value),
  saveStoredAppSettings: vi.fn(async (settings: unknown) => {
    store.saved.push(settings as (typeof store.saved)[number]);
    store.value = settings as typeof store.value;
  }),
}));

import { defaultSettings, loadSettings, saveSettings, UI_FONT_OPTIONS } from "./settings";

/** 非浏览器环境没有 DOM 与 matchMedia，保存路径会调用 applyTheme/applyUiFont，这里补最小替身。 */
function stubDom(): void {
  (globalThis as { document?: unknown }).document = {
    documentElement: {
      dataset: {} as Record<string, string>,
      style: { setProperty: () => undefined },
    },
  };
  (globalThis as { matchMedia?: unknown }).matchMedia = () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
}

describe("界面字体设置", () => {
  it("存储里的字体 id 非法时回落到默认无衬线", async () => {
    store.value = { theme: "dark", uiFont: "comic", aiProviderId: "minimax", aiModel: "MiniMax-M3" };
    const settings = await loadSettings();
    expect(settings.uiFont).toBe("sans");
  });

  it("保存时原样写入已选字体 id", async () => {
    stubDom();
    store.value = null;
    store.saved.length = 0;
    await saveSettings({ ...defaultSettings(), uiFont: "song" });
    expect(store.saved.at(-1)?.uiFont).toBe("song");
  });

  it("字体选项 id 唯一且都被持久化白名单覆盖", () => {
    const ids = UI_FONT_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(["sans", "song", "hei", "mono"]).toContain(id);
  });

  it("思源宋体选项提供可回退的字体栈与探测名", () => {
    const song = UI_FONT_OPTIONS.find((option) => option.id === "song");
    expect(song).toBeDefined();
    expect(song?.stack).toContain("Source Han Serif SC");
    expect(song?.probes.length).toBeGreaterThan(0);
  });
});
