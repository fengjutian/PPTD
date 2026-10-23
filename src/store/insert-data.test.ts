import { beforeEach, describe, expect, it } from "vitest";
import { createDocument } from "../core/document-model";
import { useEditorStore } from "./editor-store";

/**
 * 插入表格/图表是一个同时改变内容与设计的事务，并选中新对象。
 */
describe("insert table and chart in the editor store", () => {
  beforeEach(() => {
    const document = createDocument();
    useEditorStore.setState({
      document,
      activeSlideId: document.slides[0]!.id,
      selectedElementIds: [],
      undoStack: [],
      redoStack: [],
    });
  });

  it("inserts a table as one undoable content and design change", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    state.execute({ type: "add-table", slideId: slide.id, columns: 3, rows: 2 });

    const after = useEditorStore.getState();
    expect(after.undoStack).toHaveLength(1);
    expect(after.document.revisions.content).toBe(1);
    expect(after.document.revisions.design).toBe(1);
    const element = after.document.slides[0]!.elements.at(-1)!;
    expect(element.type).toBe("table");
    expect(after.selectedElementIds).toEqual([element.id]);

    after.undo();
    const restored = useEditorStore.getState();
    expect(restored.document.slides[0]!.elements.some((item) => item.type === "table")).toBe(false);
    expect(restored.document.slides[0]!.content.blocks ?? []).toHaveLength(0);
  });

  it("inserts a chart and selects it", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    state.execute({ type: "add-chart", slideId: slide.id, kind: "line" });

    const after = useEditorStore.getState();
    const element = after.document.slides[0]!.elements.at(-1)!;
    expect(element.type).toBe("chart");
    expect(after.selectedElementIds).toEqual([element.id]);
    expect(after.document.slides[0]!.content.blocks?.filter((block) => block.type === "metric")).toHaveLength(3);
  });
});
