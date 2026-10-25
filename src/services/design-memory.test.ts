import { describe, expect, it, vi } from "vitest";
import { createDocument } from "../core/document-model";
import type { ConceptPresetId } from "../core/design/deck-concept";

const store = vi.hoisted(() => ({
  entries: [] as Array<{
    id: string;
    kind: "deck" | "preference";
    scope: string;
    payload: Record<string, unknown>;
    createdAt: number;
  }>,
}));

vi.mock("./app-database", () => ({
  loadStoredDesignMemory: vi.fn(async () => [...store.entries]),
  saveStoredDesignMemory: vi.fn(async (entry: (typeof store.entries)[number]) => {
    store.entries = [entry, ...store.entries.filter((candidate) => candidate.id !== entry.id)];
    return store.entries;
  }),
  removeStoredDesignMemory: vi.fn(async (id: string) => {
    store.entries = store.entries.filter((entry) => entry.id !== id);
    return store.entries;
  }),
  clearStoredDesignMemory: vi.fn(async () => {
    store.entries = [];
    return [];
  }),
}));

import {
  clearDesignMemory,
  designMemorySummary,
  loadDesignPreferences,
  loadRecentLooks,
  recordDesignLook,
  recordDesignPreference,
  recommendedConceptPreset,
  removeDesignMemory,
} from "./design-memory";

function memoryDocument() {
  const document = createDocument();
  document.theme = {
    name: "样张主题",
    majorFont: "华文中宋",
    minorFont: "微软雅黑",
    colors: [
      { name: "accent", value: "#112233" },
      { name: "surface", value: "#FAFAF7" },
    ],
  };
  document.slides[0]!.content.title = "这是绝不能进记忆的正文标题";
  return document;
}

describe("design memory", () => {
  it("stores a look fingerprint without any reviewed copy", async () => {
    store.entries = [];
    const document = memoryDocument();
    await recordDesignLook({ document, themePresetId: "paper-ink" });

    expect(store.entries).toHaveLength(1);
    const entry = store.entries[0]!;
    expect(entry.kind).toBe("deck");
    expect(entry.payload.themePresetId).toBe("paper-ink");
    expect(entry.payload.concept).toBe("editorial");
    expect(entry.payload.palette).toEqual(["#112233", "#FAFAF7"]);
    expect(JSON.stringify(entry.payload)).not.toContain("绝不能进记忆");
    expect(JSON.stringify(entry.payload)).not.toContain("这是");
  });

  it("returns recent looks for the proposal prompt", async () => {
    store.entries = [];
    await recordDesignLook({ document: memoryDocument() });
    const looks = await loadRecentLooks(3);
    expect(looks).toHaveLength(1);
    expect(looks[0]?.fonts).toEqual({ major: "华文中宋", minor: "微软雅黑" });
    expect(looks[0]?.pageCount).toBe(1);
  });

  it("keeps explicit preferences and their scope", async () => {
    store.entries = [];
    await recordDesignPreference("  太素了，想要更像杂志  ", "deck");
    const preferences = await loadDesignPreferences();
    expect(preferences[0]?.text).toBe("太素了，想要更像杂志");
    expect(preferences[0]?.scope).toBe("deck");
  });

  it("summarises and clears everything", async () => {
    store.entries = [];
    await recordDesignLook({ document: memoryDocument() });
    await recordDesignPreference("文字少一点");
    expect(await designMemorySummary()).toEqual({ decks: 1, preferences: 1 });
    await clearDesignMemory();
    expect(await designMemorySummary()).toEqual({ decks: 0, preferences: 0 });
  });

  it("removes one remembered look without clearing the rest", async () => {
    store.entries = [];
    await recordDesignLook({ document: memoryDocument(), themePresetId: "first" });
    await recordDesignLook({ document: memoryDocument(), themePresetId: "second" });
    const [newest] = await loadRecentLooks(5);
    expect(newest?.themePresetId).toBe("second");
    await removeDesignMemory(newest!.id);
    const remaining = await loadRecentLooks(5);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.themePresetId).toBe("first");
  });

  it("recommends a preset only after two picks and leaves ties open", async () => {
    const look = (id: string, concept: ConceptPresetId) => ({
      id,
      kind: "deck" as const,
      scope: "deck",
      payload: { concept, palette: [], fonts: { major: "", minor: "" }, pageCount: 1 },
      createdAt: 1,
    });
    store.entries = [look("a", "documentary"), look("b", "documentary"), look("c", "editorial")];
    expect(await recommendedConceptPreset()).toBe("documentary");

    store.entries = [look("a", "paper"), look("b", "paper"), look("c", "instrument"), look("d", "documentary")];
    expect(await recommendedConceptPreset()).toBe("paper");

    store.entries = [look("a", "editorial"), look("b", "documentary")];
    expect(await recommendedConceptPreset()).toBeUndefined();

    store.entries = [
      look("a", "editorial"),
      look("b", "editorial"),
      look("c", "documentary"),
      look("d", "documentary"),
    ];
    expect(await recommendedConceptPreset()).toBeUndefined();
  });
});
