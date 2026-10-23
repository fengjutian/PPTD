import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  value: null as {
    theme: string;
    uiFont: string;
    uiLanguage?: string;
    aiProviderId: string;
    aiModel: string;
    visionReviewEnabled?: boolean;
  } | null,
  saved: [] as {
    theme: string;
    uiFont: string;
    uiLanguage?: string;
    aiProviderId: string;
    aiModel: string;
    visionReviewEnabled?: boolean;
  }[],
}));

vi.mock("./app-database", () => ({
  loadStoredAppSettings: vi.fn(async () => store.value),
  saveStoredAppSettings: vi.fn(async (settings: unknown) => {
    store.saved.push(settings as (typeof store.saved)[number]);
    store.value = settings as typeof store.value;
  }),
}));

import { applyUiLanguage, defaultSettings, loadSettings, saveSettings, UI_FONT_OPTIONS } from "./settings";

/** 非浏览器环境没有 DOM 与 matchMedia，保存路径会调用 applyTheme/applyUiFont，这里补最小替身。 */
function stubDom(): { lang: string; dataset: Record<string, string> } {
  const documentElement = {
    lang: "",
    dataset: {} as Record<string, string>,
    style: { setProperty: () => undefined },
  };
  (globalThis as { document?: unknown }).document = { documentElement };
  (globalThis as { matchMedia?: unknown }).matchMedia = () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  return documentElement;
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

describe("界面语言设置", () => {
  it("老库没有语言字段时使用简体中文", async () => {
    store.value = { theme: "dark", uiFont: "sans", aiProviderId: "minimax", aiModel: "MiniMax-M3" };
    expect((await loadSettings()).uiLanguage).toBe("zh");
  });

  it("存储里的语言 id 非法时回落到简体中文", async () => {
    store.value = {
      theme: "dark",
      uiFont: "sans",
      uiLanguage: "fr",
      aiProviderId: "minimax",
      aiModel: "MiniMax-M3",
    };
    expect((await loadSettings()).uiLanguage).toBe("zh");
  });

  it("保存时写入语言，并同步文档语言", async () => {
    const documentElement = stubDom();
    store.value = null;
    store.saved.length = 0;
    await saveSettings({ ...defaultSettings(), uiLanguage: "en" });
    expect(store.saved.at(-1)?.uiLanguage).toBe("en");
    expect(documentElement.lang).toBe("en");
    expect(documentElement.dataset.language).toBe("en");
  });

  it("应用到中文时使用标准的 zh-CN 语言标记", () => {
    const documentElement = stubDom();
    applyUiLanguage("zh");
    expect(documentElement.lang).toBe("zh-CN");
    expect(documentElement.dataset.language).toBe("zh");
  });
});

describe("视觉评审隐私开关", () => {
  it("老库没有这个字段时按允许处理，不因升级静默关闭", async () => {
    store.value = { theme: "dark", uiFont: "sans", aiProviderId: "minimax", aiModel: "MiniMax-M3" };
    const settings = await loadSettings();
    expect(settings.visionReviewEnabled).toBe(true);
  });

  it("显式关闭会被读到，并在保存时原样写回", async () => {
    stubDom();
    store.value = {
      theme: "dark",
      uiFont: "sans",
      aiProviderId: "minimax",
      aiModel: "MiniMax-M3",
      visionReviewEnabled: false,
    };
    expect((await loadSettings()).visionReviewEnabled).toBe(false);

    store.saved.length = 0;
    await saveSettings({ ...defaultSettings(), visionReviewEnabled: false });
    expect(store.saved.at(-1)?.visionReviewEnabled).toBe(false);
  });
});
