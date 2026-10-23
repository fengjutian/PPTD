import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_SCHEMA_VERSION } from "../core/document-model";
import versionFifteenFixture from "../core/document-model/__fixtures__/v15-document.json";
import type { AiDraft } from "./ai-service";

const store = vi.hoisted(() => {
  const rows: unknown[] = [];
  return {
    rows,
    loadStoredAiHistory: vi.fn(async () => [...rows]),
    saveStoredAiHistory: vi.fn(async (entry: { id: string }) => {
      const index = rows.findIndex((row) => (row as { id: string }).id === entry.id);
      if (index >= 0) rows[index] = entry;
      else rows.push(entry);
      return [...rows];
    }),
  };
});

vi.mock("./app-database", () => ({
  loadStoredAiHistory: store.loadStoredAiHistory,
  saveStoredAiHistory: store.saveStoredAiHistory,
}));

const { loadAiHistory, saveAiHistory } = await import("./ai-history");

const draft = (): AiDraft => ({
  title: "季度经营复盘",
  presentationBrief: {
    objective: "复盘季度目标完成情况",
    audience: "管理层",
    scenario: "季度经营会",
    expectedAction: "确认下季度重点",
    coreConclusion: "增长主要来自新客户",
    narrativeStrategy: "management-report",
    assumptions: [],
  },
  slides: [{ title: "封面", body: "季度经营复盘", speakerNotes: "", blocks: [] }],
});

const historyRow = (presentation: unknown) => ({
  id: "6a1f5d3e-3c1f-4f47-9a2f-1f4f2d7f0c11",
  topic: "季度经营复盘",
  slideCount: 1,
  updatedAt: "2026-10-23T10:25:38.926Z",
  draft: { ...draft(), generatedPresentation: presentation },
});

describe("AI draft history", () => {
  beforeEach(() => {
    store.rows.length = 0;
  });

  it("migrates a presentation saved under an older schema version", async () => {
    store.rows.push(historyRow(versionFifteenFixture));

    const [entry] = await loadAiHistory();

    expect(entry?.draft.title).toBe("季度经营复盘");
    expect(entry?.presentation?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(entry?.presentation?.slides).toHaveLength(versionFifteenFixture.slides.length);
  });

  it("keeps the reviewed draft when its stored presentation cannot be read", async () => {
    store.rows.push(historyRow({ ...versionFifteenFixture, schemaVersion: 999 }));

    const [entry] = await loadAiHistory();

    expect(entry?.draft.title).toBe("季度经营复盘");
    expect(entry?.draft.slides[0]?.body).toBe("季度经营复盘");
    expect(entry?.presentation).toBeUndefined();
  });

  it("does not overwrite an unreadable presentation when the draft is saved again", async () => {
    store.rows.push(historyRow({ ...versionFifteenFixture, schemaVersion: 999 }));

    await saveAiHistory({
      id: "6a1f5d3e-3c1f-4f47-9a2f-1f4f2d7f0c11",
      topic: "季度经营复盘",
      slideCount: 1,
      draft: { ...draft(), title: "季度经营复盘（修订）" },
    });

    const saved = store.rows[0] as { draft: { title: string; generatedPresentation?: unknown } };
    expect(saved.draft.title).toBe("季度经营复盘（修订）");
    expect(saved.draft.generatedPresentation).toEqual({ ...versionFifteenFixture, schemaVersion: 999 });
  });

  it("loads a draft that was never generated into a presentation", async () => {
    const row = historyRow(undefined) as { draft: Record<string, unknown> };
    delete row.draft.generatedPresentation;
    store.rows.push(row);

    const [entry] = await loadAiHistory();

    expect(entry?.draft.title).toBe("季度经营复盘");
    expect(entry?.presentation).toBeUndefined();
  });
});
